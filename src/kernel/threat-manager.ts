import type {
    Id,
    IsoDateTime,
    MitigationStatus,
    Priority,
    Project,
    Threat,
    ThreatTargetRef,
} from './contracts';

// Input needed to create a custom threat linked to the diagram target/element
export interface createCustomThreatInput {
    targetId: Id;
    targetKind?: ThreatTargetRef['kind']; // Defaults to element for element linked custom threats
    methodologyId: Id;
    title: string;
    description: string;
    category: string;
    priority: Priority;
    mitigation?: string;
}

// Fields a user can update when editing an existing threat
export interface editThreatInput {
    title?: string;
    description?: string;
    category?: string;
    priority?: Priority;
    status?: MitigationStatus;
    mitigation?: string;
}

// Generates a unique threat ID
function createThreatId(): Id {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `threat-${crypto.randomUUID()}`;
    }
    return `threat-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
}

// Collects all exisiting target IDs in the project diagram
function collectExistingTargetIds(project: Project): Set<Id> {
    const ids = new Set<Id>();

    for (const element of project.elements ?? []) {
        ids.add(element.id);
    }
    for (const flow of project.dataFlows ?? []) {
        ids.add(flow.id);
    }
    for (const boundary of project.trustBoundaries ?? []) {
        ids.add(boundary.id);
    }
    return ids;
}

// Identity key for generated threats
function getGeneratedThreatKey(threat: Threat): string {
    return `${threat.methodologyId}::${threat.ruleId ?? ''}::${threat.target.kind}::${threat.target.id}`;
}

// Checks whether a threat's target item has been removed from the project diagram
export function isThreatOrphaned(threat: Threat, project: Project): boolean {
    const exisitingIds = collectExistingTargetIds(project);
    return !exisitingIds.has(threat.target.id);
}

// Adds a custom user threat linked to a diagram item
export function addCustomThreat(
    threats: Threat[], 
    input: createCustomThreatInput, 
    now: IsoDateTime = new Date().toISOString(),
): Threat[] {
    const customeThreat: Threat = {
        id: createThreatId(),
        title: input.title,
        description: input.description,
        category: input.category,
        methodologyId: input.methodologyId,
        target: {
            kind: input.targetKind ?? 'element',
            id: input.targetId,
        },
        origin: 'user',
        modified: false,
        priority: input.priority,
        status: 'open',
        mitigation: input.mitigation,
        createdAt: now,
        updatedAt: now,
    };
    return [...threats,customeThreat];
}

// Edits an exisiting threat, marks modified true, and refreshes updatedAt
export function editThreat(
    threats: Threat[],
    threatId: Id,
    changes: editThreatInput,
    now: IsoDateTime = new Date().toISOString(),
): Threat[] {
    return threats.map((threat) => {
        if (threat.id !== threatId) {
            return threat;
        }
        return {
            ...threat,
            ...changes,
            createdAt: threat.createdAt,
            updatedAt: now,
            modified: true,
        };
    });
}

// Updates a threat's priority (low, medium, high, critical) and marks it modified
export function prioritizeThreat(
    threats: Threat[],
    threatId: Id,
    priority: Priority,
    now: IsoDateTime = new Date().toISOString(),
): Threat[] {
    return editThreat(threats, threatId, { priority }, now);
}

// Sets mitigation guidance and optionally updates status
export function mitigateThreat(
    threats: Threat[],
    threatId: Id,
    mitigation: string,
    status?: MitigationStatus,
    now: IsoDateTime = new Date().toISOString(),
): Threat[] {
    return editThreat(
        threats, 
        threatId, 
        status ? { mitigation, status } : { mitigation }, 
        now,
    );
}

/**
 * Merges newly generated threats with existing threats:
 * - Keeps threats where origin === 'user' OR modified === true
 * - Updates untouched generated threats (origin === 'generated' && modified === false)
 * - Adds newly generated threats
 * - Keeps threats whose target was deleted (detectable via isThreatOrphaned) rather than removing them
 */

export function refreshGenerated(
    exisitingThreats: Threat[],
    generatedThreats: Threat[],
    project: Project,
    now: IsoDateTime = new Date().toISOString(),
): Threat[] {
    const exisitingTargetIds = collectExistingTargetIds(project);

    // Index incoming generated threats
    const incomingByKey = new Map<string, Threat>();
    for (const draftThreat of generatedThreats) {
        incomingByKey.set(getGeneratedThreatKey(draftThreat), draftThreat);
    }
    const matchedIncomingKeys = new Set<string>();
    const merged: Threat[] = [];

    for (const current of exisitingThreats) {
        const targetExists = exisitingTargetIds.has(current.target.id);

        // Keep user-created or user-modified threats
        if (current.origin === 'user' || current.modified) {
            merged.push(current);
            continue;
        }

        // Untouched generated threat: update if its target still exists and a matching generated threat exists
        const key = getGeneratedThreatKey(current);
        const matchingIncoming = incomingByKey.get(key);

        if (targetExists && matchingIncoming) {
            matchedIncomingKeys.add(key);
            merged.push({
                ...current,
                title: matchingIncoming.title,
                description: matchingIncoming.description,
                category: matchingIncoming.category,
                priority: matchingIncoming.priority,
                mitigation: matchingIncoming.mitigation,
                id: current.id,
                createdAt: current.createdAt,
                updatedAt: now,
            });
        }
        else {
            // Target was removed or rule no longer fired: Preserve threat in list (orphaned) instead of deleting
            merged.push({
                ...current,
                updatedAt: targetExists ? current.updatedAt: now,
            });
        }
    }
    // Append newly generated threats that were not already present
    for (const incoming of generatedThreats) {
        const key = getGeneratedThreatKey(incoming);
        if (matchedIncomingKeys.has(key)) {
            continue;
        }
        
        const alreadyInExisitng = exisitingThreats.some((t) => getGeneratedThreatKey(t) === key);
        if (!alreadyInExisitng) {
            merged.push({
                ...incoming,
                origin: 'generated',
                modified: false,
                createdAt: incoming.createdAt ?? now,
                updatedAt: now,
            });
        }
    }
    return merged;
}

