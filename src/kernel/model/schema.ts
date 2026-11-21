import { z } from 'zod';
import type { Project } from '@kernel/contracts';

/**
 * Runtime schema for a ThreatPilot project (the JSON that is saved / loaded).
 *
 * The TypeScript types live in contracts.ts and are the source of truth; this file
 * must stay in sync with them. The compile-time checks at the bottom fail `tsc`
 * if the two ever drift apart.
 *
 * Unknown keys are stripped (not rejected) so files written by a newer minor
 * version of the app can still be opened. Bump SCHEMA_VERSION and add a migration
 * for anything breaking.
 */

export const SCHEMA_VERSION = 1;

// ── primitives ───────────────────────────────────────────────────────────────

const id = z.string().min(1, 'must be a non-empty string');
const isoDateTime = z.iso.datetime({ message: 'must be an ISO-8601 timestamp (e.g. 2026-11-18T14:30:00.000Z)' });

const position = z.object({ x: z.number(), y: z.number() });
const properties = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

// ── diagram ──────────────────────────────────────────────────────────────────

export const elementSchema = z.object({
    id,
    type: z.enum(['process', 'dataStore', 'externalEntity']),
    name: z.string(),
    description: z.string().optional(),
    position,
    properties,
});

export const dataFlowSchema = z.object({
    id,
    name: z.string(),
    sourceId: id,
    targetId: id,
    protocol: z.string().optional(),
    dataClassification: z.string().optional(),
    properties,
});

export const trustBoundarySchema = z.object({
    id,
    name: z.string(),
    elementIds: z.array(id),
});

// ── threats ──────────────────────────────────────────────────────────────────

export const threatSchema = z
    .object({
        id,
        title: z.string(),
        description: z.string(),
        category: z.string(),
        methodologyId: id,
        target: z.object({ kind: z.enum(['element', 'dataFlow', 'trustBoundary']), id }),
        origin: z.enum(['generated', 'user']),
        modified: z.boolean(),
        ruleId: id.optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']),
        status: z.enum(['open', 'in-progress', 'mitigated', 'accepted']),
        mitigation: z.string().optional(),
        createdAt: isoDateTime,
        updatedAt: isoDateTime,
    })
    .refine((t) => t.origin !== 'generated' || t.ruleId !== undefined, {
        path: ['ruleId'],
        message: "is required when origin is 'generated'",
    });

// ── project ──────────────────────────────────────────────────────────────────

export const projectSchema = z
    .object({
        schemaVersion: z.literal(SCHEMA_VERSION, {
            error: (issue) =>
                `unsupported schemaVersion ${JSON.stringify(issue.input)}; this version of ThreatPilot reads schemaVersion ${SCHEMA_VERSION}`,
        }),
        id,
        title: z.string(),
        owner: z.string(),
        description: z.string(),
        reviewers: z.array(z.string()),
        methodologyIds: z.array(id),
        elements: z.array(elementSchema),
        dataFlows: z.array(dataFlowSchema),
        trustBoundaries: z.array(trustBoundarySchema),
        threats: z.array(threatSchema),
        createdAt: isoDateTime,
        updatedAt: isoDateTime,
    })
    .superRefine((p, ctx) => {
        const problem = (path: (string | number)[], message: string) =>
            ctx.addIssue({ code: 'custom', path, message });

        // Unique ids within each collection.
        const checkUnique = (key: 'elements' | 'dataFlows' | 'trustBoundaries' | 'threats') => {
            const seen = new Set<string>();
            p[key].forEach((item, i) => {
                if (seen.has(item.id)) problem([key, i, 'id'], `duplicate id "${item.id}" in ${key}`);
                seen.add(item.id);
            });
        };
        checkUnique('elements');
        checkUnique('dataFlows');
        checkUnique('trustBoundaries');
        checkUnique('threats');

        // References must resolve.
        const elementIds = new Set(p.elements.map((e) => e.id));
        const flowIds = new Set(p.dataFlows.map((f) => f.id));
        const boundaryIds = new Set(p.trustBoundaries.map((b) => b.id));

        p.dataFlows.forEach((f, i) => {
            if (!elementIds.has(f.sourceId)) problem(['dataFlows', i, 'sourceId'], `refers to unknown element "${f.sourceId}"`);
            if (!elementIds.has(f.targetId)) problem(['dataFlows', i, 'targetId'], `refers to unknown element "${f.targetId}"`);
        });

        p.trustBoundaries.forEach((b, i) => {
            b.elementIds.forEach((eid, j) => {
                if (!elementIds.has(eid)) problem(['trustBoundaries', i, 'elementIds', j], `refers to unknown element "${eid}"`);
            });
        });

        const targetIds = { element: elementIds, dataFlow: flowIds, trustBoundary: boundaryIds };
        p.threats.forEach((t, i) => {
            if (!targetIds[t.target.kind].has(t.target.id)) {
                problem(['threats', i, 'target', 'id'], `refers to unknown ${t.target.kind} "${t.target.id}"`);
            }
        });
    });

// ── validation API ───────────────────────────────────────────────────────────

export interface ValidationError {
    /** Where the problem is, e.g. `elements[2].position.x`. `(root)` for the whole document. */
    path: string;
    message: string;
}

export type ValidationResult =
    | { ok: true; model: Project }
    | { ok: false; errors: ValidationError[] };

export function formatPath(path: ReadonlyArray<PropertyKey>): string {
    if (path.length === 0) return '(root)';
    return path.reduce<string>((acc, seg) => {
        if (typeof seg === 'number') return `${acc}[${seg}]`;
        const s = String(seg);
        return acc === '' ? s : `${acc}.${s}`;
    }, '');
}

/** One line per error: `elements[0].name: Invalid input: expected string, received number`. */
export function formatValidationErrors(errors: ReadonlyArray<ValidationError>): string {
    return errors.map((e) => `${e.path}: ${e.message}`).join('\n');
}

/** Validate an already-parsed value (e.g. the result of `JSON.parse`). Never throws. */
export function validateModel(input: unknown): ValidationResult {
    const result = projectSchema.safeParse(input);
    if (result.success) return { ok: true, model: result.data };
    return {
        ok: false,
        errors: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
    };
}

/** Parse and validate raw JSON text. Syntax errors are reported as a single root error. */
export function validateModelJson(text: string): ValidationResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { ok: false, errors: [{ path: '(root)', message: `not valid JSON: ${detail}` }] };
    }
    return validateModel(parsed);
}

// ── compile-time sync with contracts.ts ──────────────────────────────────────
// If these stop compiling, the schema and the contract have drifted.
type Inferred = z.infer<typeof projectSchema>;
type AssertAssignable<A extends B, B> = A extends B ? true : never;
export type _SchemaMatchesContract = AssertAssignable<Inferred, Project>;
// schemaVersion is `number` in the contract but the literal 1 here, so compare everything else.
export type _ContractMatchesSchema = AssertAssignable<Omit<Project, 'schemaVersion'>, Omit<Inferred, 'schemaVersion'>>;