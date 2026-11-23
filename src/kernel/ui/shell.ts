import type { SlotId, SlotRegistry } from './slots';
import './shell.css';

export interface ShellActions {
    onNew(): void;
    onOpen(): void;
    onSave(): void;
    onExport(): void;
    onRefreshThreats(): void;
}

export interface MountShellOptions {
    slots: SlotRegistry;
    actions: ShellActions;
}

const EMPTY_MESSAGES: Record<SlotId, string> = {
    canvas: 'No diagram plug-in is registered.',
    'right-panel': 'No properties panel is registered.',
    threats: 'No threats panel is registered.',
};

const TOOLBAR_BUTTONS: ReadonlyArray<{ label: string; action: keyof ShellActions }> = [
    { label: 'New', action: 'onNew' },
    { label: 'Open', action: 'onOpen' },
    { label: 'Save', action: 'onSave' },
    { label: 'Export', action: 'onExport' },
    { label: 'Refresh threats', action: 'onRefreshThreats' },
];

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'className') node.className = value;
        else if (key === 'textContent') node.textContent = value;
        else node.setAttribute(key, value);
    }
    for (const child of children) {
        node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

function mountSlot(
    host: HTMLElement,
    slot: SlotId,
    slots: SlotRegistry,
    cleanups: Array<() => void>,
): void {
    const contributions = slots.getBySlot(slot);
    if (contributions.length === 0) {
        host.append(el('p', { className: 'tp-slot-empty', textContent: EMPTY_MESSAGES[slot] }));
        return;
    }

    for (const contribution of contributions) {
        const mountPoint = el('div', {
            className: 'tp-slot-host',
            'data-contribution': contribution.id,
        });
        host.append(mountPoint);
        const cleanup = contribution.mount(mountPoint);
        if (typeof cleanup === 'function') cleanups.push(cleanup);
    }
}

/**
 * Builds the app shell (toolbar + plug-in slots) into `root`.
 * Returns a function that unmounts contributions and clears the root.
 */
export function mountShell(root: HTMLElement, options: MountShellOptions): () => void {
    const { slots, actions } = options;
    const cleanups: Array<() => void> = [];

    const skipLinks = el('nav', { className: 'tp-skip-links', 'aria-label': 'Skip links' }, [
        el('a', { className: 'tp-skip-link', href: '#diagram' }, ['Skip to diagram']),
        el('a', { className: 'tp-skip-link', href: '#threats' }, ['Skip to threats']),
    ]);

    const toolbar = el('div', { role: 'toolbar', className: 'tp-toolbar', 'aria-label': 'Project' });
    for (const { label, action } of TOOLBAR_BUTTONS) {
        const button = el('button', { type: 'button' }, [label]);
        button.addEventListener('click', () => {
            actions[action]();
        });
        toolbar.append(button);
    }
    const header = el('header', { className: 'tp-header' }, [toolbar]);

    const canvasSlot = el('div', { className: 'tp-slot', 'data-slot': 'canvas' });
    const rightSlot = el('div', { className: 'tp-slot', 'data-slot': 'right-panel' });
    const threatsSlot = el('div', { className: 'tp-slot', 'data-slot': 'threats' });

    const diagram = el('main', { id: 'diagram', className: 'tp-canvas', 'aria-label': 'Diagram' }, [
        canvasSlot,
    ]);
    const properties = el(
        'aside',
        { id: 'properties', className: 'tp-properties', 'aria-label': 'Properties' },
        [rightSlot],
    );
    const threats = el(
        'section',
        { id: 'threats', className: 'tp-threats', 'aria-label': 'Threats' },
        [threatsSlot],
    );

    const body = el('div', { className: 'tp-body' }, [diagram, properties]);
    const shell = el('div', { className: 'tp-shell' }, [skipLinks, header, body, threats]);

    root.replaceChildren(shell);

    mountSlot(canvasSlot, 'canvas', slots, cleanups);
    mountSlot(rightSlot, 'right-panel', slots, cleanups);
    mountSlot(threatsSlot, 'threats', slots, cleanups);

    return () => {
        for (const cleanup of cleanups.splice(0).reverse()) {
            cleanup();
        }
        root.replaceChildren();
    };
}
