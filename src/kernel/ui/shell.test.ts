/** @vitest-environment happy-dom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountShell, type ShellActions } from './shell';
import { SlotRegistry } from './slots';

function stubActions(overrides: Partial<ShellActions> = {}): ShellActions {
    return {
        onNew: vi.fn(),
        onOpen: vi.fn(),
        onSave: vi.fn(),
        onExport: vi.fn(),
        onRefreshThreats: vi.fn(),
        ...overrides,
    };
}

describe('mountShell', () => {
    let root: HTMLElement;

    beforeEach(() => {
        document.body.innerHTML = '';
        root = document.createElement('div');
        root.id = 'root';
        document.body.append(root);
    });

    it('renders toolbar buttons that invoke the matching actions', () => {
        const actions = stubActions();
        mountShell(root, { slots: new SlotRegistry(), actions });

        const buttons = [...root.querySelectorAll('.tp-toolbar button')].map((b) => b.textContent);
        expect(buttons).toEqual(['New', 'Open', 'Save', 'Export', 'Refresh threats']);

        const byLabel = (label: string) =>
            [...root.querySelectorAll('.tp-toolbar button')].find((b) => b.textContent === label) as HTMLButtonElement;

        byLabel('New').click();
        byLabel('Open').click();
        byLabel('Save').click();
        byLabel('Export').click();
        byLabel('Refresh threats').click();

        expect(actions.onNew).toHaveBeenCalledOnce();
        expect(actions.onOpen).toHaveBeenCalledOnce();
        expect(actions.onSave).toHaveBeenCalledOnce();
        expect(actions.onExport).toHaveBeenCalledOnce();
        expect(actions.onRefreshThreats).toHaveBeenCalledOnce();
    });

    it('mounts fake canvas and threats contributions into their landmarks', () => {
        const slots = new SlotRegistry();
        slots.add({
            id: 'fake-diagram',
            slot: 'canvas',
            mount(container) {
                container.textContent = 'canvas-mounted';
            },
        });
        slots.add({
            id: 'fake-threats',
            slot: 'threats',
            mount(container) {
                container.textContent = 'threats-mounted';
            },
        });

        mountShell(root, { slots, actions: stubActions() });

        const diagram = root.querySelector('#diagram');
        const threats = root.querySelector('#threats');
        expect(diagram?.getAttribute('aria-label')).toBe('Diagram');
        expect(threats?.getAttribute('aria-label')).toBe('Threats');
        expect(diagram?.textContent).toContain('canvas-mounted');
        expect(threats?.textContent).toContain('threats-mounted');
        expect(root.querySelector('#properties')?.getAttribute('aria-label')).toBe('Properties');
    });

    it('exposes skip links that target the diagram and threats landmarks', () => {
        mountShell(root, { slots: new SlotRegistry(), actions: stubActions() });

        const links = [...root.querySelectorAll('.tp-skip-link')] as HTMLAnchorElement[];
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['#diagram', '#threats']);
        expect(links.map((a) => a.textContent)).toEqual(['Skip to diagram', 'Skip to threats']);
        expect(root.querySelector('#diagram')).toBeTruthy();
        expect(root.querySelector('#threats')).toBeTruthy();
    });

    it('shows empty messages when no contributions are registered', () => {
        mountShell(root, { slots: new SlotRegistry(), actions: stubActions() });

        expect(root.textContent).toContain('No diagram plug-in is registered.');
        expect(root.textContent).toContain('No properties panel is registered.');
        expect(root.textContent).toContain('No threats panel is registered.');
    });

    it('runs contribution cleanups on unmount and clears the root', () => {
        const cleanup = vi.fn();
        const slots = new SlotRegistry();
        slots.add({
            id: 'fake-diagram',
            slot: 'canvas',
            mount() {
                return cleanup;
            },
        });

        const unmount = mountShell(root, { slots, actions: stubActions() });
        expect(root.children.length).toBeGreaterThan(0);

        unmount();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(root.children.length).toBe(0);
    });
});

describe('mountShell isolation', () => {
    it('keeps mounting other slots when one contribution throws, and tolerates failing cleanups', () => {
        document.body.innerHTML = '<div id="root"></div>';
        const root = document.getElementById('root')!;
        const okCleanup = vi.fn();
        const slots = new SlotRegistry();
        slots.add({ id: 'broken', slot: 'canvas', mount() { throw new Error('boom'); } });
        slots.add({ id: 'bad-cleanup', slot: 'right-panel', mount() { return () => { throw new Error('cleanup boom'); }; } });
        slots.add({ id: 'ok', slot: 'threats', mount(c) { c.textContent = 'threats-ok'; return okCleanup; } });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        const unmount = mountShell(root, { slots, actions: stubActions() });
        expect(root.querySelector('#diagram [role="alert"]')?.textContent).toContain('"broken" failed to load.');
        expect(root.querySelector('#threats')?.textContent).toContain('threats-ok');

        unmount();
        expect(okCleanup).toHaveBeenCalledOnce();
        expect(root.children.length).toBe(0);
        error.mockRestore();
    });

    it('makes skip-link targets focusable', () => {
        document.body.innerHTML = '<div id="root"></div>';
        const root = document.getElementById('root')!;
        mountShell(root, { slots: new SlotRegistry(), actions: stubActions() });
        expect(root.querySelector('#diagram')?.getAttribute('tabindex')).toBe('-1');
        expect(root.querySelector('#threats')?.getAttribute('tabindex')).toBe('-1');
    });
});

describe('SlotRegistry', () => {
    it('rejects duplicate contribution ids', () => {
        const slots = new SlotRegistry();
        slots.add({ id: 'a', slot: 'canvas', mount() {} });
        expect(() => slots.add({ id: 'a', slot: 'threats', mount() {} })).toThrow(
            /already exists/,
        );
    });

    it('filters contributions by slot', () => {
        const slots = new SlotRegistry();
        slots.add({ id: 'c', slot: 'canvas', mount() {} });
        slots.add({ id: 't', slot: 'threats', mount() {} });
        expect(slots.getBySlot('canvas').map((c) => c.id)).toEqual(['c']);
        expect(slots.get('t')?.slot).toBe('threats');
    });
});
