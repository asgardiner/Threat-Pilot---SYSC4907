import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
    DataFlow,
    Element,
    EventBus,
    Id,
    Project,
    Threat,
    TrustBoundary,
} from '@kernel/contracts';
import { validateModel, type ValidationResult } from '../model/schema';

/**
 * The single source of truth for the open project.
 *
 * - Immutable updates: every change produces a new `Project` object, so reference
 *   equality is enough for dirty tracking and undo/redo.
 * - `dirty` is `project !== savedProject`, so undoing back to the saved state is clean again.
 * - Every change to the model emits `ModelChanged` on the connected event bus.
 * - Uses zustand/vanilla: no React dependency, usable from the kernel, plug-in glue and tests.
 */

export const HISTORY_LIMIT = 100;

/** Thrown when an action is invalid (unknown id, duplicate id, dangling reference, no project). */
export class ModelError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ModelError';
    }
}

type Patch<T extends { id: Id }> = Partial<Omit<T, 'id'>>;

export interface ModelState {
    project: Project | null;
    /** The project as last loaded or saved. */
    savedProject: Project | null;
    dirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    /** Internal history stacks (project snapshots). Exposed for selectors/devtools only. */
    past: Project[];
    future: Project[];
}

export interface ModelActions {
    /** Validates `input`, then replaces the open project, clears history and dirty state. */
    loadProject(input: unknown): ValidationResult;
    /** Marks the current project as saved (clears `dirty`). Does not emit `ModelChanged`. */
    markSaved(): void;
    /** Closes the project. */
    closeProject(): void;

    addElement(element: Element): void;
    updateElement(id: Id, patch: Patch<Element>): void;
    /** Also removes attached data flows, the element's boundary memberships, and threats targeting any of those. */
    removeElement(id: Id): void;

    addDataFlow(flow: DataFlow): void;
    updateDataFlow(id: Id, patch: Patch<DataFlow>): void;
    /** Also removes threats targeting the flow. */
    removeDataFlow(id: Id): void;

    addTrustBoundary(boundary: TrustBoundary): void;
    updateTrustBoundary(id: Id, patch: Patch<TrustBoundary>): void;
    /** Also removes threats targeting the boundary. */
    removeTrustBoundary(id: Id): void;

    addThreat(threat: Threat): void;
    /**
     * Bumps the threat's `updatedAt`. A user edit of a generated threat also sets
     * `modified: true` (FR 2.3) unless the patch sets `modified` explicitly.
     */
    updateThreat(id: Id, patch: Patch<Threat>): void;
    removeThreat(id: Id): void;

    undo(): void;
    redo(): void;

    /** Subscribe the store to an event bus. Returns a disconnect function. */
    connectEvents(bus: EventBus): () => void;
}

export type ModelStore = ModelState & ModelActions;

export interface ModelStoreOptions {
    /** Event bus to emit `ModelChanged` on. Can also be attached later via `connectEvents`. */
    events?: EventBus;
    /** Injectable clock, for deterministic tests. */
    now?: () => string;
}

export function createModelStore(options: ModelStoreOptions = {}): StoreApi<ModelStore> {
    let bus: EventBus | undefined = options.events;
    const now = options.now ?? (() => new Date().toISOString());

    return createStore<ModelStore>()((set, get) => {
        const requireProject = (): Project => {
            const { project } = get();
            if (!project) throw new ModelError('No project is open');
            return project;
        };

        const emit = (project: Project) => bus?.emit('ModelChanged', { project });

        /** Apply a new project as an undoable change. */
        const commit = (next: Project) => {
            const { project, past, savedProject } = get();
            const stamped: Project = { ...next, updatedAt: now() };
            const newPast = project ? [...past, project].slice(-HISTORY_LIMIT) : past;
            set({
                project: stamped,
                past: newPast,
                future: [],
                dirty: stamped !== savedProject,
                canUndo: newPast.length > 0,
                canRedo: false,
            });
            emit(stamped);
        };

        const exists = (items: ReadonlyArray<{ id: Id }>, id: Id) => items.some((i) => i.id === id);

        const requireUnique = (kind: string, items: ReadonlyArray<{ id: Id }>, id: Id) => {
            if (exists(items, id)) throw new ModelError(`${kind} "${id}" already exists`);
        };
        const requireExisting = (kind: string, items: ReadonlyArray<{ id: Id }>, id: Id) => {
            if (!exists(items, id)) throw new ModelError(`${kind} "${id}" does not exist`);
        };

        const checkFlowRefs = (p: Project, flow: Pick<DataFlow, 'sourceId' | 'targetId'>) => {
            requireExisting('Element', p.elements, flow.sourceId);
            requireExisting('Element', p.elements, flow.targetId);
        };
        const checkBoundaryRefs = (p: Project, b: Pick<TrustBoundary, 'elementIds'>) => {
            b.elementIds.forEach((eid) => requireExisting('Element', p.elements, eid));
        };
        const checkThreatTarget = (p: Project, target: Threat['target']) => {
            const pool =
                target.kind === 'element' ? p.elements : target.kind === 'dataFlow' ? p.dataFlows : p.trustBoundaries;
            requireExisting(`Threat target ${target.kind}`, pool, target.id);
        };

        const patchItem = <T extends { id: Id }>(items: T[], id: Id, patch: Patch<T>, extra?: (item: T) => Partial<T>): T[] =>
            items.map((item) => (item.id === id ? { ...item, ...patch, ...extra?.(item), id } : item));

        const dropThreatsFor = (threats: Threat[], kind: Threat['target']['kind'], ids: ReadonlySet<Id>) =>
            threats.filter((t) => !(t.target.kind === kind && ids.has(t.target.id)));

        return {
            project: null,
            savedProject: null,
            dirty: false,
            canUndo: false,
            canRedo: false,
            past: [],
            future: [],

            loadProject(input) {
                const result = validateModel(input);
                if (result.ok) {
                    set({
                        project: result.model,
                        savedProject: result.model,
                        dirty: false,
                        past: [],
                        future: [],
                        canUndo: false,
                        canRedo: false,
                    });
                    emit(result.model);
                }
                return result;
            },

            markSaved() {
                const project = requireProject();
                set({ savedProject: project, dirty: false });
            },

            closeProject() {
                set({ project: null, savedProject: null, dirty: false, past: [], future: [], canUndo: false, canRedo: false });
            },

            // ── elements ───────────────────────────────────────────────────────────
            addElement(element) {
                const p = requireProject();
                requireUnique('Element', p.elements, element.id);
                commit({ ...p, elements: [...p.elements, element] });
            },
            updateElement(id, patch) {
                const p = requireProject();
                requireExisting('Element', p.elements, id);
                commit({ ...p, elements: patchItem(p.elements, id, patch) });
            },
            removeElement(id) {
                const p = requireProject();
                requireExisting('Element', p.elements, id);
                const removedFlows = new Set(
                    p.dataFlows.filter((f) => f.sourceId === id || f.targetId === id).map((f) => f.id),
                );
                let threats = dropThreatsFor(p.threats, 'element', new Set([id]));
                threats = dropThreatsFor(threats, 'dataFlow', removedFlows);
                commit({
                    ...p,
                    elements: p.elements.filter((e) => e.id !== id),
                    dataFlows: p.dataFlows.filter((f) => !removedFlows.has(f.id)),
                    trustBoundaries: p.trustBoundaries.map((b) =>
                        b.elementIds.includes(id) ? { ...b, elementIds: b.elementIds.filter((e) => e !== id) } : b,
                    ),
                    threats,
                });
            },

            // ── data flows ─────────────────────────────────────────────────────────
            addDataFlow(flow) {
                const p = requireProject();
                requireUnique('Data flow', p.dataFlows, flow.id);
                checkFlowRefs(p, flow);
                commit({ ...p, dataFlows: [...p.dataFlows, flow] });
            },
            updateDataFlow(id, patch) {
                const p = requireProject();
                const current = p.dataFlows.find((f) => f.id === id);
                if (!current) throw new ModelError(`Data flow "${id}" does not exist`);
                checkFlowRefs(p, { ...current, ...patch });
                commit({ ...p, dataFlows: patchItem(p.dataFlows, id, patch) });
            },
            removeDataFlow(id) {
                const p = requireProject();
                requireExisting('Data flow', p.dataFlows, id);
                commit({
                    ...p,
                    dataFlows: p.dataFlows.filter((f) => f.id !== id),
                    threats: dropThreatsFor(p.threats, 'dataFlow', new Set([id])),
                });
            },

            // ── trust boundaries ───────────────────────────────────────────────────
            addTrustBoundary(boundary) {
                const p = requireProject();
                requireUnique('Trust boundary', p.trustBoundaries, boundary.id);
                checkBoundaryRefs(p, boundary);
                commit({ ...p, trustBoundaries: [...p.trustBoundaries, boundary] });
            },
            updateTrustBoundary(id, patch) {
                const p = requireProject();
                requireExisting('Trust boundary', p.trustBoundaries, id);
                if (patch.elementIds) checkBoundaryRefs(p, { elementIds: patch.elementIds });
                commit({ ...p, trustBoundaries: patchItem(p.trustBoundaries, id, patch) });
            },
            removeTrustBoundary(id) {
                const p = requireProject();
                requireExisting('Trust boundary', p.trustBoundaries, id);
                commit({
                    ...p,
                    trustBoundaries: p.trustBoundaries.filter((b) => b.id !== id),
                    threats: dropThreatsFor(p.threats, 'trustBoundary', new Set([id])),
                });
            },

            // ── threats ────────────────────────────────────────────────────────────
            addThreat(threat) {
                const p = requireProject();
                requireUnique('Threat', p.threats, threat.id);
                checkThreatTarget(p, threat.target);
                commit({ ...p, threats: [...p.threats, threat] });
            },
            updateThreat(id, patch) {
                const p = requireProject();
                const current = p.threats.find((t) => t.id === id);
                if (!current) throw new ModelError(`Threat "${id}" does not exist`);
                if (patch.target) checkThreatTarget(p, patch.target);
                const stamp = now();
                commit({
                    ...p,
                    threats: patchItem(p.threats, id, patch, (t) => ({
                        updatedAt: stamp,
                        ...(t.origin === 'generated' && patch.modified === undefined ? { modified: true } : {}),
                    })),
                });
            },
            removeThreat(id) {
                const p = requireProject();
                requireExisting('Threat', p.threats, id);
                commit({ ...p, threats: p.threats.filter((t) => t.id !== id) });
            },

            // ── history ────────────────────────────────────────────────────────────
            undo() {
                const { project, past, future, savedProject } = get();
                if (!project || past.length === 0) return;
                const previous = past[past.length - 1]!;
                const newPast = past.slice(0, -1);
                const newFuture = [project, ...future];
                set({
                    project: previous,
                    past: newPast,
                    future: newFuture,
                    dirty: previous !== savedProject,
                    canUndo: newPast.length > 0,
                    canRedo: true,
                });
                emit(previous);
            },
            redo() {
                const { project, past, future, savedProject } = get();
                if (!project || future.length === 0) return;
                const [next, ...rest] = future;
                const newPast = [...past, project];
                set({
                    project: next!,
                    past: newPast,
                    future: rest,
                    dirty: next !== savedProject,
                    canUndo: true,
                    canRedo: rest.length > 0,
                });
                emit(next!);
            },

            connectEvents(newBus) {
                bus = newBus;
                return () => {
                    if (bus === newBus) bus = undefined;
                };
            },
        };
    });
}

/** The app-wide store. Tests should create their own with `createModelStore()`. */
export const modelStore = createModelStore();