/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { createNotice, INFO_TIMEOUT_MS } from './notice';

describe('notice', () => {
    it('puts info in a polite status region and clears it after a while', () => {
        vi.useFakeTimers();
        const n = createNotice();
        n.show('Saved', 'info');
        expect(n.element.querySelector('[role="status"]')?.textContent).toBe('Saved');
        vi.advanceTimersByTime(INFO_TIMEOUT_MS);
        expect(n.element.querySelector('[role="status"]')?.textContent).toBe('');
        vi.useRealTimers();
    });

    it('puts errors in an alert region that stays until dismissed', () => {
        const n = createNotice();
        n.show('Bad file', 'error');
        const alert = n.element.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain('Bad file');
        const dismiss = alert.querySelector('button')!;
        expect(dismiss.hidden).toBe(false);
        dismiss.click();
        expect(alert.querySelector('p')?.textContent).toBe('');
        expect(dismiss.hidden).toBe(true);
    });

    it('a new message replaces the previous one', () => {
        const n = createNotice();
        n.show('Bad file', 'error');
        n.show('Opened', 'info');
        expect(n.element.querySelector('[role="alert"] p')?.textContent).toBe('');
        expect(n.element.querySelector('[role="status"]')?.textContent).toBe('Opened');
    });
});
