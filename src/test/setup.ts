/**
 * Vitest setup. Runs before every test file but only does anything in files that opt into
 * jsdom with `// @vitest-environment jsdom`. jsdom lacks a few browser APIs that React Flow
 * relies on, so they are stubbed here.
 */
if (typeof window !== 'undefined') {
    class ResizeObserverStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }

    class DOMMatrixReadOnlyStub {
        m22 = 1;
        constructor(transform?: string) {
            const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
            if (scale) this.m22 = Number(scale);
        }
    }

    const g = globalThis as Record<string, unknown>;
    g.ResizeObserver ??= ResizeObserverStub;
    g.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub;
    // Tells React that `act()` is in use, silencing "not wrapped in act" warnings.
    g.IS_REACT_ACT_ENVIRONMENT = true;
}