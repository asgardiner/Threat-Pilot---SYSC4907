import { describe, it, expect, vi } from "vitest";
import { PluginRegistry } from "./pluginRegistry";
import { KernelEventBus } from "./eventBus";

describe("PluginRegistry", () => {

    const dummyPlugin = {
        id: "test-methodology",
        name: "Test Methodology",
        version: "1.0.0",
        kind: "methodology",
        permissions: [],
        categories: [],
        rules: [],
        evaluate: () => []
    };

    // Test 1: Register a valid plugin
    it("registers a valid plugin", () => {
        const registry = new PluginRegistry(new KernelEventBus());

        registry.register(dummyPlugin);

        expect(registry.get("test-methodology")).toBe(dummyPlugin);
    });

    // Test 2: Reject duplicate plugin IDs
    it("rejects duplicate plugin IDs", () => {
        const registry = new PluginRegistry(new KernelEventBus());

        registry.register(dummyPlugin);

        expect(() => registry.register(dummyPlugin))
            .toThrow("already exists");
    });

    // Test 3: Enable and disable a plugin
    it("enables and disables a plugin", async () => {
        const registry = new PluginRegistry(new KernelEventBus());

        const activate = vi.fn();
        const deactivate = vi.fn();

        const plugin = {
            ...dummyPlugin,
            activate,
            deactivate
        };

        registry.register(plugin);

        expect(registry.isEnabled(plugin.id)).toBe(false);

        await registry.enable(plugin.id);

        expect(registry.isEnabled(plugin.id)).toBe(true);
        expect(activate).toHaveBeenCalledOnce();

        await registry.disable(plugin.id);

        expect(registry.isEnabled(plugin.id)).toBe(false);
        expect(deactivate).toHaveBeenCalledOnce();
    });

    // Test 4: Do not activate a plugin twice
    it("does not activate a plugin twice", async () => {
        const registry = new PluginRegistry(new KernelEventBus());

        const activate = vi.fn();

        const plugin = {
            ...dummyPlugin,
            activate
        };

        registry.register(plugin);

        await registry.enable(plugin.id);
        await registry.enable(plugin.id);

        expect(activate).toHaveBeenCalledOnce();
        expect(registry.isEnabled(plugin.id)).toBe(true);
    });

    // Test 5: Reject a plugin with an invalid kind
    it("rejects an invalid plugin", () => {
        const registry = new PluginRegistry(new KernelEventBus());

        const invalidPlugin = {
            ...dummyPlugin,
            kind: "pizza"
        };

        expect(() => registry.register(invalidPlugin))
            .toThrow("Invalid plugin kind");
    });

});
