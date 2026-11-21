import type { Plugin } from "../kernel/contracts";

const plugins: Plugin[] = [];

export function registerPlugins(registry: { register(plugin: Plugin): void }): void {
    for (const plugin of plugins) {
        registry.register(plugin);
    }
}
