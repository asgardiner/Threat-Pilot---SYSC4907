import type {
    DataFlow,
    Element as DfdElement,
    ExportOptions,
    MitigationStatus,
    Priority,
    Project,
    Threat,
    TrustBoundary,
} from '@kernel/contracts';

/**
 * Pure HTML rendering for the E1 exporter (issue #26).
 *
 * Security: every piece of model data goes through `esc()`. On top of that, the document
 * ships a CSP that forbids scripts entirely, so even an escaping bug cannot execute code
 * when the report is opened.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low'];
const STATUS_ORDER: MitigationStatus[] = ['open', 'in-progress', 'mitigated', 'accepted'];

const ELEMENT_TYPE_LABEL: Record<DfdElement['type'], string> = {
    process: 'Process',
    dataStore: 'Data store',
    externalEntity: 'External entity',
};

const STATUS_LABEL: Record<MitigationStatus, string> = {
    open: 'Open',
    'in-progress': 'In progress',
    mitigated: 'Mitigated',
    accepted: 'Accepted',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface RenderEnv {
    /** Timestamp printed as "Generated". Injectable for deterministic tests. */
    now?: () => Date;
}

function dateFormatter(locale: string | undefined): (iso: string) => string {
    let fmt: Intl.DateTimeFormat;
    try {
        fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
    } catch {
        fmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
    }
    return (iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? iso : `${fmt.format(d)} UTC`;
    };
}

/** BCP-47-ish tag for <html lang>; anything odd falls back to "en". */
function langTag(locale: string | undefined): string {
    return locale && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : 'en';
}

interface Group {
    heading: string;
    subheading: string;
    threats: Threat[];
}

function sortThreats(threats: Threat[]): Threat[] {
    return [...threats].sort(
        (a, b) =>
            PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
            a.title.localeCompare(b.title),
    );
}

/** Threats grouped by the diagram item they target, in diagram order; unknown targets last. */
function groupThreats(model: Readonly<Project>, threats: Threat[]): Group[] {
    const byKey = new Map<string, Threat[]>();
    for (const t of threats) {
        const key = `${t.target.kind}:${t.target.id}`;
        byKey.set(key, [...(byKey.get(key) ?? []), t]);
    }
    const take = (key: string) => {
        const list = byKey.get(key) ?? [];
        byKey.delete(key);
        return list;
    };

    const elementName = (id: string) => model.elements.find((e) => e.id === id)?.name ?? id;
    const groups: Group[] = [];
    const push = (heading: string, subheading: string, list: Threat[]) => {
        if (list.length > 0) groups.push({ heading, subheading, threats: sortThreats(list) });
    };

    model.elements.forEach((e) => push(e.name || e.id, ELEMENT_TYPE_LABEL[e.type], take(`element:${e.id}`)));
    model.dataFlows.forEach((f) =>
        push(f.name || f.id, `Data flow: ${elementName(f.sourceId)} → ${elementName(f.targetId)}`, take(`dataFlow:${f.id}`)),
    );
    model.trustBoundaries.forEach((b) => push(b.name || b.id, 'Trust boundary', take(`trustBoundary:${b.id}`)));

    const orphaned = [...byKey.values()].flat();
    push('Orphaned threats', 'Their diagram item no longer exists', orphaned);
    return groups;
}

function boundariesOf(element: DfdElement, boundaries: readonly TrustBoundary[]): string {
    const names = boundaries.filter((b) => b.elementIds.includes(element.id)).map((b) => b.name);
    return names.length ? names.join(', ') : '—';
}

function threatCount(threats: readonly Threat[], kind: Threat['target']['kind'], id: string): number {
    return threats.filter((t) => t.target.kind === kind && t.target.id === id).length;
}

function renderMeta(model: Readonly<Project>, fmt: (iso: string) => string, generated: string): string {
    const rows: Array<[string, string]> = [
        ['Owner', model.owner || '—'],
        ['Reviewers', model.reviewers.length ? model.reviewers.join(', ') : '—'],
        ['Methodologies', model.methodologyIds.length ? model.methodologyIds.join(', ') : '—'],
        ['Created', fmt(model.createdAt)],
        ['Last updated', fmt(model.updatedAt)],
        ['Report generated', generated],
    ];
    return `<dl class="meta">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

function renderSummary(threats: readonly Threat[]): string {
    const count = <K extends 'priority' | 'status'>(key: K, value: Threat[K]) =>
        threats.filter((t) => t[key] === value).length;
    const head = PRIORITY_ORDER.map((p) => `<th scope="col">${esc(cap(p))}</th>`).join('');
    const pri = PRIORITY_ORDER.map((p) => `<td>${count('priority', p)}</td>`).join('');
    const sHead = STATUS_ORDER.map((s) => `<th scope="col">${esc(STATUS_LABEL[s])}</th>`).join('');
    const sta = STATUS_ORDER.map((s) => `<td>${count('status', s)}</td>`).join('');
    return `
<table>
  <caption>Threats by priority (${threats.length} total)</caption>
  <thead><tr>${head}</tr></thead><tbody><tr>${pri}</tr></tbody>
</table>
<table>
  <caption>Threats by mitigation status</caption>
  <thead><tr>${sHead}</tr></thead><tbody><tr>${sta}</tr></tbody>
</table>`;
}

function renderElements(model: Readonly<Project>): string {
    if (model.elements.length === 0) return '<p>No elements in this diagram.</p>';
    const rows = model.elements
        .map(
            (e) => `<tr>
  <th scope="row">${esc(e.name || e.id)}</th>
  <td>${esc(ELEMENT_TYPE_LABEL[e.type])}</td>
  <td>${esc(e.description ?? '')}</td>
  <td>${esc(boundariesOf(e, model.trustBoundaries))}</td>
  <td>${threatCount(model.threats, 'element', e.id)}</td>
</tr>`,
        )
        .join('');
    return `<table>
  <caption>Elements (${model.elements.length})</caption>
  <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Description</th><th scope="col">Trust boundary</th><th scope="col">Threats</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderFlows(model: Readonly<Project>): string {
    if (model.dataFlows.length === 0) return '';
    const name = (id: string) => model.elements.find((e) => e.id === id)?.name ?? id;
    const rows = model.dataFlows
        .map(
            (f: DataFlow) => `<tr>
  <th scope="row">${esc(f.name || f.id)}</th>
  <td>${esc(name(f.sourceId))}</td>
  <td>${esc(name(f.targetId))}</td>
  <td>${esc(f.protocol ?? '—')}</td>
  <td>${esc(f.dataClassification ?? '—')}</td>
</tr>`,
        )
        .join('');
    return `<table>
  <caption>Data flows (${model.dataFlows.length})</caption>
  <thead><tr><th scope="col">Name</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Protocol</th><th scope="col">Data classification</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderThreat(t: Threat): string {
    const origin = t.origin === 'user' ? 'User-added' : t.modified ? 'Generated, edited' : 'Generated';
    return `<article class="threat priority-${esc(t.priority)}">
  <h4>${esc(t.title)}</h4>
  <dl class="tags">
    <dt>Priority</dt><dd class="badge">${esc(cap(t.priority))}</dd>
    <dt>Status</dt><dd class="badge">${esc(STATUS_LABEL[t.status] ?? t.status)}</dd>
    <dt>Category</dt><dd>${esc(t.category)}</dd>
    <dt>Methodology</dt><dd>${esc(t.methodologyId)}</dd>
    <dt>Origin</dt><dd>${esc(origin)}</dd>
  </dl>
  ${t.description ? `<p>${esc(t.description)}</p>` : ''}
  <p class="mitigation"><strong>Mitigation:</strong> ${t.mitigation ? esc(t.mitigation) : '<em>none recorded</em>'}</p>
</article>`;
}

function renderThreats(groups: Group[]): string {
    if (groups.length === 0) return '<p>No threats to report.</p>';
    return groups
        .map(
            (g) => `<section class="group">
  <h3>${esc(g.heading)} <span class="sub">${esc(g.subheading)} · ${g.threats.length} threat${g.threats.length === 1 ? '' : 's'}</span></h3>
  ${g.threats.map(renderThreat).join('\n')}
</section>`,
        )
        .join('\n');
}

const STYLES = `
:root { color-scheme: light; }
body { font: 15px/1.5 system-ui, sans-serif; color: #1a1a1a; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
h1 { margin-bottom: 0.25rem; }
h2 { border-bottom: 2px solid #d0d0d0; padding-bottom: 0.25rem; margin-top: 2rem; }
h3 .sub { font-weight: normal; font-size: 0.85rem; color: #555; }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; }
.meta dt { font-weight: 600; }
.meta dd { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
caption { text-align: left; font-weight: 600; padding-bottom: 0.25rem; }
th, td { border: 1px solid #d0d0d0; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
thead th { background: #f0f0f0; }
.threat { border: 1px solid #d0d0d0; border-left: 6px solid #888; border-radius: 4px; padding: 0.5rem 0.75rem; margin: 0.75rem 0; break-inside: avoid; }
.threat h4 { margin: 0 0 0.25rem; }
.priority-critical { border-left-color: #8b0000; }
.priority-high { border-left-color: #c5221f; }
.priority-medium { border-left-color: #b06000; }
.priority-low { border-left-color: #1e8e3e; }
.tags { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; margin: 0; font-size: 0.9rem; }
.tags dt { color: #555; }
.tags dt::after { content: ':'; }
.tags dd { margin: 0 0.5rem 0 0; }
.badge { font-weight: 600; }
.note { color: #555; font-style: italic; }
@media print { body { margin: 0; max-width: none; } }
`;

export function renderHtml(model: Readonly<Project>, options: ExportOptions = {}, env: RenderEnv = {}): string {
    const includeMitigated = options.includeMitigated ?? true;
    const fmt = dateFormatter(options.locale);
    const generated = fmt((env.now?.() ?? new Date()).toISOString());

    const threats = includeMitigated ? [...model.threats] : model.threats.filter((t) => t.status !== 'mitigated');
    const hidden = model.threats.length - threats.length;
    const title = model.title || 'Untitled threat model';

    return `<!DOCTYPE html>
<html lang="${esc(langTag(options.locale))}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="ThreatPilot">
<title>${esc(title)} — Threat model report</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  ${model.description ? `<p>${esc(model.description)}</p>` : ''}
  ${renderMeta(model, fmt, generated)}
</header>
<main>
  <section aria-labelledby="summary-h">
    <h2 id="summary-h">Summary</h2>
    ${renderSummary(threats)}
    ${hidden > 0 ? `<p class="note">${hidden} mitigated threat${hidden === 1 ? ' is' : 's are'} not shown in this report.</p>` : ''}
  </section>
  <section aria-labelledby="inventory-h">
    <h2 id="inventory-h">Element inventory</h2>
    ${renderElements(model)}
    ${renderFlows(model)}
  </section>
  <section aria-labelledby="threats-h">
    <h2 id="threats-h">Threats by element</h2>
    ${renderThreats(groupThreats(model, threats))}
  </section>
</main>
</body>
</html>
`;
}
