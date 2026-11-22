import type { Diagram } from "./kernel/contracts";
import { bindDiagram } from "./kernel/diagramBinding";
import { KernelEventBus } from "./kernel/eventBus";
import { SCHEMA_VERSION } from "./kernel/model/schema";
import { PluginRegistry } from "./kernel/pluginRegistry";
import { modelStore } from "./kernel/state/store";
import { registerPlugins } from "./plugins/index";

// Create the Event Bus
const events = new KernelEventBus();

// Create the Plugin Registry
const registry = new PluginRegistry(events);

// Register the application's plugins
registerPlugins(registry);

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