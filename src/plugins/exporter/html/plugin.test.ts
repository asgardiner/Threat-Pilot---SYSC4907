/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import type { Project, Threat } from '@kernel/contracts';
import { createHtmlExporterPlugin } from './plugin';
import { esc } from './render';

const T = '2026-11-23T12:00:00.000Z';

function threat(overrides: Partial<Threat>): Threat {
    return {
        id: 't',
        title: 'Threat',
        description: '',
        category: 'Spoofing',
        methodologyId: 'stride',
        target: { kind: 'element', id: 'e1' },
        origin: 'generated',
        modified: false,
        ruleId: 'r1',
        priority: 'medium',
        status: 'open',
        createdAt: T,
        updatedAt: T,
        ...overrides,
    };
}

function project(threats: Threat[] = []): Project {
    return {
        schemaVersion: 1,
        id: 'p1',
        title: 'Shop & Co',
        owner: 'sammy',
        description: 'Checkout service',
        reviewers: ['jumana', 'syed'],
        methodologyIds: ['stride'],
        elements: [
            { id: 'e1', type: 'externalEntity', name: 'Browser', position: { x: 0, y: 0 }, properties: {} },
            { id: 'e2', type: 'process', name: 'API', position: { x: 1, y: 0 }, properties: {} },
            { id: 'e3', type: 'dataStore', name: 'DB', position: { x: 2, y: 0 }, properties: {} },
        ],
        dataFlows: [{ id: 'f1', name: 'query', sourceId: 'e2', targetId: 'e3', protocol: 'TLS', properties: {} }],
        trustBoundaries: [{ id: 'b1', name: 'Backend', elementIds: ['e2', 'e3'] }],
        threats,
        createdAt: T,
        updatedAt: T,
    };
}

async function exportDoc(model: Project, options?: Parameters<ReturnType<typeof createHtmlExporterPlugin>['render']>[1]) {
    const plugin = createHtmlExporterPlugin({ now: () => new Date(T) });
    const blob = await plugin.render(model, options);
    const html = await blob.text();
    return { blob, html, doc: new DOMParser().parseFromString(html, 'text/html') };
}

describe('HTML exporter plug-in', () => {
    it('declares an html exporter with read-only model access', () => {
        const plugin = createHtmlExporterPlugin();
        expect(plugin).toMatchObject({ kind: 'exporter', format: 'html', mimeType: 'text/html' });
        expect(plugin.permissions).toEqual([{ type: 'model', access: 'read' }]);
    });

    it('produces one self-contained HTML file: no external resources, no scripts', async () => {
        const { blob, html, doc } = await exportDoc(project([threat({})]));
        expect(blob.type).toBe('text/html;charset=utf-8');
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(doc.querySelectorAll('script, link, img, iframe').length).toBe(0);
        expect(html).not.toMatch(/(src|href)=["']https?:/);
        const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content');
        expect(csp).toContain("default-src 'none'");
    });

    it('includes project metadata', async () => {
        const { doc } = await exportDoc(project());
        expect(doc.querySelector('h1')?.textContent).toBe('Shop & Co');
        const meta = doc.querySelector('.meta')?.textContent ?? '';
        expect(meta).toContain('sammy');
        expect(meta).toContain('jumana, syed');
        expect(meta).toContain('stride');
    });

    it('lists every element with its type, boundary and threat count', async () => {
        const { doc } = await exportDoc(project([threat({ id: 'a', target: { kind: 'element', id: 'e2' } })]));
        const rows = [...doc.querySelectorAll('table')]
            .find((t) => t.querySelector('caption')?.textContent?.startsWith('Elements'))!
            .querySelectorAll('tbody tr');
        const cells = [...rows].map((r) => [...r.children].map((c) => c.textContent?.trim()));
        expect(cells).toEqual([
            ['Browser', 'External entity', '', '—', '0'],
            ['API', 'Process', '', 'Backend', '1'],
            ['DB', 'Data store', '', 'Backend', '0'],
        ]);
    });

    it('groups threats by target in diagram order, sorted by priority, with orphans last', async () => {
        const { doc } = await exportDoc(
            project([
                threat({ id: '1', title: 'Low on API', priority: 'low', target: { kind: 'element', id: 'e2' } }),
                threat({ id: '2', title: 'Critical on API', priority: 'critical', target: { kind: 'element', id: 'e2' } }),
                threat({ id: '3', title: 'On browser', target: { kind: 'element', id: 'e1' } }),
                threat({ id: '4', title: 'On flow', target: { kind: 'dataFlow', id: 'f1' } }),
                threat({ id: '5', title: 'Lost', target: { kind: 'element', id: 'gone' } }),
            ]),
        );
        const groups = [...doc.querySelectorAll('section.group')].map((g) => ({
            heading: g.querySelector('h3')?.firstChild?.textContent?.trim(),
            threats: [...g.querySelectorAll('h4')].map((h) => h.textContent),
        }));
        expect(groups).toEqual([
            { heading: 'Browser', threats: ['On browser'] },
            { heading: 'API', threats: ['Critical on API', 'Low on API'] },
            { heading: 'query', threats: ['On flow'] },
            { heading: 'Orphaned threats', threats: ['Lost'] },
        ]);
    });

    it('shows priority, mitigation status and mitigation text for each threat', async () => {
        const { doc } = await exportDoc(
            project([threat({ priority: 'high', status: 'in-progress', mitigation: 'Use parameterised queries' })]),
        );
        const article = doc.querySelector('article.threat')!;
        expect(article.textContent).toContain('High');
        expect(article.textContent).toContain('In progress');
        expect(article.querySelector('.mitigation')?.textContent).toContain('Use parameterised queries');
    });

    it('renders a <script> title as text, never as markup (acceptance)', async () => {
        const evil = '<script>alert("x")</script>';
        const model = project([threat({ title: evil, description: '<img src=x onerror=alert(1)>', mitigation: '"><b>' })]);
        model.title = evil;
        model.elements[0]!.name = '</td><script>bad()</script>';

        const { html, doc } = await exportDoc(model);
        expect(doc.querySelectorAll('script, img, b').length).toBe(0);
        expect(doc.querySelector('h4')?.textContent).toBe(evil);
        expect(doc.querySelector('h1')?.textContent).toBe(evil);
        expect(html).not.toContain('<script>');
    });

    it('can leave out mitigated threats and says so', async () => {
        const model = project([threat({ id: 'a', title: 'Done', status: 'mitigated' }), threat({ id: 'b', title: 'Todo' })]);
        const all = await exportDoc(model);
        expect([...all.doc.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(['Done', 'Todo']);

        const open = await exportDoc(model, { includeMitigated: false });
        expect([...open.doc.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(['Todo']);
        expect(open.doc.querySelector('.note')?.textContent).toContain('1 mitigated threat is not shown');
    });

    it('uses the locale for <html lang> and survives an invalid one', async () => {
        expect((await exportDoc(project(), { locale: 'fr-CA' })).doc.documentElement.lang).toBe('fr-CA');
        expect((await exportDoc(project(), { locale: '"><x' })).doc.documentElement.lang).toBe('en');
    });

    it('handles an empty project', async () => {
        const model = project();
        model.elements = [];
        model.dataFlows = [];
        model.trustBoundaries = [];
        const { doc } = await exportDoc(model);
        expect(doc.body.textContent).toContain('No elements in this diagram.');
        expect(doc.body.textContent).toContain('No threats to report.');
    });
});

describe('esc', () => {
    it('escapes all five HTML-significant characters', () => {
        expect(esc(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    });
});
