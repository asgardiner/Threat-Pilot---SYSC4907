import type { NoticeKind } from '../services/projectIO';

/**
 * Status line for the shell header.
 *
 * Two persistent live regions, because changing `role` on an existing node is not
 * announced reliably: polite `status` for confirmations, assertive `alert` for errors.
 * Errors stay until dismissed or replaced; info clears itself.
 */
export interface Notice {
    readonly element: HTMLElement;
    show(message: string, kind: NoticeKind): void;
    clear(): void;
}

export const INFO_TIMEOUT_MS = 6000;

export function createNotice(): Notice {
    const element = document.createElement('div');
    element.className = 'tp-notice';

    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.className = 'tp-notice-info';

    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.className = 'tp-notice-error';

    const alertText = document.createElement('p');
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.hidden = true;

    alert.append(alertText, dismiss);
    element.append(status, alert);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
        clearTimeout(timer);
        status.textContent = '';
        alertText.textContent = '';
        dismiss.hidden = true;
    };
    dismiss.addEventListener('click', clear);

    return {
        element,
        clear,
        show(message, kind) {
            clear();
            if (kind === 'error') {
                alertText.textContent = message;
                dismiss.hidden = false;
            } else {
                status.textContent = message;
                timer = setTimeout(() => (status.textContent = ''), INFO_TIMEOUT_MS);
            }
        },
    };
}
