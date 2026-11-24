import type {
    Project,
    Revision,
    SaveResult,
    Storage,
    StorageRef,
    StoredModel,
} from '@kernel/contracts';

/**
 * S1: Local file storage provider (FR 3.1, issue #25).
 *
 * - Save: File System Access API when the browser has it (Chromium), otherwise a download.
 * - Open: native file picker when available, otherwise an <input type="file">.
 * - Validation is NOT done here: plug-ins may only import contracts, so the kernel runs the
 *   loaded value through K2 (`store.loadProject`) and shows readable errors.
 *
 * Cancelling a picker rejects with an error whose `name` is `"AbortError"`, so callers can
 * ignore it quietly.
 *
 * `list()` returns the files this provider has opened or saved in the current session,
 * most recently used first. The kernel uses it to learn which file the user picked, because
 * `StoredModel` does not carry a ref.
 */

export const LOCAL_FILE_STORAGE_ID = 'local-file';
export const DEFAULT_FILE_NAME = 'threat-model.threatpilot.json';

// ── minimal shapes of the browser APIs we use (not in every lib.dom version) ──

export interface WritableLike {
    write(data: Blob | string): Promise<void>;
    close(): Promise<void>;
}

export interface FileHandleLike {
    readonly name: string;
    getFile(): Promise<File>;
    createWritable?(): Promise<WritableLike>;
}

interface PickerType {
    description: string;
    accept: Record<string, string[]>;
}

export interface LocalFileEnv {
    showOpenFilePicker?: (options: { types: PickerType[]; multiple: false }) => Promise<FileHandleLike[]>;
    showSaveFilePicker?: (options: { suggestedName: string; types: PickerType[] }) => Promise<FileHandleLike>;
    /** Fallback picker for browsers without the File System Access API. */
    pickFile: () => Promise<File>;
    /** Fallback save: trigger a download of `blob` as `fileName`. */
    download: (blob: Blob, fileName: string) => void;
}

const PICKER_TYPES: PickerType[] = [
    { description: 'ThreatPilot model (JSON)', accept: { 'application/json': ['.json'] } },
];

function abortError(): Error {
    const err = new Error('The user cancelled the file picker.');
    err.name = 'AbortError';
    return err;
}

function isAbort(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError';
}

// ── default (browser) environment ────────────────────────────────────────────

function pickWithInput(): Promise<File> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener(
            'change',
            () => {
                const file = input.files?.[0];
                if (file) resolve(file);
                else reject(abortError());
            },
            { once: true },
        );
        // Fired by current browsers when the dialog is dismissed.
        input.addEventListener('cancel', () => reject(abortError()), { once: true });
        input.click();
    });
}

function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    // Give the browser a moment to start the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function browserEnv(): LocalFileEnv {
    const w = globalThis as unknown as Partial<Pick<LocalFileEnv, 'showOpenFilePicker' | 'showSaveFilePicker'>>;
    return {
        showOpenFilePicker: typeof w.showOpenFilePicker === 'function' ? w.showOpenFilePicker.bind(globalThis) : undefined,
        showSaveFilePicker: typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker.bind(globalThis) : undefined,
        pickFile: pickWithInput,
        download: downloadBlob,
    };
}

// ── plug-in ──────────────────────────────────────────────────────────────────

export function createLocalFilePlugin(env: LocalFileEnv = browserEnv()): Storage {
    /** Handles the user granted this session, keyed by file name. Insertion order = MRU (oldest first). */
    const handles = new Map<string, FileHandleLike>();
    /** Names saved through the download fallback (no handle, but still a known file). */
    const recent: string[] = [];

    const touch = (name: string, handle?: FileHandleLike) => {
        if (handle) {
            handles.delete(name);
            handles.set(name, handle);
        }
        const i = recent.indexOf(name);
        if (i !== -1) recent.splice(i, 1);
        recent.unshift(name);
    };

    async function readModel(file: File): Promise<Project> {
        const text = await file.text();
        try {
            // Shape is checked by the kernel (K2) before the model is used.
            return JSON.parse(text) as Project;
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`"${file.name}" is not a valid ThreatPilot file (not valid JSON: ${detail}).`, { cause: err });
        }
    }

    async function writeTo(handle: FileHandleLike, data: string): Promise<boolean> {
        if (!handle.createWritable) return false;
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return true;
    }

    return {
        id: LOCAL_FILE_STORAGE_ID,
        name: 'Local file',
        version: '1.0.0',
        kind: 'storage',
        permissions: [],
        features: { read: true, write: true, remote: false, requiresAuth: false },

        async authenticate() {
            // Nothing to do: local files need no credentials.
        },

        async list(): Promise<StorageRef[]> {
            return recent.map((path) => ({ path }));
        },

        /** An empty `ref.path` (or one we have no handle for) asks the user to pick a file. */
        async open(ref: StorageRef): Promise<StoredModel> {
            const known = ref.path ? handles.get(ref.path) : undefined;
            if (known) {
                const model = await readModel(await known.getFile());
                touch(known.name, known);
                return { model, revision: null };
            }

            if (env.showOpenFilePicker) {
                const [handle] = await env.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
                if (!handle) throw abortError();
                const model = await readModel(await handle.getFile());
                touch(handle.name, handle);
                return { model, revision: null };
            }

            const file = await env.pickFile();
            const model = await readModel(file);
            touch(file.name);
            return { model, revision: null };
        },

        /** Local files have no revisions, so `expectedRevision` is ignored and saves never conflict. */
        async save(ref: StorageRef, model: Project, expectedRevision: Revision | null): Promise<SaveResult> {
            void expectedRevision;
            const data = `${JSON.stringify(model, null, 2)}\n`;
            const fileName = ref.path || DEFAULT_FILE_NAME;

            const known = handles.get(fileName);
            if (known && (await writeTo(known, data))) {
                touch(known.name, known);
                return { ok: true, revision: null };
            }

            if (env.showSaveFilePicker) {
                try {
                    const handle = await env.showSaveFilePicker({ suggestedName: fileName, types: PICKER_TYPES });
                    if (await writeTo(handle, data)) {
                        touch(handle.name, handle);
                        return { ok: true, revision: null };
                    }
                } catch (err) {
                    if (isAbort(err)) throw err;
                    // Permission denied or a sandboxed iframe: fall back to a download below.
                }
            }

            env.download(new Blob([data], { type: 'application/json' }), fileName);
            touch(fileName);
            return { ok: true, revision: null };
        },

        async getRevision(): Promise<Revision | null> {
            return null;
        },
    };
}
