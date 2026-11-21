import type { EventBus, KernelEventMap } from "./contracts";

export class KernelEventBus implements EventBus {

    private listeners = new Map<
        keyof KernelEventMap,
        Set<(payload: unknown) => void>
    >();

    on<K extends keyof KernelEventMap>(
        event: K,
        handler: (payload: KernelEventMap[K]) => void
    ): () => void {

        let handlers = this.listeners.get(event);

        if (handlers === undefined) {
            handlers = new Set<(payload: unknown) => void>();
            this.listeners.set(event, handlers);
        }

        const listener = (payload: unknown) => {
            handler(payload as KernelEventMap[K]);
        };

        handlers.add(listener);

        return () => {
            handlers.delete(listener);
        };
    }

    emit<K extends keyof KernelEventMap>(
        event: K,
        payload: KernelEventMap[K]
    ): void {

        const handlers = this.listeners.get(event);

        if (handlers === undefined) {
            return;
        }

        for (const handler of handlers) {
            handler(payload);
        }
    }
}