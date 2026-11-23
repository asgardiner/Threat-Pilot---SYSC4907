import type {
    Project,
    Methodology,
    Threat,
    DiagramTarget,
    EvaluationContext,
    ThreatDraft,
    Id
} from './contracts';

/**
 * Generates a simple unique ID for newly created generated threats.
 */

function generateThreatID(): Id {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'threat-' + Math.random().toString(36).substring(2, 9);
}

function Targets(project : Project): DiagramTarget[] {
    return [
        ...(project.elements ?? []).map((item) => ({kind: 'element' as const, item})),
        ...(project.dataFlows ?? []).map((item) => ({kind: 'dataFlow' as const, item})),
        ...(project.trustBoundaries ?? []).map((item) => ({kind: 'trustBoundary' as const, item}))
    ];
}

function draftToThreat (draft: ThreatDraft, pluginId: Id, target: DiagramTarget, timestamp: string) : Threat {
    return {
        id: generateThreatID(),
        title: draft.title,
        description: draft.description,
        category: draft.category,
        methodologyId: pluginId,
        target: {
            kind: target.kind,
            id: target.item.id,
        },
        origin: 'generated',
        modified: false,
        ruleId: draft.ruleId,
        priority: draft.priority,
        status: 'open',
        mitigation: draft.mitigation,
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

/**
 * Methologies 
 */
export async function evaluateModelRules(
    project: Project,
    plugins: Methodology[]
): Promise<Threat[]> {
    const now  = new Date().toISOString();
    const enableIds = new Set(project.methodologyIds ?? []);
    const targets = Targets(project);
    const context: EvaluationContext = {project};
    const threats: Threat[] = [];

    for (const plugin of plugins) {
        if (plugin.kind !== 'methodology') continue;
        if (!enableIds.has(plugin.id)) continue;

        for (const target of targets) {
            try {
                const drafts = plugin.evaluate(target, context);
                if (!Array.isArray(drafts)) continue;

                for (const draft of drafts) {
                    threats.push(draftToThreat(draft, plugin.id, target, now));
                }
            }
            catch (error) {
                console.error(`Rule engine error in plug-in [${plugin.id}] on [${target.kind}:${target.item.id}]:`, error,);
            }
        }
    }
    return threats;
}

export async function runRules(project: Project, plugins: Methodology[] = []):
Promise<Threat[]> {
    return evaluateModelRules(project, plugins);
}