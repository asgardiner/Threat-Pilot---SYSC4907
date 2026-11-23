import { describe, expect, it } from 'vitest';
import type { Methodology, Project } from './contracts';
import { runRules } from './rule-engine';

function makeDefaultProject(): Project {
  return {
    schemaVersion: 1,
    id: 'Project-1',
    title: 'Sample Online shopping project',
    owner: 'Jumana',
    description: 'Sample project to test rule engine',
    reviewers: [],
    methodologyIds: ['fake-stride'],
    elements: [
      {
        id: 'el-checkout',
        type: 'process',
        name: 'Checkout service',
        position: { x: 100, y: 100 },
        properties: { authenticated: false },
      },
      {
        id: 'el-database',
        type: 'dataStore',
        name: 'Orders database',
        position: { x: 200, y: 100 },
        properties: { encrypted: true },
      },
    ],
    dataFlows: [
      {
        id: 'df-1',
        name: 'Checkout to order',
        sourceId: 'el-checkout',
        targetId: 'el-database',
        protocol: 'HTTPS',
        dataClassification: 'PII',
        properties: {},
      },
    ],
    trustBoundaries: [
      {
        id: 'tb-1',
        name: 'Backend network',
        elementIds: ['el-checkout', 'el-database'],
      },
    ],
    threats: [],
    createdAt: '2026-11-21T08:40:00.000Z',
    updatedAt: '2026-11-21T08:40:00.000Z',
  };
}

const fakeMethodology: Methodology = {
  id: 'fake-stride',
  name: 'Fake Stride',
  version: '1.0.0',
  kind: 'methodology',
  permissions: [],
  categories: ['Spoofing'],
  rules: [
    {
      id: 'rule-unauthenticated-process',
      name: 'Unauthenticated process',
      description: 'Flags processes without authentication enabled',
      category: 'Spoofing',
      appliesTo: ['element'],
    },
  ],
  evaluate(target) {
    if (target.kind === 'element' && target.item.properties.authenticated === false) {
      return [
        {
          ruleId: 'rule-unauthenticated-process',
          title: `Missing auth on ${target.item.name}`,
          description: `${target.item.name} does not require authentication`,
          category: 'Spoofing',
          priority: 'high',
          mitigation: 'Enforce authentication before processing requests',
        },
      ];
    }
    return [];
  },
};

describe('runRules (R1)', () => {
  it('completes drafts from enabled methodology plugins into generated threats', async () => {
    const project = makeDefaultProject();
    const threats = await runRules(project, [fakeMethodology]);

    expect(threats).toHaveLength(1);
    expect(threats[0]).toMatchObject({
      title: 'Missing auth on Checkout service',
      category: 'Spoofing',
      methodologyId: 'fake-stride',
      ruleId: 'rule-unauthenticated-process',
      target: { kind: 'element', id: 'el-checkout' },
      origin: 'generated',
      modified: false,
      status: 'open',
      priority: 'high',
    });
    expect(threats[0].id).toBeTruthy();
    expect(threats[0].createdAt).toBe(threats[0].updatedAt);
  });

  it('skips methodology plugins not listed in project.methodologyIds', async () => {
    const project = makeDefaultProject();
    project.methodologyIds = ['other-methodology'];

    const threats = await runRules(project, [fakeMethodology]);

    expect(threats).toEqual([]);
  });
});