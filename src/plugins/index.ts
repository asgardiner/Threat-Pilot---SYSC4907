import type { Plugin } from "../kernel/contracts";
import { createHtmlExporterPlugin } from "./exporter/html";
import { createLocalFilePlugin } from "./storage/local-file";

const plugins: Plugin[] = [createLocalFilePlugin(), createHtmlExporterPlugin()];

export function registerPlugins(registry: { register(plugin: Plugin): void }): void {
    for (const plugin of plugins) {
        registry.register(plugin);
    }
}
