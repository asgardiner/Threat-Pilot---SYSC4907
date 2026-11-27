import type { Diagram, DiagramState } from './kernel/contracts';
import { KernelEventBus } from './kernel/eventBus';
import { PluginRegistry } from './kernel/pluginRegistry';
import { modelStore } from './kernel/state/store';
import { mountShell } from './kernel/ui/shell';
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

const stubActions = {
    onNew() {
        /* wired in K3 / storage tickets */
    },
    onOpen() {
        /* wired in storage tickets */
    },
    onSave() {
        /* wired in storage tickets */
    },
    onExport() {
        /* wired in exporter tickets */
    },
    onRefreshThreats() {
        /* wired in threat manager / threats panel tickets */
    },
};

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

async function boot(): Promise<void> {
    await registerDiagramSlot();

    const root = document.getElementById('root');
    if (!root) throw new Error('#root is missing');

    mountShell(root, { slots, actions: stubActions });
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
