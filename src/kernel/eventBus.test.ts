import { describe, it, expect } from "vitest";
import { KernelEventBus } from "./eventBus";

describe("Event Bus", () => {
    it("notifies a subscribed listener", () => {
        const bus = new KernelEventBus();
        const results: number[] = [];

        bus.on("ThreatsRefreshed", (info) => {
            results.push(info.added);
        });

        bus.emit("ThreatsRefreshed", {
            added: 3,
            preserved: 2,
            removed: 1
        });

        expect(results).toEqual([3]);
    });

    it("unsubscribes only the selected listener", () => {
        const bus = new KernelEventBus();

        const results: string[] = [];

        const unsubscribe1 = bus.on("ThreatsRefreshed", () => {
            results.push("A");
        });

        bus.on("ThreatsRefreshed", () => {
            results.push("B");
        });

        unsubscribe1();

        bus.emit("ThreatsRefreshed", {
            added: 3,
            preserved: 2,
            removed: 1
        });

        expect(results).toEqual(["B"]);
    });
});