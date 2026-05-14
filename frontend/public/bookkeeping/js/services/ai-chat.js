/**
 * AI Chat Service — floating chat window for business Q&A
 */

import { auth } from '../config/firebase.js';
import { isDebtPayment, getSaleTotal } from '../utils/accounting.js';
import accountantScheduler, { REPORT_TYPES } from './accountant-scheduler.js';

const BACKEND_URL = window.BACKEND_URL || '';

const SKILLS = {
    general: {
        id:          'general',
        label:       'Advisor',
        icon:        'fa-robot',
        color:       '#6366f1',
        endpoint:    '/api/ai/chat',
        placeholder: 'Ask a business question...',
        welcome: {
            title: 'Business AI Assistant',
            desc:  'Ask me anything about your business — sales trends, inventory advice, expense analysis, or strategic recommendations.',
            suggestions: [
                { icon: 'fa-chart-line', q: 'How are my sales performing this month?' },
                { icon: 'fa-box',        q: 'Which products should I restock?' },
                { icon: 'fa-piggy-bank', q: 'How can I reduce my expenses?' },
                { icon: 'fa-heartbeat',  q: 'Give me a business health summary' },
            ],
        },
    },
    accountant: {
        id:          'accountant',
        label:       'Accountant',
        icon:        'fa-calculator',
        color:       '#059669',
        endpoint:    '/api/ai/accountant',
        placeholder: 'Ask about profit, taxes, expenses, liabilities...',
        welcome: {
            title: 'ChiefAccounts — AI Accountant',
            desc:  'I have live access to your financial records. Ask me about profit & loss, Ghana VAT, expense categorisation, or debt management.',
            suggestions: [
                { icon: 'fa-chart-pie',      q: 'Prepare my profit and loss for this month' },
                { icon: 'fa-file-invoice',   q: 'What is my estimated VAT liability?' },
                { icon: 'fa-tags',           q: 'Find and classify my uncategorised expenses' },
                { icon: 'fa-hand-holding-usd', q: 'Which debt should I pay off first?' },
            ],
        },
    },
    inventory: {
        id:          'inventory',
        label:       'Stock',
        icon:        'fa-boxes',
        color:       '#d97706',
        endpoint:    '/api/ai/inventory',
        placeholder: 'Ask about stock levels, reorders, suppliers...',
        welcome: {
            title: 'StockMaster — AI Inventory Manager',
            desc:  'I have live access to your stock records. Ask me about inventory levels, reorder planning, ABC analysis, purchase orders, or dead stock.',
            suggestions: [
                { icon: 'fa-exclamation-triangle', q: 'Which products are running low or at risk of stockout?' },
                { icon: 'fa-sort-amount-down',     q: 'Run an ABC analysis on my inventory' },
                { icon: 'fa-shopping-cart',        q: 'What should I reorder right now?' },
                { icon: 'fa-chart-bar',            q: 'Identify any dead stock in my inventory' },
            ],
        },
    },
};

class AIChatService {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.isLoading = false;
        this.state = null;
        this.elements = {};
        this.injected = false;
        this._lastTapTs = 0;
        this._lastTapType = '';
        this._fabAttrObserver = null;
        this.launcherButtons = [];
        this.activeSkill = 'general';
        this._skillMessages = { general: [], accountant: [], inventory: [] };
        this._schedulePanelOpen = false;
    }

    init(state) {
        this.state = state;
        if (!this.injected) {
            this.injectHTML();
            this.bindEvents();
            this.injected = true;
        }
        accountantScheduler.init(this._onScheduledReport.bind(this));
        accountantScheduler.start();
        this.updateFabBadge();
    }

    _skillTabsHTML() {
        return Object.values(SKILLS).map(s => `
            <button class="ai-skill-tab${s.id === this.activeSkill ? ' active' : ''}"
                    data-skill="${s.id}"
                    style="--skill-color:${s.color}"
                    title="${s.label}">
                <i class="fas ${s.icon}"></i>
                <span>${s.label}</span>
            </button>
        `).join('');
    }

    _welcomeHTML(skillId) {
        const s = SKILLS[skillId];
        const w = s.welcome;
        return `
            <div class="ai-chat-welcome-icon" style="background:${s.color}20;color:${s.color}">
                <i class="fas ${s.icon}"></i>
            </div>
            <h3>${w.title}</h3>
            <p>${w.desc}</p>
            <div class="ai-chat-suggestions" id="ai-chat-suggestions">
                ${w.suggestions.map(sg => `
                    <button class="ai-chat-suggestion" data-q="${sg.q}">
                        <i class="fas ${sg.icon}"></i> ${sg.q}
                    </button>
                `).join('')}
            </div>
        `;
    }

    injectHTML() {
        const existing = document.getElementById('ai-chat-root');
        if (existing) existing.remove();

        const skill = SKILLS[this.activeSkill];

        const root = document.createElement('div');
        root.id = 'ai-chat-root';
        root.innerHTML = `
            <div class="ai-chat-window" id="ai-chat-window">
                <div class="ai-chat-header" id="ai-chat-header" style="--skill-color:${skill.color}">
                    <div class="ai-chat-header-left">
                        <div class="ai-chat-avatar" id="ai-chat-avatar"><i class="fas ${skill.icon}"></i></div>
                        <div class="ai-chat-header-info">
                            <h4 id="ai-chat-title">Business AI</h4>
                            <span id="ai-chat-subtitle">Online</span>
                        </div>
                    </div>
                    <div class="ai-chat-header-actions">
                        <button id="ai-schedule-btn" title="Automated reports"><i class="fas fa-clock"></i></button>
                        <button id="ai-chat-clear" title="Clear conversation"><i class="fas fa-trash-alt"></i></button>
                        <button id="ai-chat-close" title="Close"><i class="fas fa-times"></i></button>
                    </div>
                </div>

                <!-- Skill switcher tabs -->
                <div class="ai-skill-tabs" id="ai-skill-tabs">
                    ${this._skillTabsHTML()}
                </div>

                <div class="ai-chat-messages" id="ai-chat-messages">
                    <div class="ai-chat-welcome" id="ai-chat-welcome">
                        ${this._welcomeHTML(this.activeSkill)}
                    </div>
                </div>

                <!-- Schedule Panel -->
                <div class="ai-schedule-panel" id="ai-schedule-panel">
                    <div class="ai-schedule-panel-header">
                        <span><i class="fas fa-clock"></i> Automated Reports</span>
                        <button id="ai-schedule-close" title="Close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="ai-schedule-panel-body">
                        <div class="ai-schedule-section">
                            <div class="ai-schedule-row">
                                <div class="ai-schedule-info">
                                    <i class="fas fa-chart-line" style="color:#059669"></i>
                                    <div><strong>Daily P&amp;L</strong><small>Every day at a set time</small></div>
                                </div>
                                <label class="ai-toggle-switch">
                                    <input type="checkbox" id="sch-daily-enabled">
                                    <span class="ai-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="ai-schedule-options" id="sch-daily-opts">
                                <label class="ai-schedule-field">Time <input type="time" id="sch-daily-time" value="07:00"></label>
                            </div>
                        </div>
                        <div class="ai-schedule-section">
                            <div class="ai-schedule-row">
                                <div class="ai-schedule-info">
                                    <i class="fas fa-tags" style="color:#d97706"></i>
                                    <div><strong>Weekly Expenses</strong><small>Categorise &amp; flag unusual spending</small></div>
                                </div>
                                <label class="ai-toggle-switch">
                                    <input type="checkbox" id="sch-weekly-enabled">
                                    <span class="ai-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="ai-schedule-options" id="sch-weekly-opts">
                                <label class="ai-schedule-field">Day
                                    <select id="sch-weekly-day">
                                        <option value="1">Monday</option>
                                        <option value="2">Tuesday</option>
                                        <option value="3">Wednesday</option>
                                        <option value="4">Thursday</option>
                                        <option value="5">Friday</option>
                                    </select>
                                </label>
                                <label class="ai-schedule-field">Time <input type="time" id="sch-weekly-time" value="09:00"></label>
                            </div>
                        </div>
                        <div class="ai-schedule-section">
                            <div class="ai-schedule-row">
                                <div class="ai-schedule-info">
                                    <i class="fas fa-file-invoice" style="color:#7c3aed"></i>
                                    <div><strong>Monthly VAT</strong><small>Liability &amp; compliance summary</small></div>
                                </div>
                                <label class="ai-toggle-switch">
                                    <input type="checkbox" id="sch-monthly-enabled">
                                    <span class="ai-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="ai-schedule-options" id="sch-monthly-opts">
                                <label class="ai-schedule-field">Day of month <input type="number" id="sch-monthly-day" min="1" max="28" value="1"></label>
                                <label class="ai-schedule-field">Time <input type="time" id="sch-monthly-time" value="08:00"></label>
                            </div>
                        </div>
                        <button class="ai-schedule-save-btn" id="ai-schedule-save"><i class="fas fa-check"></i> Save Schedule</button>
                        <div class="ai-schedule-history">
                            <h5>Recent Reports</h5>
                            <div id="ai-schedule-history-list"><p class="ai-schedule-empty">No reports generated yet.</p></div>
                        </div>
                    </div>
                </div>

                <div class="ai-chat-input-area">
                    <div class="ai-chat-input-row">
                        <textarea id="ai-chat-input" rows="1" placeholder="Ask a business question..."></textarea>
                        <button class="ai-chat-send-btn" id="ai-chat-send" title="Send" disabled>
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                    <div class="ai-chat-context" id="ai-chat-context">
                        <i class="fas fa-database"></i>
                        <span id="ai-chat-context-text">Answers use structured metrics from your loaded sales, inventory, and purchase orders</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        this.elements = {
            window:        document.getElementById('ai-chat-window'),
            messages:      document.getElementById('ai-chat-messages'),
            welcome:       document.getElementById('ai-chat-welcome'),
            input:         document.getElementById('ai-chat-input'),
            sendBtn:       document.getElementById('ai-chat-send'),
            closeBtn:      document.getElementById('ai-chat-close'),
            clearBtn:      document.getElementById('ai-chat-clear'),
            suggestions:   document.getElementById('ai-chat-suggestions'),
            skillTabs:     document.getElementById('ai-skill-tabs'),
            contextText:   document.getElementById('ai-chat-context-text'),
            header:        document.getElementById('ai-chat-header'),
            avatar:        document.getElementById('ai-chat-avatar'),
            title:         document.getElementById('ai-chat-title'),
            subtitle:      document.getElementById('ai-chat-subtitle'),
            scheduleBtn:   document.getElementById('ai-schedule-btn'),
            schedulePanel: document.getElementById('ai-schedule-panel'),
            historyList:   document.getElementById('ai-schedule-history-list'),
        };

        // Defensive: ensure FAB is never treated as disabled (especially in native app webviews).
        this.ensureLauncherButtons();
        this.bindLauncherButtons();
    }

    ensureLauncherButtons() {
        const root = document.getElementById('ai-chat-root');

        // FAB — the single launcher for all screen sizes (desktop, tablet, mobile)
        if (root && !document.getElementById('ai-chat-fab')) {
            const fab = document.createElement('button');
            fab.id = 'ai-chat-fab';
            fab.type = 'button';
            fab.className = 'ai-chat-fab';
            fab.setAttribute('aria-label', 'Open AI assistant');
            fab.innerHTML = `<div class="fab-pulse"></div><i class="fas fa-robot"></i>`;
            root.appendChild(fab);
        }

        // Mobile bottom nav launcher (kept for quick-nav convenience on small screens)
        const bottomNav = document.getElementById('bottom-nav');
        if (bottomNav && !document.getElementById('ai-chat-launcher-bottom')) {
            const btn = document.createElement('button');
            btn.id = 'ai-chat-launcher-bottom';
            btn.type = 'button';
            btn.className = 'bottom-nav-item ai-chat-launcher-bottom';
            btn.setAttribute('aria-label', 'AI Assistant');
            btn.innerHTML = `<i class="fas fa-robot"></i><span>AI</span>`;
            bottomNav.appendChild(btn);
        }
    }

    bindLauncherButtons() {
        this.launcherButtons.forEach((btn) => btn?.removeEventListener?.('click', this._launcherHandler));
        this._launcherHandler = () => this.toggle();
        this.launcherButtons = [
            document.getElementById('ai-chat-fab'),
            document.getElementById('ai-chat-launcher-bottom'),
        ].filter(Boolean);
        this.launcherButtons.forEach((btn) => btn.addEventListener('click', this._launcherHandler));
    }

    bindEvents() {
        const { closeBtn, clearBtn, input, sendBtn, suggestions } = this.elements;

        const bindTap = (el, handler) => {
            if (!el) return;
            const wrapped = (e) => {
                const now = Date.now();
                const t = e?.type || '';
                // De-dupe synthetic follow-up events (touchend->click, pointerup->click, etc.).
                if (now - this._lastTapTs < 350) {
                    if (this._lastTapType === 'touchend' && t === 'click') return;
                    if (this._lastTapType === 'pointerup' && (t === 'click' || t === 'touchend')) return;
                    if (this._lastTapType === 'touchend' && t === 'pointerup') return;
                    if (this._lastTapType === 'click' && (t === 'pointerup' || t === 'touchend')) return;
                }

                this._lastTapTs = now;
                this._lastTapType = t;
                e?.preventDefault?.();
                e?.stopPropagation?.();
                handler(e);
            };

            if (typeof window !== 'undefined' && 'PointerEvent' in window) {
                el.addEventListener('pointerup', wrapped, { passive: false });
            }
            el.addEventListener('touchend', wrapped, { passive: false });
            el.addEventListener('click', wrapped);
        };

        bindTap(closeBtn, () => this.close());
        bindTap(clearBtn, () => this.clearConversation());
        bindTap(sendBtn, () => this.send());
        bindTap(this.elements.scheduleBtn, () => {
            if (this.activeSkill !== 'accountant') this.switchSkill('accountant');
            this._openSchedulePanel();
        });
        bindTap(document.getElementById('ai-schedule-close'), () => this._closeSchedulePanel());
        bindTap(document.getElementById('ai-schedule-save'), () => this._saveScheduleFromUI());

        ['daily', 'weekly', 'monthly'].forEach(type => {
            const toggle = document.getElementById(`sch-${type}-enabled`);
            const opts   = document.getElementById(`sch-${type}-opts`);
            if (toggle && opts) toggle.addEventListener('change', () => opts.classList.toggle('visible', toggle.checked));
        });

        // Skill tab switching
        const skillTabs = this.elements.skillTabs;
        if (skillTabs) {
            skillTabs.addEventListener('click', (e) => {
                const tab = e.target.closest('[data-skill]');
                if (tab) this.switchSkill(tab.dataset.skill);
            });
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.send();
            }
        });

        input.addEventListener('input', () => {
            this.autoResize(input);
            sendBtn.disabled = !input.value.trim();
        });

        const handleSuggestion = (e) => {
            const btn = e?.target?.closest?.('.ai-chat-suggestion');
            if (!btn) return;
            const q = btn.dataset.q;
            input.value = q;
            sendBtn.disabled = false;
            this.send();
        };
        suggestions.addEventListener('click', handleSuggestion);
        suggestions.addEventListener('pointerup', handleSuggestion, { passive: true });
        suggestions.addEventListener('touchend', handleSuggestion, { passive: true });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    isMobileOrNative() {
        try {
            if (window.Capacitor?.isNativePlatform?.()) return true;
        } catch (e) { /* ignore */ }
        return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
    }

    open() {
        this.isOpen = true;
        const win = this.elements.window;
        if (this.isMobileOrNative()) {
            win.classList.add('ai-chat-window--fullscreen');
            this._aiScrollY = window.scrollY || window.pageYOffset || 0;
            this._aiBodyOverflow = document.body.style.overflow;
            this._aiHtmlOverflow = document.documentElement.style.overflow;
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
        }
        win.classList.add('open');
        setTimeout(() => this.elements.input.focus(), 300);
    }

    close() {
        this.isOpen = false;
        const win = this.elements.window;
        const hadScrollLock = this._aiBodyOverflow !== undefined;
        win.classList.remove('open');
        win.classList.remove('ai-chat-window--fullscreen');
        if (hadScrollLock) {
            document.body.style.overflow = this._aiBodyOverflow || '';
            document.documentElement.style.overflow = this._aiHtmlOverflow || '';
            this._aiBodyOverflow = undefined;
            this._aiHtmlOverflow = undefined;
            const y = this._aiScrollY ?? 0;
            requestAnimationFrame(() => {
                window.scrollTo(0, y);
                window.dispatchEvent(new Event('resize'));
            });
        }
    }

    clearConversation() {
        this._skillMessages[this.activeSkill] = [];
        this.messages = [];
        this.elements.messages.innerHTML = '';
        this.elements.welcome.innerHTML = this._welcomeHTML(this.activeSkill);
        this.elements.messages.appendChild(this.elements.welcome);
        this.elements.welcome.style.display = 'flex';
        this.elements.suggestions = document.getElementById('ai-chat-suggestions');
        this._rebindSuggestions();
    }

    _rebindSuggestions() {
        const s = this.elements.suggestions;
        if (!s) return;
        s.replaceWith(s.cloneNode(true));
        this.elements.suggestions = document.getElementById('ai-chat-suggestions');
        this.elements.suggestions?.addEventListener('click', (e) => {
            const btn = e.target.closest('.ai-chat-suggestion');
            if (!btn) return;
            this.elements.input.value = btn.dataset.q;
            this.elements.sendBtn.disabled = false;
            this.send();
        });
    }

    switchSkill(skillId) {
        if (!SKILLS[skillId] || skillId === this.activeSkill) return;

        // Save current conversation
        this._skillMessages[this.activeSkill] = [...this.messages];

        this.activeSkill = skillId;
        const skill = SKILLS[skillId];

        // Update header
        if (this.elements.header)   this.elements.header.style.setProperty('--skill-color', skill.color);
        if (this.elements.avatar)   this.elements.avatar.innerHTML = `<i class="fas ${skill.icon}"></i>`;
        if (this.elements.title)    this.elements.title.textContent = skill.label === 'Accountant' ? 'ChiefAccounts' : 'Business AI';
        if (this.elements.subtitle) this.elements.subtitle.textContent = 'Online';
        if (this.elements.input)    this.elements.input.placeholder = skill.placeholder;

        // Update context footer
        if (this.elements.contextText) {
            this.elements.contextText.textContent = skillId === 'accountant'
                ? 'Live access to your Firestore records — no data size limits'
                : 'Answers use structured metrics from your loaded sales, inventory, and purchase orders';
        }

        // Update tab active state
        document.querySelectorAll('.ai-skill-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.skill === skillId);
        });

        if (skillId !== 'accountant' && this._schedulePanelOpen) {
            this._closeSchedulePanel();
        }

        // Restore or clear conversation for this skill
        this.messages = [...(this._skillMessages[skillId] || [])];
        const msgContainer = this.elements.messages;
        msgContainer.innerHTML = '';

        if (this.messages.length === 0) {
            this.elements.welcome.innerHTML = this._welcomeHTML(skillId);
            msgContainer.appendChild(this.elements.welcome);
            this.elements.welcome.style.display = 'flex';
            this.elements.suggestions = document.getElementById('ai-chat-suggestions');
            this._rebindSuggestions();
        } else {
            this.elements.welcome.style.display = 'none';
            this.messages.forEach(m => this._renderSavedMessage(m));
        }
    }

    _renderSavedMessage(m) {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const icon = m.role === 'user' ? 'fa-user' : 'fa-robot';
        const formattedText = m.role === 'assistant' ? this.formatMarkdown(m.text) : this.escapeHtml(m.text);
        const msg = document.createElement('div');
        msg.className = `ai-chat-msg ${m.role}`;
        msg.innerHTML = `
            <div class="ai-chat-msg-avatar"><i class="fas ${icon}"></i></div>
            <div>
                <div class="ai-chat-msg-bubble">${formattedText}</div>
                <div class="ai-chat-msg-time">${time}</div>
            </div>`;
        this.elements.messages.appendChild(msg);
    }

    autoResize(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    }

    /**
     * Slim records for server-side tool aggregates (size-capped on the server too).
     */
    getAgentDatasets() {
        const s = this.state || {};
        const cap = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);

        const products = cap(s.allProducts, 2000).map((p) => ({
            id: p.id,
            name: p.name,
            quantity: p.quantity,
            minStock: p.minStock,
            price: p.price,
            cost: p.cost,
            category: p.category,
            lastSold: p.lastSold,
            updatedAt: p.updatedAt,
            lastRestockedAt: p.lastRestockedAt,
            lastRestockSource: p.lastRestockSource,
        }));

        const sales = cap(s.allSales, 3500).map((sl) => ({
            date: sl.date,
            createdAt: sl.createdAt,
            product: sl.product,
            productId: sl.productId,
            quantity: sl.quantity,
            price: sl.price,
            discount: sl.discount,
        }));

        const purchase_orders = cap(s.allPurchaseOrders || [], 600).map((po) => ({
            id: po.id,
            status: po.status,
            receivedDate: po.receivedDate,
            items: Array.isArray(po.items)
                ? po.items.map((it) => ({
                    productId: it.productId,
                    productName: it.productName,
                    quantity: it.quantity,
                    receivedQuantity: it.receivedQuantity,
                }))
                : [],
        }));

        return { products, sales, purchase_orders };
    }

    getBusinessContext() {
        const s = this.state || {};
        const products = s.allProducts || [];
        const sales = s.allSales || [];
        const expenses = s.allExpenses || [];
        const operatingExpenses = expenses.filter(e => !isDebtPayment(e));
        const debtPaymentsFromExpenses = expenses.filter(e => isDebtPayment(e));
        const debtFromTx = (s.allLiabilityPayments || []).reduce(
            (sum, p) => sum + (parseFloat(p.amount) || 0),
            0
        );
        const totalRevenue = sales.reduce((sum, sl) => sum + getSaleTotal(sl), 0);
        const totalExpenses = operatingExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const totalDebtPayments =
            debtFromTx + debtPaymentsFromExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const lowStock = products.filter(p => (p.quantity || 0) <= (p.minStock || 10));

        return {
            total_products: products.length,
            total_sales: sales.length,
            total_revenue: totalRevenue.toFixed(2),
            operating_expenses: totalExpenses.toFixed(2),
            debt_payments: totalDebtPayments.toFixed(2),
            net_profit: (totalRevenue - totalExpenses).toFixed(2),
            low_stock_items: lowStock.length,
            currency: 'GHS (₵)',
        };
    }

    async send() {
        const { input, sendBtn } = this.elements;
        const text = input.value.trim();
        if (!text || this.isLoading) return;

        input.value = '';
        input.style.height = 'auto';
        sendBtn.disabled = true;

        this.elements.welcome.style.display = 'none';

        const history = this.messages.slice(-12).map((m) => ({
            role: m.role,
            content: m.text,
        }));

        this.appendMessage('user', text);
        this.showTyping();
        this.isLoading = true;

        try {
            const headers = { 'Content-Type': 'application/json' };
            try {
                const u = auth.currentUser;
                if (u) {
                    const token = await u.getIdToken();
                    headers.Authorization = `Bearer ${token}`;
                }
            } catch (tokErr) {
                console.warn('AI chat: ID token unavailable', tokErr);
            }

            const skill = SKILLS[this.activeSkill];
            const endpoint = `${BACKEND_URL}${skill.endpoint}`;

            const body = this.activeSkill === 'accountant'
                ? { question: text, history }
                : { question: text, context: this.getBusinessContext(), datasets: this.getAgentDatasets(), history };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });

            if (response.status === 401) {
                throw new Error('Please sign in to use the AI assistant.');
            }
            if (response.status === 429) {
                throw new Error('Too many AI requests. Please wait a moment and try again.');
            }
            if (!response.ok) throw new Error(`Server error (${response.status})`);

            const data = await response.json();
            this.hideTyping();

            const reply = data.response || 'No response received.';
            this.appendMessage('assistant', reply);

            // Show tools-called footnote for accountant
            if (this.activeSkill === 'accountant' && data.tools_called?.length) {
                this._appendToolsFootnote(data.tools_called, data.steps);
            }
        } catch (err) {
            this.hideTyping();
            this.appendError(err.message === 'Failed to fetch'
                ? 'Cannot reach the backend. Make sure the server is running.'
                : `Error: ${err.message}`
            );
        } finally {
            this.isLoading = false;
        }
    }

    appendMessage(role, text) {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const icon = role === 'user' ? 'fa-user' : 'fa-robot';
        const formattedText = role === 'assistant' ? this.formatMarkdown(text) : this.escapeHtml(text);

        const msg = document.createElement('div');
        msg.className = `ai-chat-msg ${role}`;
        msg.innerHTML = `
            <div class="ai-chat-msg-avatar"><i class="fas ${icon}"></i></div>
            <div>
                <div class="ai-chat-msg-bubble">${formattedText}</div>
                <div class="ai-chat-msg-time">${time}</div>
            </div>
        `;

        this.elements.messages.appendChild(msg);
        this.messages.push({ role, text });
        this.scrollToBottom();
    }

    showTyping() {
        const el = document.createElement('div');
        el.className = 'ai-chat-typing';
        el.id = 'ai-chat-typing';
        el.innerHTML = `
            <div class="ai-chat-msg-avatar"><i class="fas fa-robot"></i></div>
            <div class="ai-typing-dots"><span></span><span></span><span></span></div>
        `;
        this.elements.messages.appendChild(el);
        this.scrollToBottom();
    }

    hideTyping() {
        const el = document.getElementById('ai-chat-typing');
        if (el) el.remove();
    }

    _appendToolsFootnote(tools, steps) {
        const unique = [...new Set(tools)];
        const toolLabels = {
            get_financial_summary:  'P&L summary',
            get_sales_breakdown:    'Sales breakdown',
            get_expense_breakdown:  'Expense breakdown',
            get_liabilities:        'Liabilities',
            get_vat_summary:        'VAT summary',
            classify_expense:       'Expense classifier',
        };
        const labels = unique.map(t => toolLabels[t] || t).join(', ');
        const el = document.createElement('div');
        el.className = 'ai-chat-footnote';
        el.innerHTML = `<i class="fas fa-database"></i> Live data read: ${labels} · ${steps} step${steps !== 1 ? 's' : ''}`;
        this.elements.messages.appendChild(el);
        this.scrollToBottom();
    }

    appendError(text) {
        const el = document.createElement('div');
        el.className = 'ai-chat-error';
        el.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(text)}`;
        this.elements.messages.appendChild(el);
        this.scrollToBottom();
    }

    scrollToBottom() {
        const m = this.elements.messages;
        requestAnimationFrame(() => { m.scrollTop = m.scrollHeight; });
    }

    formatMarkdown(text) {
        if (!text) return '';
        let html = this.escapeHtml(text);

        // Bold: **text**
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Numbered lists: lines starting with "1. ", "2. " etc.
        html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ol>${match}</ol>`);

        // Bullet lists: lines starting with "- "
        html = html.replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
            if (match.includes('<ol>')) return match;
            return `<ul>${match}</ul>`;
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Paragraphs from double newlines
        html = html.replace(/\n{2,}/g, '</p><p>');
        html = '<p>' + html + '</p>';

        // Single newlines to <br> only inside <p> tags (not in lists)
        html = html.replace(/<p>(.*?)<\/p>/gs, (match, content) => {
            return '<p>' + content.replace(/\n/g, '<br>') + '</p>';
        });

        // Clean up empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');

        return html;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    openWithQuestion(question) {
        this.open();
        this.elements.welcome.style.display = 'none';
        this.elements.input.value = question;
        this.elements.sendBtn.disabled = false;
        this.send();
    }

    // ── Scheduler methods ──────────────────────────────────────────────────

    _onScheduledReport(report) {
        this.updateFabBadge();
        if (this._schedulePanelOpen) this._renderReportHistory();
    }

    updateFabBadge() {
        const fab = document.getElementById('ai-chat-fab');
        if (!fab) return;
        let badge = fab.querySelector('.fab-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'fab-badge';
            fab.appendChild(badge);
        }
        const count = accountantScheduler.getUnreadCount();
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.style.display = count > 0 ? 'flex' : 'none';
    }

    _openSchedulePanel() {
        const panel = this.elements.schedulePanel;
        if (!panel) return;
        this._schedulePanelOpen = true;
        this._loadScheduleIntoUI();
        this._renderReportHistory();
        panel.classList.add('open');
        accountantScheduler.clearUnread();
        this.updateFabBadge();
    }

    _closeSchedulePanel() {
        const panel = this.elements.schedulePanel;
        if (!panel) return;
        this._schedulePanelOpen = false;
        panel.classList.remove('open');
    }

    _loadScheduleIntoUI() {
        const cfg = accountantScheduler.getConfig();
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (typeof val === 'boolean') el.checked = val; else el.value = val;
        };
        const pad = n => String(n).padStart(2, '0');
        const showOpts = (type, on) => {
            const opts = document.getElementById(`sch-${type}-opts`);
            if (opts) opts.classList.toggle('visible', on);
        };

        setVal('sch-daily-enabled',  cfg.daily_pl.enabled);
        setVal('sch-daily-time',     `${pad(cfg.daily_pl.hour)}:${pad(cfg.daily_pl.minute)}`);
        showOpts('daily', cfg.daily_pl.enabled);

        setVal('sch-weekly-enabled', cfg.weekly_expense.enabled);
        setVal('sch-weekly-day',     String(cfg.weekly_expense.day));
        setVal('sch-weekly-time',    `${pad(cfg.weekly_expense.hour)}:${pad(cfg.weekly_expense.minute)}`);
        showOpts('weekly', cfg.weekly_expense.enabled);

        setVal('sch-monthly-enabled', cfg.monthly_vat.enabled);
        setVal('sch-monthly-day',     String(cfg.monthly_vat.dayOfMonth));
        setVal('sch-monthly-time',    `${pad(cfg.monthly_vat.hour)}:${pad(cfg.monthly_vat.minute)}`);
        showOpts('monthly', cfg.monthly_vat.enabled);
    }

    _saveScheduleFromUI() {
        const getTime = (id) => {
            const el = document.getElementById(id);
            if (!el || !el.value) return [7, 0];
            const [h, m] = el.value.split(':').map(Number);
            return [h || 0, m || 0];
        };
        const checked = (id) => document.getElementById(id)?.checked || false;
        const numVal  = (id, fallback) => parseInt(document.getElementById(id)?.value || fallback, 10) || fallback;

        const [dh, dm] = getTime('sch-daily-time');
        const [wh, wm] = getTime('sch-weekly-time');
        const [mh, mm] = getTime('sch-monthly-time');

        accountantScheduler.saveConfig({
            daily_pl:       { enabled: checked('sch-daily-enabled'),   hour: dh, minute: dm },
            weekly_expense: { enabled: checked('sch-weekly-enabled'),  day: numVal('sch-weekly-day', 1),       hour: wh, minute: wm },
            monthly_vat:    { enabled: checked('sch-monthly-enabled'), dayOfMonth: numVal('sch-monthly-day', 1), hour: mh, minute: mm },
        });

        const btn = document.getElementById('ai-schedule-save');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            btn.disabled = true;
            setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1500);
        }
    }

    _renderReportHistory() {
        const list = this.elements.historyList;
        if (!list) return;
        const reports = accountantScheduler.getRecentReports();
        if (!reports.length) {
            list.innerHTML = '<p class="ai-schedule-empty">No reports generated yet.</p>';
            return;
        }
        list.innerHTML = reports.slice(0, 5).map(r => {
            const info    = REPORT_TYPES[r.type] || { color: '#059669', icon: 'fa-file' };
            const date    = new Date(r.generatedAt);
            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
                            ' · ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const preview = (r.text || '').replace(/[#*`]/g, '').slice(0, 110) + (r.text?.length > 110 ? '…' : '');
            return `
                <div class="ai-report-card">
                    <div class="ai-report-card-header">
                        <span style="color:${info.color}"><i class="fas ${info.icon}"></i> ${r.label}</span>
                        <small>${dateStr}</small>
                    </div>
                    <p class="ai-report-card-preview">${this.escapeHtml(preview)}</p>
                    <button class="ai-report-open-btn" data-report-text="${this.escapeHtml(r.text || '')}">
                        Open in chat <i class="fas fa-arrow-right"></i>
                    </button>
                </div>`;
        }).join('');

        list.querySelectorAll('.ai-report-open-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.dataset.reportText;
                if (!text) return;
                this._closeSchedulePanel();
                if (this.activeSkill !== 'accountant') this.switchSkill('accountant');
                this.elements.welcome.style.display = 'none';
                this.appendMessage('assistant', text);
            });
        });
    }
}

const aiChatService = new AIChatService();
window.aiChatService = aiChatService;
export default aiChatService;
