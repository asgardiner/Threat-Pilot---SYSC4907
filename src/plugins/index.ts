import type { Plugin } from "../kernel/contracts";
import { createDfdCanvasPlugin } from "./diagram/dfd-canvas";

const plugins: Plugin[] = [createDfdCanvasPlugin()];

export function registerPlugins(registry: { register(plugin: Plugin): void }): void {
    for (const plugin of plugins) {
        registry.register(plugin);
    }
}