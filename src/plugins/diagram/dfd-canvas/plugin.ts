import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
    Diagram,
    DiagramState,
    Permission,
    PluginContext,
    Project,
} from '@kernel/contracts';
import { renderAccessibleView } from './accessibleView';
import { diagramEquals } from './convert';
import { DfdCanvas, type ExternalSync } from './DfdCanvas';

const EMPTY_STATE: DiagramState = { elements: [], dataFlows: [], trustBoundaries: [] };

const diagramOf = (project: Project): DiagramState => ({
    elements: project.elements,
    dataFlows: project.dataFlows,
    trustBoundaries: project.trustBoundaries,
});

type ChangeHandler = (state: DiagramState) => void;

/**
 * DFD canvas: the `Diagram` plug-in, built on React Flow.
 *
 * Data flow (the plug-in never touches the state store directly, per docs/conventions.md):
 *  - read:  `mount(container, state)` gives the initial diagram; afterwards `ModelChanged` on the
 *           event bus (from `PluginContext`) tells it about changes made elsewhere (undo, load).
 *  - write: every user edit is reported through `onChange`; the kernel applies it to the store.
 */
export class DfdCanvasPlugin implements Diagram {
    readonly id = 'dfd-canvas';
    readonly name = 'DFD Canvas';
    readonly version = '0.1.0';
    readonly kind = 'diagram' as const;
    readonly permissions: Permission[] = [
        { type: 'model', access: 'read' },
        { type: 'model', access: 'write' },
    ];

    private context: PluginContext | undefined;
    private root: Root | undefined;
    private stopModelEvents: (() => void) | undefined;
    private view: HTMLElement | undefined;

    /** What the canvas currently shows. Used to ignore events that change nothing visible. */
    private current: DiagramState = EMPTY_STATE;
    private readonly changeHandlers = new Set<ChangeHandler>();
    private readonly externalListeners = new Set<ChangeHandler>();
    /** True while our own `onChange` handlers run, so their echo on the bus is ignored. */
    private notifying = false;

    private readonly external: ExternalSync = {
        subscribe: (listener) => {
            this.externalListeners.add(listener);
            return () => this.externalListeners.delete(listener);
        },
    };

    activate(context: PluginContext): void {
        this.context = context;
    }

    deactivate(): void {
        this.unmount();
        this.context = undefined;
    }

    mount(container: HTMLElement, state: DiagramState): void {
        this.unmount();
        this.current = state;
        this.refreshAccessibleView();

        this.stopModelEvents = this.context?.events.on('ModelChanged', ({ project }) => this.receive(project));

        this.root = createRoot(container);
        this.root.render(
            createElement(DfdCanvas, { initialState: state, onCommit: this.commit, external: this.external }),
        );
    }

    unmount(): void {
        this.stopModelEvents?.();
        this.stopModelEvents = undefined;
        this.root?.unmount();
        this.root = undefined;
        this.externalListeners.clear();
    }

    onChange(handler: ChangeHandler): () => void {
        this.changeHandlers.add(handler);
        return () => {
            this.changeHandlers.delete(handler);
        };
    }

    getAccessibleView(): HTMLElement {
        this.view ??= document.createElement('section');
        return this.view;
    }

    /** The canvas reports a user edit. */
    private readonly commit = (state: DiagramState): void => {
        if (diagramEquals(state, this.current)) return;
        this.current = state;
        this.refreshAccessibleView();

        this.notifying = true;
        try {
            for (const handler of [...this.changeHandlers]) {
                try {
                    handler(state);
                } catch (error) {
                    // A failing subscriber must not break the canvas or the other subscribers.
                    console.error('[dfd-canvas] onChange handler failed', error);
                }
            }
        } finally {
            this.notifying = false;
        }
    };

    /** The model changed. Only act if it changed something this canvas shows and did not cause. */
    private receive(project: Project): void {
        if (this.notifying) return;
        const incoming = diagramOf(project);
        if (diagramEquals(incoming, this.current)) return;
        this.current = incoming;
        this.refreshAccessibleView();
        for (const listener of [...this.externalListeners]) listener(incoming);
    }

    private refreshAccessibleView(): void {
        renderAccessibleView(this.getAccessibleView(), this.current);
    }
}

export function createDfdCanvasPlugin(): Diagram {
    return new DfdCanvasPlugin();
}