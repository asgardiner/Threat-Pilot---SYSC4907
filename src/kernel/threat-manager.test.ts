import { describe, expect, it } from 'vitest';
import type { Project, Threat } from './contracts';
import {
    addCustomThreat,
    editThreat,
    isThreatOrphaned,
    mitigateThreat,
    prioritizeThreat,
    refreshGenerated,
} from './threat-manager';

// Builds a sample project with 2 elements so test can mutate fields or remove elements directly
function makeDefaultProject(): Project {
    return {
        schemaVersion: 1,
        id: 'Sample-Project1',
        title: 'Sample Online Shopping Project',
        owner: 'Jumana',
        description: 'Sample project for testing threat-manager',
        reviewers: [],
        methodologyIds: ['fake-stride'],
        elements: [
            {
                id: 'el-checkout',
                type: 'process',
                name: 'Checkout service',
                position: { x:100, y:200 },
                properties: { authenticated:false },
            },
            {
                id: 'el-database',
                type: 'dataStore',
                name: 'Orders Database',
                position: { x:200, y:100 },
                properties: { encrypted:true },
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
        createdAt: "2026-11-23T07:40:00.000Z",
        updatedAt: "2026-11-23T07:40:00.000Z",
    };
}

// Builds a sample generated threat tied to an element target
function makeGeneratedThreat(): Threat {
    return {
        id: "threat-1",
        title: "Old title: Missing authentication in checkout service",
        description: "Old description",
        category: "Spoofing",
        methodologyId: "fake-stride",
        ruleId: "rule-unauthenticated-process",
        target: { kind:"element", id:"el-checkout" },
        origin: "generated",
        modified: false,
        priority: "medium",
        status: "open",
        mitigation: "Old mitigation",
        createdAt: "2026-11-23T07:40:00.000Z",
        updatedAt: "2026-11-23T07:40:00.000Z",
    };
}

describe("threat-manager (T1)", () => {
    it("adds, prioritizes, and mitigates a custom threat linked to an element ID", () => {
        let threats: Threat[] = [];

        // Add a custom threat linked to el-checkout
        threats = addCustomThreat(
            threats,
            {
                targetId: "el-checkout",
                methodologyId: "fake-stride",
                title: "Custom spoofed session",
                description: "User reported issue on checkout",
                category: "Spoofing",
                priority: "medium",
            },
            "2026-11-23T07:40:00.000Z"
        );
        expect(threats).toHaveLength(1);
        expect(threats[0]).toMatchObject({
            title: "Custom spoofed session",
            origin: "user",
            modified: false,
            status: "open",
            priority: "medium",
            target: { kind:"element", id:"el-checkout" },
        });
        const createdId = threats[0].id;

        // Prioritize the custom threats
        threats = prioritizeThreat(threats, createdId, "critical", "2026-11-23T10:10:00.000Z");
        expect(threats[0].priority).toBe("critical");
        expect(threats[0].modified).toBe(true);
        expect(threats[0].updatedAt).toBe("2026-11-23T10:10:00.000Z");

        // Mitigate the custom threat and update its status
        threats = mitigateThreat(
            threats,
            createdId,
            "Require signed session tokens",
            "mitigated",
            "2026-11-23T10:10:00.000Z",
        );
        expect(threats[0].mitigation).toBe("Require signed session tokens");
        expect(threats[0].status).toBe("mitigated");
        expect(threats[0].createdAt).toBe("2026-11-23T07:40:00.000Z")
        expect(threats[0].updatedAt).toBe("2026-11-23T10:10:00.000Z");
    });

    it("keeps user edits when refershGenerated runs after editing a threat", () => {
        const project = makeDefaultProject();
        const initialThreat = makeGeneratedThreat();

        // Edit the threat so modified becomes true
        const editedList = editThreat(
            [initialThreat],
            initialThreat.id,
            {
                title: "My custom edited title",
                priority: "critical",
                mitigation: "Custom mitigation kept by user",
            },
            "2026-11-23T10:50:00.000Z",
        );

        // Incoming generated threat has different wording and priority
        const incomingGenerated: Threat = {
            ...makeGeneratedThreat(),
            id: "threat-generated-fresh",
            title: "Default title",
            priority: "low",
            mitigation: "Default Mitigation",
        };

        const refreshed = refreshGenerated(
            editedList,
            [incomingGenerated],
            project,
            "2026-11-23T11:00:00.000Z",
        );
        expect(refreshed).toHaveLength(1);
        expect(refreshed[0].id).toBe("threat-1");
        expect(refreshed[0].title).toBe("My custom edited title");
        expect(refreshed[0].priority).toBe("critical");
        expect(refreshed[0].mitigation).toBe("Custom mitigation kept by user");
        expect(refreshed[0].modified).toBe(true);
    });
    it("updates an untouched generated threat when refreshGenerated runs", () => {
        const project = makeDefaultProject();
        const untouchedThreat = makeGeneratedThreat();

        const incomingGenerated: Threat = {
            ...makeGeneratedThreat(),
            id: "threat-generated-fresh",
            title: "Updated title",
            description: "Updated description",
            priority: "high",
            mitigation: "Updated mitigation",
        };
        const refreshed = refreshGenerated(
            [untouchedThreat],
            [incomingGenerated],
            project,
            "2026-11-23T12:00:00.000Z",
        );

        expect(refreshed).toHaveLength(1);
        expect(refreshed[0].id).toBe("threat-1");
        expect(refreshed[0].title).toBe("Updated title");
        expect(refreshed[0].description).toBe("Updated description");
        expect(refreshed[0].priority).toBe("high");
        expect(refreshed[0].mitigation).toBe("Updated mitigation");
        expect(refreshed[0].createdAt).toBe("2026-11-23T07:40:00.000Z");
        expect(refreshed[0].updatedAt).toBe("2026-11-23T12:00:00.000Z")
    });

    it("leaves a threat orphaned instead of removing it when its element is deleted", () => {
        const project = makeDefaultProject();
        const exisitingThreat = makeGeneratedThreat();

        // Remove el-checkout from the project diagram
        project.elements = project.elements.filter((el) => el.id !== "el-checkout");
        
        // Re-running rules no longer finds el-checkout so incoming generated threats are empty
        const refreshed = refreshGenerated([exisitingThreat], [], project, "2026-11-21T12:40:00.000Z");

        expect(refreshed).toHaveLength(1);
        expect(refreshed[0].id).toBe("threat-1");
        expect(isThreatOrphaned(refreshed[0], project)).toBe(true);
    });
});