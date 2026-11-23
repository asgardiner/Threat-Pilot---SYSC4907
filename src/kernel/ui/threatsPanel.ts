import type { StoreApi } from 'zustand/vanilla';
import type { ModelStore } from '../state/store';

/**
 * Placeholder threats panel for the shell slot (issue #22).
 * Full table / edit / refresh UI lands in issue #23.
 */
export function mountThreatsPanel(
    container: HTMLElement,
    store: StoreApi<ModelStore>,
): () => void {
    const root = document.createElement('div');
    root.className = 'tp-threats-panel';
    root.setAttribute('aria-live', 'polite');

    const heading = document.createElement('h2');
    heading.textContent = 'Threats';
    heading.style.cssText = 'margin: 0.75rem 1rem 0.25rem; font-size: 1rem;';

    const status = document.createElement('p');
    status.className = 'tp-slot-empty';
    status.style.margin = '0.25rem 1rem 1rem';

    root.append(heading, status);
    container.replaceChildren(root);

    const render = () => {
        const project = store.getState().project;
        if (!project) {
            status.textContent = 'No project is open.';
            return;
        }
        const count = project.threats.length;
        status.textContent =
            count === 0
                ? 'No threats yet. Use Refresh threats once a methodology is enabled.'
                : `${count} threat${count === 1 ? '' : 's'} in this project.`;
    };

    render();
    const unsubscribe = store.subscribe(render);

    return () => {
        unsubscribe();
        container.replaceChildren();
    };
}
