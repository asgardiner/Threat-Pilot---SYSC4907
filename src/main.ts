import { KernelEventBus } from "./kernel/eventBus";
import { PluginRegistry } from "./kernel/pluginRegistry";
import { registerPlugins } from "./plugins/index";

// Create the Event Bus
const events = new KernelEventBus();

// Create the Plugin Registry
const registry = new PluginRegistry(events);

// Register the application's plugins
registerPlugins(registry);
