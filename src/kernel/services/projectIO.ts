import type { StoreApi } from 'zustand/vanilla';
import type { EventBus, Exporter, ExportOptions, Id, Project, Revision, Storage, StorageRef } from '../contracts';
import { SCHEMA_VERSION, formatValidationErrors } from '../model/schema';
import type { ModelStore } from '../state/store';

/**
 * Kernel glue between the toolbar, the model store and storage / exporter plug-ins (I1).
 *
 * The kernel never imports a plug-in: callers pass in whichever `Storage` / `Exporter`
 * the registry resolved. Everything a plug-in loads goes through K2 (`store.loadProject`)
 * before it reaches the model, so a bad file is reported, not crashed on.
 */

export type NoticeKind = 'info' | 'error';

export interface ProjectIODeps {
    store: StoreApi<ModelStore>;
    events?: EventBus;
    notify(message: string, kind: NoticeKind): void;
    download(blob: Blob, fileName: string): void;
    /** Asked before discarding unsaved changes. Return true to continue. */
    confirmDiscard(): boolean;
    newId?: () => Id;
    now?: () => string;
}

export interface ProjectIO {
    newProject(): void;
    open(storage: Storage): Promise<void>;
    save(storage: Storage): Promise<void>;
    exportWith(exporter: Exporter, options?: ExportOptions): Promise<void>;
    /** Where the open project was loaded from / last saved to, if anywhere. */
    readonly current: Readonly<{ storageId: Id; ref: StorageRef; revision: Revision | null }> | null;
}

/** Max validation problems listed in one notice; the rest are summarised. */
export const MAX_LISTED_ERRORS = 5;

export function fileSlug(title: string): string {
    const slug = title
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return slug || 'threat-model';
}

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createProjectIO(deps: ProjectIODeps): ProjectIO {
    const { store, notify } = deps;
    const now = deps.now ?? (() => new Date().toISOString());
    const newId = deps.newId ?? (() => crypto.randomUUID());
    let current: { storageId: Id; ref: StorageRef; revision: Revision | null } | null = null;

    const okToDiscard = () => !store.getState().dirty || deps.confirmDiscard();

    /** Storage refs don't come back from open/save, so ask the provider which file it used. */
    const lastRef = async (storage: Storage, fallback: StorageRef): Promise<StorageRef> => {
        try {
            return (await storage.list())[0] ?? fallback;
        } catch {
            return fallback;
        }
    };

    return {
        get current() {
            return current;
        },

        newProject() {
            if (!okToDiscard()) return;
            const t = now();
            const blank: Project = {
                schemaVersion: SCHEMA_VERSION,
                id: newId(),
                title: 'Untitled threat model',
                owner: '',
                description: '',
                reviewers: [],
                methodologyIds: [],
                elements: [],
                dataFlows: [],
                trustBoundaries: [],
                threats: [],
                createdAt: t,
                updatedAt: t,
            };
            store.getState().loadProject(blank);
            current = null;
            notify('Started a new threat model.', 'info');
        },

        async open(storage) {
            if (!okToDiscard()) return;
            let stored;
            try {
                await storage.authenticate();
                stored = await storage.open({ path: '' });
            } catch (err) {
                if (!isAbort(err)) notify(`Could not open the file. ${messageOf(err)}`, 'error');
                return;
            }

            const result = store.getState().loadProject(stored.model);
            if (!result.ok) {
                const listed = result.errors.slice(0, MAX_LISTED_ERRORS);
                const more = result.errors.length - listed.length;
                notify(
                    `This file isn't a valid ThreatPilot model, so nothing was loaded ` +
                        `(${result.errors.length} problem${result.errors.length === 1 ? '' : 's'}):\n` +
                        formatValidationErrors(listed) +
                        (more > 0 ? `\n…and ${more} more.` : ''),
                    'error',
                );
                return;
            }

            current = { storageId: storage.id, ref: await lastRef(storage, { path: '' }), revision: stored.revision };
            notify(`Opened "${result.model.title}".`, 'info');
        },

        async save(storage) {
            const snapshot = store.getState().project;
            if (!snapshot) {
                notify('There is no project to save. Create or open one first.', 'error');
                return;
            }
            const sameStorage = current?.storageId === storage.id;
            const ref = sameStorage && current!.ref.path ? current!.ref : { path: `${fileSlug(snapshot.title)}.threatpilot.json` };
            const expected = sameStorage ? current!.revision : null;

            deps.events?.emit('SaveRequested', { storageId: storage.id, ref });
            let result;
            try {
                await storage.authenticate();
                result = await storage.save(ref, snapshot, expected);
            } catch (err) {
                if (!isAbort(err)) notify(`Could not save. ${messageOf(err)}`, 'error');
                return;
            }

            if (!result.ok) {
                notify(
                    'Not saved: the file changed somewhere else since you opened it. Reopen it to see the latest version.',
                    'error',
                );
                return;
            }

            // Only clear `dirty` if nothing changed while the save was in flight.
            if (store.getState().project === snapshot) store.getState().markSaved();
            current = { storageId: storage.id, ref: await lastRef(storage, ref), revision: result.revision };
            notify(`Saved "${snapshot.title}".`, 'info');
        },

        async exportWith(exporter, options) {
            const project = store.getState().project;
            if (!project) {
                notify('There is no project to export. Create or open one first.', 'error');
                return;
            }
            try {
                const blob = await exporter.render(project, options);
                deps.download(blob, `${fileSlug(project.title)}.${exporter.format}`);
                notify(`Exported "${project.title}" as ${exporter.format.toUpperCase()}.`, 'info');
            } catch (err) {
                notify(`Export failed. ${messageOf(err)}`, 'error');
            }
        },
    };
}
