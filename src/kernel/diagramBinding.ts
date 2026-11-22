import type { StoreApi } from 'zustand/vanilla';
import type { Diagram, DiagramState, Id, Project } from '@kernel/contracts';
import { ModelError, type ModelStore } from './state/store';

/**
 * Connects a Diagram plug-in to the model store.
 *
 * Plug-ins may not import the store (docs/conventions.md, rule 1), so the kernel does the
 * wiring on their behalf:
 *   store  -> plug-in : the initial `mount(container, state)`; later changes reach the plug-in
 *                       through `ModelChanged` on the event bus (see the plug-in's `activate`).
 *   plug-in -> store  : `onChange(state)` is turned into store actions here, so every edit is
 *                       validated, undoable, marked dirty and announced like any other change.
 */

export const diagramOf = (project: Project): DiagramState => ({
    elements: project.elements,
    dataFlows: project.dataFlows,
    trustBoundaries: project.trustBoundaries,
});

/** Structural equality that ignores key order and treats `undefined` as absent. */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    return [...new Set([...Object.keys(ao), ...Object.keys(bo)])].every((k) => deepEqual(ao[k], bo[k]));
}

const idsOf = (items: ReadonlyArray<{ id: Id }>) => new Set(items.map((i) => i.id));

/** Reject a malformed state up front, so a bad one can never be applied halfway. */
function assertConsistent(next: DiagramState): void {
    const elementIds = idsOf(next.elements);
    const dup = (kind: string, items: ReadonlyArray<{ id: Id }>) => {
        if (idsOf(items).size !== items.length) throw new ModelError(`Diagram has duplicate ${kind} ids`);
    };
    dup('element', next.elements);
    dup('data flow', next.dataFlows);
    dup('trust boundary', next.trustBoundaries);

    for (const f of next.dataFlows) {
        if (!elementIds.has(f.sourceId) || !elementIds.has(f.targetId)) {
            throw new ModelError(`Data flow "${f.id}" refers to an element that is not in the diagram`);
        }
    }
    for (const b of next.trustBoundaries) {
        const missing = b.elementIds.find((id) => !elementIds.has(id));
        if (missing !== undefined) {
            throw new ModelError(`Trust boundary "${b.id}" refers to element "${missing}" that is not in the diagram`);
        }
    }
}

/**
 * Makes the store's diagram equal to `next` using the store's own actions (never by replacing
 * the project), so threats, metadata, history and dirty tracking all keep working.
 *
 * Order matters: removals first (removing an element already removes its flows and trims
 * boundaries), then additions with elements before the flows and boundaries that point at them.
 */
export function applyDiagramState(store: StoreApi<ModelStore>, next: DiagramState): void {
    assertConsistent(next);
    const actions = store.getState();
    const project = (): Project => {
        const p = store.getState().project;
        if (!p) throw new ModelError('No project is open');
        return p;
    };

    // Elements
    const nextElements = idsOf(next.elements);
    for (const e of project().elements) if (!nextElements.has(e.id)) actions.removeElement(e.id);
    {
        const have = new Map(project().elements.map((e) => [e.id, e]));
        for (const e of next.elements) {
            const old = have.get(e.id);
            if (!old) actions.addElement(e);
            else if (!deepEqual(old, e)) {
                actions.updateElement(e.id, {
                    type: e.type,
                    name: e.name,
                    description: e.description,
                    position: e.position,
                    properties: e.properties,
                });
            }
        }
    }

    // Data flows
    const nextFlows = idsOf(next.dataFlows);
    for (const f of project().dataFlows) if (!nextFlows.has(f.id)) actions.removeDataFlow(f.id);
    {
        const have = new Map(project().dataFlows.map((f) => [f.id, f]));
        for (const f of next.dataFlows) {
            const old = have.get(f.id);
            if (!old) actions.addDataFlow(f);
            else if (!deepEqual(old, f)) {
                actions.updateDataFlow(f.id, {
                    name: f.name,
                    sourceId: f.sourceId,
                    targetId: f.targetId,
                    protocol: f.protocol,
                    dataClassification: f.dataClassification,
                    properties: f.properties,
                });
            }
        }
    }

    // Trust boundaries
    const nextBoundaries = idsOf(next.trustBoundaries);
    for (const b of project().trustBoundaries) if (!nextBoundaries.has(b.id)) actions.removeTrustBoundary(b.id);
    {
        const have = new Map(project().trustBoundaries.map((b) => [b.id, b]));
        for (const b of next.trustBoundaries) {
            const old = have.get(b.id);
            if (!old) actions.addTrustBoundary(b);
            else if (!deepEqual(old, b)) actions.updateTrustBoundary(b.id, { name: b.name, elementIds: b.elementIds });
        }
    }
}

export interface DiagramBindingOptions {
    diagram: Diagram;
    container: HTMLElement;
    store: StoreApi<ModelStore>;
}

/**
 * Mounts `diagram` into `container` showing the open project's diagram, and writes every edit
 * the plug-in reports back to `store`. Returns a function that unbinds and unmounts.
 *
 * The plug-in must already be enabled (`registry.enable(id)`) so it receives `ModelChanged`.
 */
export function bindDiagram({ diagram, container, store }: DiagramBindingOptions): () => void {
    const project = store.getState().project;
    if (!project) throw new ModelError('Open a project before mounting the diagram');

    diagram.mount(container, diagramOf(project));
    const stopListening = diagram.onChange((state) => applyDiagramState(store, state));

    return () => {
        stopListening();
        diagram.unmount();
    };
}