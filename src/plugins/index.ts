import type { Plugin } from "../kernel/contracts";
import type { PluginRegistry } from "../kernel/pluginRegistry";

const plugins: Plugin[] = [];

export function registerPlugins(registry: PluginRegistry): void {
    for (const plugin of plugins) {
        registry.register(plugin);
    }
}
