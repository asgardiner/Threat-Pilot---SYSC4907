import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventBus, KernelEventMap, Threat } from '@kernel/contracts';
import { makeSampleProject } from '../model/fixtures';
import { createModelStore, HISTORY_LIMIT, ModelError } from './store';

/** Minimal in-memory bus implementing the contract. */
function makeBus() {
    const handlers: { [K in keyof KernelEventMap]?: Array<(p: KernelEventMap[K]) => void> } = {};
    const bus: EventBus = {
        on(event, handler) {
            const list = (handlers[event] ??= []) as Array<typeof handler>;
            list.push(handler);
            return () => list.splice(list.indexOf(handler), 1);
        },
        emit(event, payload) {
            (handlers[event] as Array<(p: typeof payload) => void> | undefined)?.forEach((h) => h(payload));
        },
    };
    return bus;
}

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 19, 0, 0, tick++)).toISOString();

function setup() {
    tick = 0;
    const bus = makeBus();
    const changed = vi.fn();
    bus.on('ModelChanged', changed);
    const store = createModelStore({ events: bus, now: clock });
    const result = store.getState().loadProject(makeSampleProject());
    expect(result.ok).toBe(true);
    changed.mockClear();
    return { store, bus, changed, s: () => store.getState(), p: () => store.getState().project! };
}

const newElement = { id: 'e9', type: 'process' as const, name: 'Worker', position: { x: 1, y: 2 }, properties: {} };

describe('loading', () => {
    it('starts empty', () => {
        const s = createModelStore().getState();
        expect(s.project).toBeNull();
        expect(s.dirty).toBe(false);
    });

    it('loads a valid project: clean, no history, emits ModelChanged', () => {
        const bus = makeBus();
        const changed = vi.fn();
        bus.on('ModelChanged', changed);
        const store = createModelStore({ events: bus });
        store.getState().loadProject(makeSampleProject());
        expect(store.getState()).toMatchObject({ dirty: false, canUndo: false, canRedo: false });
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid project with errors and leaves state untouched', () => {
        const { store, changed, p } = setup();
        const before = p();
        const result = store.getState().loadProject({ nope: true });
        expect(result.ok).toBe(false);
        expect(store.getState().project).toBe(before);
        expect(changed).not.toHaveBeenCalled();
    });

    it('throws a ModelError for actions when no project is open', () => {
        const store = createModelStore();
        expect(() => store.getState().addElement(newElement)).toThrow(ModelError);
        expect(() => store.getState().addElement(newElement)).toThrow('No project is open');
    });

    it('closeProject resets everything', () => {
        const { store, s } = setup();
        s().addElement(newElement);
        store.getState().closeProject();
        expect(s()).toMatchObject({ project: null, dirty: false, canUndo: false });
    });
});

describe('elements', () => {
    it('adds an element', () => {
        const { s, p } = setup();
        s().addElement(newElement);
        expect(p().elements.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e9']);
    });

    it('rejects a duplicate id', () => {
        const { s, changed } = setup();
        expect(() => s().addElement({ ...newElement, id: 'e1' })).toThrow('Element "e1" already exists');
        expect(changed).not.toHaveBeenCalled();
    });

    it('updates an element, never changing its id', () => {
        const { s, p } = setup();
        s().updateElement('e2', { name: 'Gateway', id: 'hacked' } as never);
        const e = p().elements.find((x) => x.id === 'e2')!;
        expect(e.name).toBe('Gateway');
        expect(p().elements.some((x) => x.id === 'hacked')).toBe(false);
    });

    it('throws when updating or removing an unknown element', () => {
        const { s } = setup();
        expect(() => s().updateElement('zzz', { name: 'x' })).toThrow('Element "zzz" does not exist');
        expect(() => s().removeElement('zzz')).toThrow(ModelError);
    });

    it('removing an element cascades to flows, boundary membership and threats', () => {
        const { s, p } = setup();
        s().addThreat({ ...(p().threats[0] as Threat), id: 't2', target: { kind: 'dataFlow', id: 'f1' } });
        s().removeElement('e2');
        expect(p().elements.map((e) => e.id)).toEqual(['e1', 'e3']);
        expect(p().dataFlows).toEqual([]); // f1 and f2 both touched e2
        expect(p().trustBoundaries[0]!.elementIds).toEqual(['e3']);
        expect(p().threats).toEqual([]); // t1 targeted e2, t2 targeted f1
    });
});

describe('data flows', () => {
    const flow = { id: 'f9', name: 'sync', sourceId: 'e3', targetId: 'e1', properties: {} };

    it('adds, updates and removes a flow', () => {
        const { s, p } = setup();
        s().addDataFlow(flow);
        expect(p().dataFlows).toHaveLength(3);
        s().updateDataFlow('f9', { protocol: 'gRPC' });
        expect(p().dataFlows.find((f) => f.id === 'f9')!.protocol).toBe('gRPC');
        s().removeDataFlow('f9');
        expect(p().dataFlows.map((f) => f.id)).toEqual(['f1', 'f2']);
    });

    it('rejects flows with unknown endpoints, on add and on update', () => {
        const { s } = setup();
        expect(() => s().addDataFlow({ ...flow, sourceId: 'nope' })).toThrow('Element "nope" does not exist');
        expect(() => s().updateDataFlow('f1', { targetId: 'nope' })).toThrow('Element "nope" does not exist');
    });

    it('rejects duplicates and unknown ids', () => {
        const { s } = setup();
        expect(() => s().addDataFlow({ ...flow, id: 'f1' })).toThrow('already exists');
        expect(() => s().removeDataFlow('zzz')).toThrow('does not exist');
    });

    it('removing a flow removes threats that target it', () => {
        const { s, p } = setup();
        s().addThreat({ ...p().threats[0]!, id: 't2', target: { kind: 'dataFlow', id: 'f1' } });
        s().removeDataFlow('f1');
        expect(p().threats.map((t) => t.id)).toEqual(['t1']);
    });
});

describe('trust boundaries', () => {
    it('adds, updates and removes a boundary', () => {
        const { s, p } = setup();
        s().addTrustBoundary({ id: 'b2', name: 'Client', elementIds: ['e1'] });
        expect(p().trustBoundaries).toHaveLength(2);
        s().updateTrustBoundary('b2', { name: 'Browser', elementIds: ['e1', 'e2'] });
        expect(p().trustBoundaries[1]).toMatchObject({ name: 'Browser', elementIds: ['e1', 'e2'] });
        s().removeTrustBoundary('b2');
        expect(p().trustBoundaries.map((b) => b.id)).toEqual(['b1']);
    });

    it('rejects unknown member elements and duplicate ids', () => {
        const { s } = setup();
        expect(() => s().addTrustBoundary({ id: 'b2', name: 'x', elementIds: ['ghost'] })).toThrow('Element "ghost"');
        expect(() => s().updateTrustBoundary('b1', { elementIds: ['ghost'] })).toThrow('Element "ghost"');
        expect(() => s().addTrustBoundary({ id: 'b1', name: 'x', elementIds: [] })).toThrow('already exists');
    });

    it('removing a boundary removes threats that target it', () => {
        const { s, p } = setup();
        s().addThreat({ ...p().threats[0]!, id: 't2', target: { kind: 'trustBoundary', id: 'b1' } });
        s().removeTrustBoundary('b1');
        expect(p().threats.map((t) => t.id)).toEqual(['t1']);
    });
});

describe('threats', () => {
    const userThreat = (): Threat => ({
        id: 't9',
        title: 'Manual',
        description: '',
        category: 'Tampering',
        methodologyId: 'stride',
        target: { kind: 'element', id: 'e3' },
        origin: 'user',
        modified: false,
        priority: 'low',
        status: 'open',
        createdAt: '2026-11-19T00:00:00.000Z',
        updatedAt: '2026-11-19T00:00:00.000Z',
    });

    it('adds and removes a threat', () => {
        const { s, p } = setup();
        s().addThreat(userThreat());
        expect(p().threats.map((t) => t.id)).toEqual(['t1', 't9']);
        s().removeThreat('t9');
        expect(p().threats.map((t) => t.id)).toEqual(['t1']);
    });

    it('rejects a threat with a missing target or duplicate id', () => {
        const { s } = setup();
        expect(() => s().addThreat({ ...userThreat(), target: { kind: 'element', id: 'ghost' } })).toThrow('ghost');
        expect(() => s().addThreat({ ...userThreat(), id: 't1' })).toThrow('already exists');
    });

    it('marks a generated threat as modified when a user edits it, and bumps updatedAt (FR 2.3)', () => {
        const { s, p } = setup();
        s().updateThreat('t1', { mitigation: 'Use mTLS' });
        const t = p().threats[0]!;
        expect(t).toMatchObject({ mitigation: 'Use mTLS', modified: true, origin: 'generated' });
        expect(t.updatedAt).not.toBe('2026-11-18T00:00:00.000Z');
    });

    it('does not mark user threats as modified', () => {
        const { s, p } = setup();
        s().addThreat(userThreat());
        s().updateThreat('t9', { status: 'mitigated' });
        expect(p().threats[1]).toMatchObject({ status: 'mitigated', modified: false });
    });

    it('lets the caller set `modified` explicitly', () => {
        const { s, p } = setup();
        s().updateThreat('t1', { priority: 'critical', modified: false });
        expect(p().threats[0]!.modified).toBe(false);
    });

    it('throws for unknown threat ids', () => {
        const { s } = setup();
        expect(() => s().updateThreat('zzz', { title: 'x' })).toThrow('Threat "zzz" does not exist');
        expect(() => s().removeThreat('zzz')).toThrow(ModelError);
    });
});

describe('dirty tracking and ModelChanged', () => {
    it('becomes dirty on change and clean on markSaved', () => {
        const { s } = setup();
        expect(s().dirty).toBe(false);
        s().addElement(newElement);
        expect(s().dirty).toBe(true);
        s().markSaved();
        expect(s().dirty).toBe(false);
    });

    it('emits ModelChanged with the new project after every mutation', () => {
        const { s, p, changed } = setup();
        s().addElement(newElement);
        s().updateElement('e9', { name: 'Job runner' });
        s().removeElement('e9');
        expect(changed).toHaveBeenCalledTimes(3);
        expect(changed).toHaveBeenLastCalledWith({ project: p() });
    });

    it('does not emit when an action throws', () => {
        const { s, changed } = setup();
        expect(() => s().removeElement('zzz')).toThrow();
        expect(changed).not.toHaveBeenCalled();
    });

    it('does not emit on markSaved', () => {
        const { s, changed } = setup();
        s().addElement(newElement);
        changed.mockClear();
        s().markSaved();
        expect(changed).not.toHaveBeenCalled();
    });

    it('bumps project.updatedAt on change but never mutates earlier snapshots', () => {
        const { s, p } = setup();
        const before = p();
        s().addElement(newElement);
        expect(p()).not.toBe(before);
        expect(p().updatedAt).not.toBe(before.updatedAt);
        expect(before.elements).toHaveLength(3);
    });

    it('works with a bus attached later, and stops after disconnect', () => {
        const store = createModelStore({ now: clock });
        store.getState().loadProject(makeSampleProject());
        const bus = makeBus();
        const changed = vi.fn();
        bus.on('ModelChanged', changed);
        const disconnect = store.getState().connectEvents(bus);
        store.getState().addElement(newElement);
        expect(changed).toHaveBeenCalledTimes(1);
        disconnect();
        store.getState().removeElement('e9');
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it('notifies store subscribers', () => {
        const { store, s } = setup();
        const listener = vi.fn();
        store.subscribe(listener);
        s().addElement(newElement);
        expect(listener).toHaveBeenCalled();
    });
});

describe('undo / redo', () => {
    let ctx: ReturnType<typeof setup>;
    beforeEach(() => {
        ctx = setup();
    });

    it('does nothing with empty history', () => {
        const { s, p, changed } = ctx;
        const before = p();
        s().undo();
        s().redo();
        expect(p()).toBe(before);
        expect(changed).not.toHaveBeenCalled();
    });

    it('undoes and redoes a change, emitting ModelChanged each time', () => {
        const { s, p, changed } = ctx;
        s().addElement(newElement);
        changed.mockClear();
        s().undo();
        expect(p().elements).toHaveLength(3);
        expect(s()).toMatchObject({ canUndo: false, canRedo: true });
        s().redo();
        expect(p().elements).toHaveLength(4);
        expect(s()).toMatchObject({ canUndo: true, canRedo: false });
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it('returns to clean when undoing back to the saved state', () => {
        const { s } = ctx;
        s().addElement(newElement);
        expect(s().dirty).toBe(true);
        s().undo();
        expect(s().dirty).toBe(false);
        s().redo();
        expect(s().dirty).toBe(true);
    });

    it('stays dirty after undo past a save point', () => {
        const { s } = ctx;
        s().addElement(newElement);
        s().markSaved();
        s().undo();
        expect(s().dirty).toBe(true);
        s().redo();
        expect(s().dirty).toBe(false);
    });

    it('a new change clears the redo stack', () => {
        const { s } = ctx;
        s().addElement(newElement);
        s().undo();
        s().removeThreat('t1');
        expect(s().canRedo).toBe(false);
    });

    it('undoes a cascading delete in one step', () => {
        const { s, p } = ctx;
        s().removeElement('e2');
        s().undo();
        expect(p().elements).toHaveLength(3);
        expect(p().dataFlows).toHaveLength(2);
        expect(p().threats).toHaveLength(1);
    });

    it('clears history on load', () => {
        const { s } = ctx;
        s().addElement(newElement);
        s().loadProject(makeSampleProject());
        expect(s()).toMatchObject({ canUndo: false, canRedo: false, dirty: false });
    });

    it(`keeps at most ${HISTORY_LIMIT} undo steps`, () => {
        const { s } = ctx;
        for (let i = 0; i < HISTORY_LIMIT + 10; i++) s().addElement({ ...newElement, id: `x${i}` });
        expect(s().past).toHaveLength(HISTORY_LIMIT);
    });
});