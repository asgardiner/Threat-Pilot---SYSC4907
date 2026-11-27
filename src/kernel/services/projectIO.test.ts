import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Exporter, Project, SaveResult, Storage, StorageRef, StoredModel } from '../contracts';
import { makeSampleProject } from '../model/fixtures';
import { createModelStore } from '../state/store';
import { createProjectIO, fileSlug, MAX_LISTED_ERRORS, type ProjectIODeps } from './projectIO';

/** In-memory storage that behaves like the local-file provider (no revisions, MRU list). */
function memoryStorage(initial?: { name: string; model: unknown }) {
    const files = new Map<string, unknown>(initial ? [[initial.name, initial.model]] : []);
    let mru: string[] = initial ? [] : [];
    let nextPick = initial?.name;
    const storage: Storage & { files: typeof files; pick(name: string): void } = {
        id: 'mem',
        name: 'Memory',
        version: '1',
        kind: 'storage',
        permissions: [],
        features: { read: true, write: true, remote: false, requiresAuth: false },
        files,
        pick(name) {
            nextPick = name;
        },
        authenticate: vi.fn(async () => {}),
        list: vi.fn(async () => mru.map((path) => ({ path }))),
        open: vi.fn(async (ref: StorageRef): Promise<StoredModel> => {
            const name = ref.path || nextPick;
            if (!name || !files.has(name)) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
            mru = [name, ...mru.filter((n) => n !== name)];
            return { model: structuredClone(files.get(name)) as Project, revision: null };
        }),
        save: vi.fn(async (ref: StorageRef, model: Project): Promise<SaveResult> => {
            files.set(ref.path, structuredClone(model));
            mru = [ref.path, ...mru.filter((n) => n !== ref.path)];
            return { ok: true, revision: null };
        }),
        getRevision: vi.fn(async () => null),
    };
    return storage;
}

function setup(overrides: Partial<ProjectIODeps> = {}) {
    const store = createModelStore({ now: () => '2026-11-23T01:00:00.000Z' });
    const deps = {
        notify: vi.fn<ProjectIODeps['notify']>(),
        download: vi.fn<ProjectIODeps['download']>(),
    };
    const io = createProjectIO({
        store,
        confirmDiscard: () => true,
        newId: () => 'new-id',
        now: () => '2026-11-23T00:00:00.000Z',
        ...deps,
        ...overrides,
    });
    return { store, deps, io };
}

describe('projectIO', () => {
    let sample: Project;
    beforeEach(() => {
        sample = makeSampleProject();
    });

    it('new project: loads a valid blank model', () => {
        const { io, store } = setup();
        io.newProject();
        const p = store.getState().project!;
        expect(p).toMatchObject({ id: 'new-id', title: 'Untitled threat model', schemaVersion: 1, elements: [] });
        expect(store.getState().dirty).toBe(false);
    });

    it('open: validates through K2 and loads the model', async () => {
        const { io, store, deps } = setup();
        const storage = memoryStorage({ name: 'a.json', model: sample });
        await io.open(storage);
        expect(store.getState().project).toEqual(sample);
        expect(io.current).toEqual({ storageId: 'mem', ref: { path: 'a.json' }, revision: null });
        expect(deps.notify).toHaveBeenCalledWith('Opened "Sample".', 'info');
    });

    it('open: rejects an invalid file with readable errors and leaves the current project alone', async () => {
        const { io, store, deps } = setup();
        io.newProject();
        const before = store.getState().project;
        const broken = { ...sample, schemaVersion: 99, elements: [{ id: '' }] };
        await io.open(memoryStorage({ name: 'bad.json', model: broken }));

        expect(store.getState().project).toBe(before);
        const [message, kind] = deps.notify.mock.calls.at(-1)!;
        expect(kind).toBe('error');
        expect(message).toMatch(/isn't a valid ThreatPilot model/);
        expect(message).toContain('schemaVersion');
        expect(message).toMatch(/elements\[0]\./);
    });

    it('open: caps the listed validation errors', async () => {
        const { io, deps } = setup();
        const many = { ...sample, threats: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}` })) };
        await io.open(memoryStorage({ name: 'bad.json', model: many }));
        const message = deps.notify.mock.calls.at(-1)![0];
        expect(message.split('\n').filter((l) => l.startsWith('threats')).length).toBe(MAX_LISTED_ERRORS);
        expect(message).toMatch(/…and \d+ more\./);
    });

    it('open: a cancelled picker is silent', async () => {
        const { io, deps } = setup();
        await io.open(memoryStorage());
        expect(deps.notify).not.toHaveBeenCalled();
    });

    it('open: reports provider errors (e.g. not JSON)', async () => {
        const { io, deps } = setup();
        const storage = memoryStorage();
        vi.mocked(storage.open).mockRejectedValueOnce(new Error('"x.json" is not a valid ThreatPilot file'));
        await io.open(storage);
        expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('not a valid ThreatPilot file'), 'error');
    });

    it('open: asks before discarding unsaved changes', async () => {
        const confirmDiscard = vi.fn(() => false);
        const { io, store } = setup({ confirmDiscard });
        io.newProject();
        store.getState().addElement({ id: 'e', type: 'process', name: 'X', position: { x: 0, y: 0 }, properties: {} });
        const storage = memoryStorage({ name: 'a.json', model: sample });
        await io.open(storage);
        expect(confirmDiscard).toHaveBeenCalled();
        expect(storage.open).not.toHaveBeenCalled();
    });

    it('save → reopen round trip keeps diagram and threats identical (S1 acceptance)', async () => {
        const { io, store } = setup();
        const storage = memoryStorage({ name: 'a.json', model: sample });
        await io.open(storage);
        store.getState().updateThreat('t1', { mitigation: 'mTLS' });
        expect(store.getState().dirty).toBe(true);

        await io.save(storage);
        expect(storage.save).toHaveBeenCalledWith({ path: 'a.json' }, store.getState().project, null);
        expect(store.getState().dirty).toBe(false);
        const savedState = store.getState().project;

        // "Reload the page": a fresh store and IO over the same storage.
        const fresh = setup();
        storage.pick('a.json');
        await fresh.io.open(storage);
        expect(fresh.store.getState().project).toEqual(savedState);
    });

    it('save: new projects get a file name from their title', async () => {
        const { io } = setup();
        io.newProject();
        const storage = memoryStorage();
        await io.save(storage);
        expect(vi.mocked(storage.save).mock.calls[0]![0]).toEqual({ path: 'untitled-threat-model.threatpilot.json' });
        expect(io.current?.ref).toEqual({ path: 'untitled-threat-model.threatpilot.json' });
    });

    it('save: emits SaveRequested on the bus', async () => {
        const emit = vi.fn();
        const { io } = setup({ events: { on: vi.fn(() => () => {}), emit } });
        io.newProject();
        await io.save(memoryStorage());
        expect(emit).toHaveBeenCalledWith('SaveRequested', { storageId: 'mem', ref: expect.any(Object) });
    });

    it('save: keeps dirty if the model changed while saving', async () => {
        const { io, store } = setup();
        const storage = memoryStorage({ name: 'a.json', model: sample });
        await io.open(storage);
        store.getState().updateThreat('t1', { mitigation: 'one' });
        vi.mocked(storage.save).mockImplementationOnce(async () => {
            store.getState().updateThreat('t1', { mitigation: 'two' });
            return { ok: true, revision: null };
        });
        await io.save(storage);
        expect(store.getState().dirty).toBe(true);
    });

    it('save: a conflict is reported, not hidden', async () => {
        const { io, store, deps } = setup();
        io.newProject();
        const storage = memoryStorage();
        vi.mocked(storage.save).mockResolvedValueOnce({ ok: false, reason: 'conflict', remoteRevision: 'abc' });
        await io.save(storage);
        expect(store.getState().dirty).toBe(false); // unchanged blank project, never marked by this save
        expect(deps.notify).toHaveBeenLastCalledWith(expect.stringMatching(/^Not saved/), 'error');
    });

    it('save / export without a project explain what to do', async () => {
        const { io, deps } = setup();
        await io.save(memoryStorage());
        await io.exportWith({ format: 'html', render: vi.fn() } as unknown as Exporter);
        expect(deps.notify.mock.calls.map((c) => c[1])).toEqual(['error', 'error']);
    });

    it('export: renders the open project and downloads it', async () => {
        const { io, deps } = setup();
        const storage = memoryStorage({ name: 'a.json', model: sample });
        await io.open(storage);
        const blob = new Blob(['<html>']);
        const exporter = { format: 'html', render: vi.fn(async () => blob) } as unknown as Exporter;
        await io.exportWith(exporter, { includeMitigated: false });
        expect(exporter.render).toHaveBeenCalledWith(sample, { includeMitigated: false });
        expect(deps.download).toHaveBeenCalledWith(blob, 'sample.html');
    });
});

describe('fileSlug', () => {
    it.each([
        ['Online Shop v2', 'online-shop-v2'],
        ['  ../etc/passwd ', 'etc-passwd'],
        ['Café ☕', 'cafe'],
        ['', 'threat-model'],
    ])('%j → %j', (input, out) => expect(fileSlug(input)).toBe(out));
});
