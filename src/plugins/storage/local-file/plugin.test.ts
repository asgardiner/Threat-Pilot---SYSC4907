import { describe, it, expect, vi } from 'vitest';
import type { Project } from '@kernel/contracts';
import { createLocalFilePlugin, DEFAULT_FILE_NAME, type FileHandleLike, type LocalFileEnv } from './plugin';

// Plug-ins may only import contracts, so the fixture lives here rather than in kernel/model.
function project(title = 'Demo'): Project {
    const t = '2026-11-23T00:00:00.000Z';
    return {
        schemaVersion: 1,
        id: 'p1',
        title,
        owner: 'sammy',
        description: '',
        reviewers: [],
        methodologyIds: [],
        elements: [{ id: 'e1', type: 'process', name: 'API', position: { x: 0, y: 0 }, properties: {} }],
        dataFlows: [],
        trustBoundaries: [],
        threats: [],
        createdAt: t,
        updatedAt: t,
    };
}

/** In-memory file handle that records what gets written to it. */
function fakeHandle(name: string, contents = ''): FileHandleLike & { contents: string } {
    const handle = {
        name,
        contents,
        async getFile() {
            return new File([handle.contents], name, { type: 'application/json' });
        },
        async createWritable() {
            let buffer = '';
            return {
                async write(data: Blob | string) {
                    buffer += typeof data === 'string' ? data : await data.text();
                },
                async close() {
                    handle.contents = buffer;
                },
            };
        },
    };
    return handle;
}

function env(overrides: Partial<LocalFileEnv> = {}): LocalFileEnv {
    return {
        pickFile: vi.fn(async () => {
            throw new Error('pickFile not expected');
        }),
        download: vi.fn(),
        ...overrides,
    };
}

describe('local-file storage plug-in', () => {
    it('declares a local, auth-free, read/write provider', () => {
        const plugin = createLocalFilePlugin(env());
        expect(plugin.kind).toBe('storage');
        expect(plugin.features).toEqual({ read: true, write: true, remote: false, requiresAuth: false });
    });

    it('round-trips through the File System Access API: save, then open the same file', async () => {
        const handle = fakeHandle('model.json');
        const showSaveFilePicker = vi.fn(async () => handle);
        const plugin = createLocalFilePlugin(env({ showSaveFilePicker, showOpenFilePicker: vi.fn() }));

        const saved = await plugin.save({ path: 'model.json' }, project(), null);
        expect(saved).toEqual({ ok: true, revision: null });
        expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'model.json' }));

        // Second save reuses the handle: no picker.
        await plugin.save({ path: 'model.json' }, project('Renamed'), null);
        expect(showSaveFilePicker).toHaveBeenCalledOnce();

        const opened = await plugin.open({ path: 'model.json' });
        expect(opened).toEqual({ model: project('Renamed'), revision: null });
        expect(await plugin.list()).toEqual([{ path: 'model.json' }]);
    });

    it('opens through the native picker and remembers the file name', async () => {
        const handle = fakeHandle('picked.json', JSON.stringify(project('Picked')));
        const plugin = createLocalFilePlugin(env({ showOpenFilePicker: vi.fn(async () => [handle]) }));

        const { model } = await plugin.open({ path: '' });
        expect(model.title).toBe('Picked');
        expect(await plugin.list()).toEqual([{ path: 'picked.json' }]);
    });

    it('falls back to <input type="file"> and a download without the File System Access API', async () => {
        const file = new File([JSON.stringify(project('Uploaded'))], 'up.json');
        const e = env({ pickFile: vi.fn(async () => file) });
        const plugin = createLocalFilePlugin(e);

        const { model } = await plugin.open({ path: '' });
        expect(model.title).toBe('Uploaded');

        await plugin.save({ path: 'up.json' }, model, null);
        expect(e.download).toHaveBeenCalledOnce();
        const [blob, name] = vi.mocked(e.download).mock.calls[0]!;
        expect(name).toBe('up.json');
        expect(JSON.parse(await blob.text())).toEqual(model);
    });

    it('uses a default file name when the ref has no path', async () => {
        const e = env();
        await createLocalFilePlugin(e).save({ path: '' }, project(), null);
        expect(vi.mocked(e.download).mock.calls[0]![1]).toBe(DEFAULT_FILE_NAME);
    });

    it('falls back to a download if the save picker is refused for another reason', async () => {
        const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        const e = env({ showSaveFilePicker: vi.fn(async () => Promise.reject(denied)) });
        const result = await createLocalFilePlugin(e).save({ path: 'x.json' }, project(), null);
        expect(result.ok).toBe(true);
        expect(e.download).toHaveBeenCalledOnce();
    });

    it('propagates picker cancellation as an AbortError', async () => {
        const cancel = Object.assign(new Error('cancelled'), { name: 'AbortError' });
        const e = env({
            showOpenFilePicker: vi.fn(async () => Promise.reject(cancel)),
            showSaveFilePicker: vi.fn(async () => Promise.reject(cancel)),
        });
        const plugin = createLocalFilePlugin(e);
        await expect(plugin.open({ path: '' })).rejects.toMatchObject({ name: 'AbortError' });
        await expect(plugin.save({ path: 'x.json' }, project(), null)).rejects.toMatchObject({ name: 'AbortError' });
        expect(e.download).not.toHaveBeenCalled();
    });

    it('reports non-JSON files with a readable message instead of a raw SyntaxError', async () => {
        const file = new File(['not json {'], 'broken.json');
        const plugin = createLocalFilePlugin(env({ pickFile: async () => file }));
        await expect(plugin.open({ path: '' })).rejects.toThrow(/"broken\.json" is not a valid ThreatPilot file/);
    });

    it('never reports a revision (no conflicts for local files)', async () => {
        expect(await createLocalFilePlugin(env()).getRevision({ path: 'x' })).toBeNull();
    });
});
