/**
 * UX Utilities — Ultimate Bookkeeping
 * Source: UI/UX Pro Max Skill v2.5.0
 *
 * Provides:
 *   UX.skeleton(tbody, cols)        — render skeleton loading rows
 *   UX.emptyState(container, opts) — render empty state with CTA
 *   UX.noResults(container, query) — render search no-results
 *   UX.confirm(opts)               — styled async confirm dialog
 *   UX.setLoading(btn, bool)       — button loading state
 *   UX.announce(msg)               — aria-live announcement
 *   UX.haptic(pattern)             — vibration on money actions
 *   UX.fieldError(input, msg)      — show/clear field-level error
 */

export const UX = {

    /* ── Skeleton table rows ─────────────────────────────── */
    /**
     * @param {HTMLElement} tbody
     * @param {number} cols  — number of table columns
     * @param {number} rows  — number of skeleton rows (default 5)
     */
    skeleton(tbody, cols = 4, rows = 5) {
        if (!tbody) return;
        const widths = ['short', 'medium', 'long', 'medium', 'short'];
        tbody.innerHTML = Array.from({ length: rows }, (_, r) =>
            `<tr class="skeleton-row">
                ${Array.from({ length: cols }, (_, c) =>
                    `<td><div class="skeleton-cell skeleton-cell--${widths[(r + c) % widths.length]}"></div></td>`
                ).join('')}
            </tr>`
        ).join('');
    },

    /* ── Empty state ─────────────────────────────────────── */
    /**
     * @param {HTMLElement} container
     * @param {{ icon, title, desc, actionLabel, onAction }} opts
     */
    emptyState(container, { icon = 'fa-inbox', title = 'Nothing here yet', desc = '', actionLabel = '', onAction = null } = {}) {
        if (!container) return;
        const id = `esa-${Date.now()}`;
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon"><i class="fas ${icon}"></i></div>
                <p class="empty-state__title">${title}</p>
                ${desc ? `<p class="empty-state__desc">${desc}</p>` : ''}
                ${actionLabel ? `<button class="empty-state__action" id="${id}">${actionLabel}</button>` : ''}
            </div>
        `;
        if (actionLabel && onAction) {
            container.querySelector(`#${id}`)?.addEventListener('click', onAction);
        }
    },

    /* ── No-results (search/filter context) ─────────────── */
    /**
     * @param {HTMLElement} container
     * @param {string} query — the search term the user typed
     */
    noResults(container, query = '') {
        if (!container) return;
        container.innerHTML = `
            <div class="search-no-results">
                <i class="fas fa-search"></i>
                <span>No results for <strong>"${query}"</strong> — try a different search term</span>
            </div>
        `;
    },

    /* ── Styled confirm dialog ───────────────────────────── */
    /**
     * Returns a Promise<boolean>. Resolves true on confirm, false on cancel.
     * @param {{ title, body, confirmLabel, cancelLabel, variant }} opts
     */
    confirm({ title = 'Are you sure?', body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'danger' } = {}) {
        return new Promise(resolve => {
            // Remove any existing dialog
            document.getElementById('ux-confirm-overlay')?.remove();

            const overlay = document.createElement('div');
            overlay.id = 'ux-confirm-overlay';
            overlay.className = 'confirm-dialog-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'ux-confirm-title');

            const iconMap = { danger: 'fa-trash-alt', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };

            overlay.innerHTML = `
                <div class="confirm-dialog">
                    <div class="confirm-dialog__icon confirm-dialog__icon--${variant}">
                        <i class="fas ${iconMap[variant] || iconMap.danger}"></i>
                    </div>
                    <p class="confirm-dialog__title" id="ux-confirm-title">${title}</p>
                    ${body ? `<p class="confirm-dialog__body">${body}</p>` : ''}
                    <div class="confirm-dialog__actions">
                        <button class="confirm-dialog__cancel" id="ux-confirm-cancel">${cancelLabel}</button>
                        <button class="confirm-dialog__confirm--${variant}" id="ux-confirm-ok">${confirmLabel}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Focus confirm button for keyboard UX
            requestAnimationFrame(() => overlay.querySelector('#ux-confirm-ok')?.focus());

            const cleanup = (result) => {
                overlay.remove();
                resolve(result);
            };

            overlay.querySelector('#ux-confirm-ok').addEventListener('click', () => cleanup(true));
            overlay.querySelector('#ux-confirm-cancel').addEventListener('click', () => cleanup(false));

            // Close on backdrop click
            overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });

            // Close on Escape
            const onKey = e => { if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', onKey); } };
            document.addEventListener('keydown', onKey);
        });
    },

    /* ── Button loading state ────────────────────────────── */
    /**
     * @param {HTMLButtonElement} btn
     * @param {boolean} loading
     */
    setLoading(btn, loading) {
        if (!btn) return;
        if (loading) {
            btn.dataset.loading = 'true';
            btn.dataset.originalText = btn.innerHTML;
            btn.disabled = true;
        } else {
            delete btn.dataset.loading;
            btn.disabled = false;
            if (btn.dataset.originalText) {
                btn.innerHTML = btn.dataset.originalText;
                delete btn.dataset.originalText;
            }
        }
    },

    /* ── ARIA live announcement ──────────────────────────── */
    /** @param {string} message */
    announce(message) {
        const region = document.getElementById('live-region');
        if (!region) return;
        // Clear first so repeat announcements re-fire
        region.textContent = '';
        requestAnimationFrame(() => { region.textContent = message; });
    },

    /* ── Haptic feedback ─────────────────────────────────── */
    /**
     * Only fires on mobile (vibration API). Short pulse for confirmations.
     * @param {number|number[]} pattern — ms, default 10ms
     */
    haptic(pattern = 10) {
        try {
            if (navigator.vibrate) navigator.vibrate(pattern);
        } catch (_) { /* ignore — not all browsers support this */ }
    },

    /* ── Field-level error ───────────────────────────────── */
    /**
     * @param {HTMLInputElement|HTMLSelectElement} input
     * @param {string|null} message — null clears the error
     */
    fieldError(input, message) {
        if (!input) return;
        const group = input.closest('.field-group');

        if (message) {
            input.setAttribute('aria-invalid', 'true');
            if (group) {
                group.classList.add('has-error');
                let errEl = group.querySelector('.field-error');
                if (!errEl) {
                    errEl = document.createElement('span');
                    errEl.className = 'field-error';
                    errEl.setAttribute('role', 'alert');
                    input.after(errEl);
                }
                errEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
            }
        } else {
            input.removeAttribute('aria-invalid');
            if (group) {
                group.classList.remove('has-error');
                group.querySelector('.field-error')?.remove();
            }
        }
    },

    /* ── Skeleton metric cards ───────────────────────────── */
    /**
     * Replace metric card content with skeleton while data loads.
     * @param {NodeList|HTMLElement[]} cards
     */
    skeletonMetrics(cards) {
        cards.forEach(card => {
            card.classList.add('skeleton-metric');
            card.innerHTML = `
                <div class="metric-label skeleton"></div>
                <div class="metric-value skeleton"></div>
            `;
        });
    },
};

export default UX;
