import type { Project } from '@kernel/contracts';

/** A small, valid project used by schema and store tests. */
export function makeSampleProject(): Project {
    const t0 = '2026-11-18T00:00:00.000Z';
    return {
        schemaVersion: 1,
        id: 'p1',
        title: 'Sample',
        owner: 'alice',
        description: 'Sample project',
        reviewers: ['bob'],
        methodologyIds: ['stride'],
        elements: [
            { id: 'e1', type: 'externalEntity', name: 'User', position: { x: 0, y: 0 }, properties: {} },
            { id: 'e2', type: 'process', name: 'API', position: { x: 200, y: 0 }, properties: { authenticated: true } },
            { id: 'e3', type: 'dataStore', name: 'DB', position: { x: 400, y: 0 }, properties: { encrypted: false } },
        ],
        dataFlows: [
            { id: 'f1', name: 'login', sourceId: 'e1', targetId: 'e2', protocol: 'HTTPS', properties: {} },
            { id: 'f2', name: 'query', sourceId: 'e2', targetId: 'e3', properties: {} },
        ],
        trustBoundaries: [{ id: 'b1', name: 'Backend', elementIds: ['e2', 'e3'] }],
        threats: [
            {
                id: 't1',
                title: 'Spoofing of API',
                description: 'An attacker may impersonate the API.',
                category: 'Spoofing',
                methodologyId: 'stride',
                target: { kind: 'element', id: 'e2' },
                origin: 'generated',
                modified: false,
                ruleId: 'r1',
                priority: 'high',
                status: 'open',
                createdAt: t0,
                updatedAt: t0,
            },
        ],
        createdAt: t0,
        updatedAt: t0,
    };
}