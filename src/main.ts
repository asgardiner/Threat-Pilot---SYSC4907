import type { Diagram, DiagramState, Plugin } from './kernel/contracts';
import { bindDiagram } from "./kernel/diagramBinding";
import { KernelEventBus } from './kernel/eventBus';
import { SCHEMA_VERSION } from "./kernel/model/schema";
import { PluginRegistry } from './kernel/pluginRegistry';
import { modelStore } from './kernel/state/store';
import { createProjectIO } from './kernel/services/projectIO';
import { downloadBlob } from './kernel/services/download';
import { createNotice } from './kernel/ui/notice';
import { mountShell, type ShellActions } from './kernel/ui/shell';
import { SlotRegistry } from './kernel/ui/slots';
import { mountThreatsPanel } from './kernel/ui/threatsPanel';
import { registerPlugins } from './plugins/index';

const events = new KernelEventBus();
const registry = new PluginRegistry(events);

registerPlugins(registry);
modelStore.getState().connectEvents(events);

const slots = new SlotRegistry();

slots.add({
    id: 'threats-panel',
    slot: 'threats',
    mount(container) {
        return mountThreatsPanel(container, modelStore);
    },
});

const notice = createNotice();

const io = createProjectIO({
    store: modelStore,
    events,
    notify: (message, kind) => notice.show(message, kind),
    download: downloadBlob,
    confirmDiscard: () => window.confirm('You have unsaved changes. Discard them?'),
});

/** First registered plug-in of a kind. A picker can replace this once there is more than one. */
const first = <K extends 'storage' | 'exporter'>(kind: K) =>
    registry.getByKind(kind).find((p): p is Extract<Plugin, { kind: K }> => p.kind === kind);

function withPlugin<P>(plugin: P | undefined, what: string, run: (p: P) => Promise<void>): void {
    if (!plugin) {
        notice.show(`No ${what} plug-in is registered.`, 'error');
        return;
    }
    void run(plugin);
}

const actions: ShellActions = {
    onNew() {
        // Minimal blank project until K3 (#14) adds the project manager.
        io.newProject();
    },
    onOpen() {
        withPlugin(first('storage'), 'storage', (s) => io.open(s));
    },
    onSave() {
        withPlugin(first('storage'), 'storage', (s) => io.save(s));
    },
    onExport() {
        withPlugin(first('exporter'), 'exporter', (e) => io.exportWith(e));
    },
    onRefreshThreats() {
        /* wired in threat manager / threats panel tickets */
    },
};

// Warn before leaving with unsaved changes (S1 acceptance: save, reload, open).
window.addEventListener('beforeunload', (event) => {
    if (modelStore.getState().dirty) event.preventDefault();
});

function diagramStateFromStore(): DiagramState {
    const project = modelStore.getState().project;
    if (!project) {
        return { elements: [], dataFlows: [], trustBoundaries: [] };
    }
    return {
        elements: project.elements,
        dataFlows: project.dataFlows,
        trustBoundaries: project.trustBoundaries,
    };
}

/**
 * Mount a Diagram plug-in into the canvas slot when one is registered.
 * Uses a visual host + accessible sibling so createRoot(container) does not
 * wipe the accessible view (D1 pattern).
 */
async function registerDiagramSlot(): Promise<void> {
    const diagram = registry.getByKind('diagram').find((p): p is Diagram => p.kind === 'diagram');
    if (!diagram) return;

    await registry.enable(diagram.id);

    slots.add({
        id: diagram.id,
        slot: 'canvas',
        mount(container) {
            const visual = document.createElement('div');
            visual.style.cssText = 'flex:1;min-height:0;height:100%;';
            const accessible = document.createElement('div');
            accessible.className = 'tp-diagram-accessible';
            container.replaceChildren(visual, accessible);

            diagram.mount(visual, diagramStateFromStore());
            accessible.append(diagram.getAccessibleView());
            const stop = diagram.onChange(() => {
                /* store writes land with bindDiagram once D1 merges */
            });

            return () => {
                stop();
                diagram.unmount();
            };
        },
    });
}

async function enableIoPlugins(): Promise<void> {
    for (const plugin of [...registry.getByKind('storage'), ...registry.getByKind('exporter')]) {
        try {
            await registry.enable(plugin.id);
        } catch (err) {
            console.error(`Plug-in "${plugin.id}" failed to start`, err);
        }
    }
}

async function boot(): Promise<void> {
    for (const [what, start] of [
        ['Storage / exporter', enableIoPlugins],
        ['Diagram', registerDiagramSlot],
    ] as const) {
        try {
            await start();
        } catch (err) {
            // Still show the shell; empty slots and toolbar notices explain what's missing.
            console.error(`${what} plug-in failed to start`, err);
        }
    }

    const root = document.getElementById('root');
    if (!root) throw new Error('#root is missing');

    mountShell(root, { slots, actions, notice: notice.element });
}

void boot();

if (import.meta.env.DEV) {
    (window as unknown as { threatpilot: unknown }).threatpilot = {
        store: modelStore,
        events,
        registry,
        slots,
    };
}

// Let the state store announce `ModelChanged` on the bus.
modelStore.getState().connectEvents(events);

// TEMPORARY: open an empty project and show the diagram canvas full-screen.
// The real shell (project picker, storage, panels) replaces this in later tickets.
const now = new Date().toISOString();
modelStore.getState().loadProject({
    schemaVersion: SCHEMA_VERSION,
    id: "draft",
    title: "Untitled",
    owner: "",
    description: "",
    reviewers: [],
    methodologyIds: [],
    elements: [],
    dataFlows: [],
    trustBoundaries: [],
    threats: [],
    createdAt: now,
    updatedAt: now,
});

async function showDiagram(): Promise<void> {
    const diagram = registry.getByKind("diagram").find((p): p is Diagram => p.kind === "diagram");
    const container = document.getElementById("root");
    if (!diagram || !container) throw new Error("Diagram plug-in or #root is missing");

    await registry.enable(diagram.id);
    bindDiagram({ diagram, container, store: modelStore });
}

void showDiagram();

// Dev-only handle for inspecting the store from the browser console.
if (import.meta.env.DEV) {
    (window as unknown as { threatpilot: unknown }).threatpilot = { store: modelStore, events };
}