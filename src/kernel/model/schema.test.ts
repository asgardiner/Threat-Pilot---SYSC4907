import { describe, expect, it } from 'vitest';
import { formatValidationErrors, validateModel, validateModelJson } from './schema';
import { makeSampleProject } from './fixtures';

/** Validate a mutated copy of the sample and return the errors (fails the test if it passes). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests deliberately build malformed data
function errorsFor(mutate: (p: any) => void) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = structuredClone(makeSampleProject()) as any;
    mutate(p);
    const result = validateModel(p);
    if (result.ok) throw new Error('expected validation to fail');
    return result.errors;
}

describe('validateModel', () => {
    it('accepts a valid sample project', () => {
        const result = validateModel(makeSampleProject());
        expect(result.ok).toBe(true);
    });

    it('accepts the sample after a JSON round trip', () => {
        const result = validateModelJson(JSON.stringify(makeSampleProject()));
        expect(result.ok).toBe(true);
    });

    it('accepts a project with no diagram content or threats', () => {
        const p = { ...makeSampleProject(), elements: [], dataFlows: [], trustBoundaries: [], threats: [] };
        expect(validateModel(p).ok).toBe(true);
    });

    it('strips unknown keys instead of rejecting them', () => {
        const result = validateModel({ ...makeSampleProject(), futureField: 1 });
        expect(result.ok).toBe(true);
        if (result.ok) expect('futureField' in result.model).toBe(false);
    });

    it('reports invalid JSON text as a single root error', () => {
        const result = validateModelJson('{ "schemaVersion": 1,');
        expect(result).toMatchObject({ ok: false, errors: [{ path: '(root)' }] });
        if (!result.ok) expect(result.errors[0]!.message).toMatch(/not valid JSON/);
    });

    it('rejects non-object input', () => {
        for (const input of [null, 42, 'text', []]) {
            expect(validateModel(input).ok).toBe(false);
        }
    });

    it('reports a missing schemaVersion at the right path', () => {
        const errors = errorsFor((p) => delete p.schemaVersion);
        expect(errors.some((e) => e.path === 'schemaVersion')).toBe(true);
    });

    it('reports an unsupported schemaVersion with a readable message', () => {
        const errors = errorsFor((p) => (p.schemaVersion = 2));
        expect(errors).toEqual([
            { path: 'schemaVersion', message: expect.stringContaining('unsupported schemaVersion 2') },
        ]);
    });

    it('reports wrong types with the full path to the field', () => {
        const errors = errorsFor((p) => (p.elements[1].position.x = 'left'));
        expect(errors.map((e) => e.path)).toContain('elements[1].position.x');
    });

    it('reports an invalid enum value', () => {
        const errors = errorsFor((p) => (p.elements[0].type = 'database'));
        expect(errors.map((e) => e.path)).toContain('elements[0].type');
    });

    it('reports non-primitive property values', () => {
        const errors = errorsFor((p) => (p.elements[0].properties = { nested: { a: 1 } }));
        expect(errors.some((e) => e.path.startsWith('elements[0].properties'))).toBe(true);
    });

    it('reports a bad timestamp', () => {
        const errors = errorsFor((p) => (p.createdAt = 'yesterday'));
        expect(errors).toEqual([{ path: 'createdAt', message: expect.stringContaining('ISO-8601') }]);
    });

    it('reports reference problems only once the basic shape is valid', () => {
        // Zod skips cross-field checks while the structure itself is invalid, so the type error shows first.
        const errors = errorsFor((p) => {
            p.title = 1;
            p.dataFlows[0].sourceId = 'nope';
        });
        expect(errors.map((e) => e.path)).toEqual(['title']);
    });

    it('reports several problems at once', () => {
        const errors = errorsFor((p) => {
            p.title = 42;
            p.owner = undefined;
            p.reviewers = 'bob';
        });
        expect(errors.map((e) => e.path).sort()).toEqual(['owner', 'reviewers', 'title']);
    });

    it('reports duplicate ids', () => {
        const errors = errorsFor((p) => p.threats.push({ ...p.threats[0] }));
        expect(errors).toEqual([{ path: 'threats[1].id', message: 'duplicate id "t1" in threats' }]);
    });

    it('reports a data flow pointing at a missing element', () => {
        const errors = errorsFor((p) => (p.dataFlows[0].targetId = 'nope'));
        expect(errors).toEqual([{ path: 'dataFlows[0].targetId', message: 'refers to unknown element "nope"' }]);
    });

    it('reports a boundary containing a missing element', () => {
        const errors = errorsFor((p) => p.trustBoundaries[0].elementIds.push('ghost'));
        expect(errors).toEqual([
            { path: 'trustBoundaries[0].elementIds[2]', message: 'refers to unknown element "ghost"' },
        ]);
    });

    it('reports a threat whose target is missing', () => {
        const errors = errorsFor((p) => (p.threats[0].target = { kind: 'dataFlow', id: 'e2' }));
        expect(errors).toEqual([{ path: 'threats[0].target.id', message: 'refers to unknown dataFlow "e2"' }]);
    });

    it("requires ruleId on generated threats (but not on user threats)", () => {
        const errors = errorsFor((p) => delete p.threats[0].ruleId);
        expect(errors).toEqual([{ path: 'threats[0].ruleId', message: "is required when origin is 'generated'" }]);

        const p = structuredClone(makeSampleProject());
        delete p.threats[0]!.ruleId;
        p.threats[0]!.origin = 'user';
        expect(validateModel(p).ok).toBe(true);
    });
});

describe('formatValidationErrors', () => {
    it('prints one "path: message" line per error', () => {
        const errors = errorsFor((p) => {
            p.dataFlows[0].sourceId = 'nope';
            p.dataFlows[1].targetId = 'gone';
        });
        const text = formatValidationErrors(errors);
        expect(text.split('\n')).toEqual([
            'dataFlows[0].sourceId: refers to unknown element "nope"',
            'dataFlows[1].targetId: refers to unknown element "gone"',
        ]);
    });
});