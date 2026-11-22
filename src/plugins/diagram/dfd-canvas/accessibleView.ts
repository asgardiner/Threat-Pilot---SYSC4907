import type { DiagramState, ElementType } from '@kernel/contracts';

const TYPE_LABELS: Record<ElementType, string> = {
    process: 'Process',
    dataStore: 'Data store',
    externalEntity: 'External entity',
};

function section(doc: Document, title: string, items: string[], emptyText: string): HTMLElement {
    const wrap = doc.createElement('section');
    const heading = doc.createElement('h3');
    heading.textContent = `${title} (${items.length})`;
    wrap.append(heading);

    if (items.length === 0) {
        const p = doc.createElement('p');
        p.textContent = emptyText;
        wrap.append(p);
        return wrap;
    }

    const list = doc.createElement('ul');
    for (const text of items) {
        const li = doc.createElement('li');
        li.textContent = text;
        list.append(li);
    }
    wrap.append(list);
    return wrap;
}

/**
 * Non-visual equivalent of the canvas (NFR 2, WCAG 2.1 AA): the same diagram as plain lists.
 * Uses `textContent` only, so element names can never inject markup.
 */
export function renderAccessibleView(root: HTMLElement, state: DiagramState): void {
    const doc = root.ownerDocument;
    const names = new Map(state.elements.map((e) => [e.id, e.name]));
    const nameOf = (id: string) => names.get(id) ?? id;

    const elements = state.elements.map((e) => `${e.name} (${TYPE_LABELS[e.type]})`);
    const flows = state.dataFlows.map((f) => {
        const extras = [f.protocol, f.dataClassification].filter(Boolean).join(', ');
        return `${f.name}: ${nameOf(f.sourceId)} to ${nameOf(f.targetId)}${extras ? ` (${extras})` : ''}`;
    });
    const boundaries = state.trustBoundaries.map(
        (b) => `${b.name}: ${b.elementIds.map(nameOf).join(', ') || 'no elements'}`,
    );

    root.setAttribute('aria-label', 'Diagram contents as text');
    root.replaceChildren(
        section(doc, 'Elements', elements, 'No elements yet.'),
        section(doc, 'Data flows', flows, 'No data flows yet.'),
        section(doc, 'Trust boundaries', boundaries, 'No trust boundaries.'),
    );
}