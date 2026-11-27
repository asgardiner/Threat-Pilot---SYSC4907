/**
 * Slot registry: plug-ins and panels contribute UI into named shell regions
 * without the shell importing them directly (issue #22).
 */

export type SlotId = 'canvas' | 'right-panel' | 'threats';

export interface SlotContribution {
    id: string;
    slot: SlotId;
    /** Mount into the slot. Optionally return a cleanup function. */
    mount(container: HTMLElement): void | (() => void);
}

export class SlotRegistry {
    private contributions = new Map<string, SlotContribution>();

    add(contribution: SlotContribution): void {
        if (this.contributions.has(contribution.id)) {
            throw new Error(`Slot contribution "${contribution.id}" already exists`);
        }
        this.contributions.set(contribution.id, contribution);
    }

    get(id: string): SlotContribution | undefined {
        return this.contributions.get(id);
    }

    getBySlot(slot: SlotId): SlotContribution[] {
        return Array.from(this.contributions.values()).filter((c) => c.slot === slot);
    }
}
