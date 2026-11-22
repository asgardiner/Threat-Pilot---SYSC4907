import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type {
    DataFlow,
    DiagramState,
    Element,
    ElementType,
    Id,
    Properties,
    TrustBoundary,
} from '@kernel/contracts';

/**
 * Pure helpers that translate between the kernel's `DiagramState` and React Flow's
 * nodes/edges. No React, no DOM: everything here is unit-testable in plain Node.
 *
 * React Flow is only a *view*. The kernel model is the source of truth, so every field of the
 * model that the canvas does not edit (description, properties, protocol, ...) is carried in
 * `data` and written back unchanged, otherwise a canvas edit would silently erase it.
 */

export type ElementData = {
    name: string;
    description?: string;
    properties: Properties;
};

export type FlowData = {
    name: string;
    protocol?: string;
    dataClassification?: string;
    properties: Properties;
};

/** React Flow node whose `type` is the model's ElementType, so one registry serves both. */
export type DfdNode = Node<ElementData, ElementType>;
export type DfdEdge = Edge<FlowData>;

export const ELEMENT_LABELS: Record<ElementType, string> = {
    process: 'Process',
    dataStore: 'Data store',
    externalEntity: 'External entity',
};

export const FLOW_LABEL = 'Flow';

// ── model → React Flow ───────────────────────────────────────────────────────

export function toFlowNode(element: Element): DfdNode {
    const data: ElementData = { name: element.name, properties: { ...element.properties } };
    if (element.description !== undefined) data.description = element.description;
    return {
        id: element.id,
        type: element.type,
        position: { x: element.position.x, y: element.position.y },
        data,
    };
}

export function toFlowEdge(flow: DataFlow): DfdEdge {
    const data: FlowData = { name: flow.name, properties: { ...flow.properties } };
    if (flow.protocol !== undefined) data.protocol = flow.protocol;
    if (flow.dataClassification !== undefined) data.dataClassification = flow.dataClassification;
    return {
        id: flow.id,
        source: flow.sourceId,
        target: flow.targetId,
        label: flow.name,
        markerEnd: { type: MarkerType.ArrowClosed },
        data,
    };
}

// ── React Flow → model ───────────────────────────────────────────────────────

/**
 * Builds a `DiagramState` from the canvas. Anything that would be a dangling reference is
 * dropped, mirroring what the store does when an element is removed:
 *  - edges whose source or target node no longer exists,
 *  - trust-boundary members that no longer exist.
 * This matters because React Flow reports a node removal and its edge removals separately.
 */
export function fromFlow(
    nodes: ReadonlyArray<DfdNode>,
    edges: ReadonlyArray<DfdEdge>,
    boundaries: ReadonlyArray<TrustBoundary>,
): DiagramState {
    const nodeIds = new Set(nodes.map((n) => n.id));

    const elements = nodes.map((n): Element => {
        const element: Element = {
            id: n.id,
            type: n.type ?? 'process',
            name: n.data.name,
            position: { x: n.position.x, y: n.position.y },
            properties: { ...n.data.properties },
        };
        if (n.data.description !== undefined) element.description = n.data.description;
        return element;
    });

    const dataFlows = edges
        .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
        .map((e): DataFlow => {
            const data = e.data ?? { name: FLOW_LABEL, properties: {} };
            const flow: DataFlow = {
                id: e.id,
                name: data.name,
                sourceId: e.source,
                targetId: e.target,
                properties: { ...data.properties },
            };
            if (data.protocol !== undefined) flow.protocol = data.protocol;
            if (data.dataClassification !== undefined) flow.dataClassification = data.dataClassification;
            return flow;
        });

    const trustBoundaries = boundaries.map(
        (b): TrustBoundary => ({ ...b, elementIds: b.elementIds.filter((id) => nodeIds.has(id)) }),
    );

    return { elements, dataFlows, trustBoundaries };
}

// ── creating things ──────────────────────────────────────────────────────────

/** "Process 1", "Process 2", ... the first number not already taken. */
export function nextName(base: string, taken: Iterable<string>): string {
    const used = new Set(taken);
    let n = 1;
    while (used.has(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
}

export function newId(prefix: string): Id {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

/**
 * Turns a user-drawn connection into a new data-flow edge, or `null` if it is not allowed.
 * Self-loops are rejected (they render as an invisible edge). Parallel flows between the same
 * two elements are fine: request/response pairs are common in a DFD.
 */
export function connectionToEdge(
    connection: { source: string | null; target: string | null },
    existing: ReadonlyArray<DfdEdge>,
    id: Id,
): DfdEdge | null {
    const { source, target } = connection;
    if (!source || !target || source === target) return null;
    return toFlowEdge({
        id,
        name: nextName(FLOW_LABEL, existing.map((e) => e.data?.name ?? '')),
        sourceId: source,
        targetId: target,
        properties: {},
    });
}

export function snapToGrid(value: number, grid = 10): number {
    return Math.round(value / grid) * grid || 0; // `|| 0` avoids returning -0
}

// ── comparing ────────────────────────────────────────────────────────────────

/** Structural equality that ignores key order and treats `undefined` as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const key of keys) {
        if (!deepEqual(ao[key], bo[key])) return false;
    }
    return true;
}

const byId = <T extends { id: Id }>(items: ReadonlyArray<T>): T[] =>
    [...items].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

/** True if two diagrams describe the same thing, regardless of item order. */
export function diagramEquals(a: DiagramState, b: DiagramState): boolean {
    return (
        deepEqual(byId(a.elements), byId(b.elements)) &&
        deepEqual(byId(a.dataFlows), byId(b.dataFlows)) &&
        deepEqual(byId(a.trustBoundaries), byId(b.trustBoundaries))
    );
}