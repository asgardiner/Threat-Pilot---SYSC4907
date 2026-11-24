import type { Exporter } from '@kernel/contracts';
import { renderHtml, type RenderEnv } from './render';

/** E1: HTML exporter (FR 5, partial; issue #26). A single self-contained, offline HTML file. */
export const HTML_EXPORTER_ID = 'html-exporter';

export function createHtmlExporterPlugin(env: RenderEnv = {}): Exporter {
    return {
        id: HTML_EXPORTER_ID,
        name: 'HTML report',
        version: '1.0.0',
        kind: 'exporter',
        permissions: [{ type: 'model', access: 'read' }],
        format: 'html',
        mimeType: 'text/html',
        async render(model, options) {
            return new Blob([renderHtml(model, options, env)], { type: 'text/html;charset=utf-8' });
        },
    };
}
