/**
 * AI Chat Service — floating chat window for business Q&A
 */

import { auth } from '../config/firebase.js';
import { isDebtPayment, getSaleTotal } from '../utils/accounting.js';

const BACKEND_URL = window.BACKEND_URL || '';

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
    }

    init(state) {
        this.state = state;
        if (!this.injected) {
            this.injectHTML();
            this.bindEvents();
            this.injected = true;
        }
    }

    injectHTML() {
        const existing = document.getElementById('ai-chat-root');
        if (existing) existing.remove();

        const root = document.createElement('div');
        root.id = 'ai-chat-root';
        root.innerHTML = `
            <div class="ai-chat-window" id="ai-chat-window">
                <div class="ai-chat-header">
                    <div class="ai-chat-header-left">
                        <div class="ai-chat-avatar"><i class="fas fa-robot"></i></div>
                        <div class="ai-chat-header-info">
                            <h4>Business AI</h4>
                            <span>Online</span>
                        </div>
                    </div>
                    <div class="ai-chat-header-actions">
                        <button id="ai-chat-clear" title="Clear conversation"><i class="fas fa-trash-alt"></i></button>
                        <button id="ai-chat-close" title="Close"><i class="fas fa-times"></i></button>
                    </div>
                </div>

                <div class="ai-chat-messages" id="ai-chat-messages">
                    <div class="ai-chat-welcome" id="ai-chat-welcome">
                        <div class="ai-chat-welcome-icon"><i class="fas fa-robot"></i></div>
                        <h3>Business AI Assistant</h3>
                        <p>Ask me anything about your business — sales trends, inventory advice, expense analysis, or strategic recommendations.</p>
                        <div class="ai-chat-suggestions" id="ai-chat-suggestions">
                            <button class="ai-chat-suggestion" data-q="How are my sales performing this month?">
                                <i class="fas fa-chart-line"></i> How are my sales performing this month?
                            </button>
                            <button class="ai-chat-suggestion" data-q="Which products should I restock?">
                                <i class="fas fa-box"></i> Which products should I restock?
                            </button>
                            <button class="ai-chat-suggestion" data-q="How can I reduce my expenses?">
                                <i class="fas fa-piggy-bank"></i> How can I reduce my expenses?
                            </button>
                            <button class="ai-chat-suggestion" data-q="Give me a business health summary">
                                <i class="fas fa-heartbeat"></i> Give me a business health summary
                            </button>
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
                    <div class="ai-chat-context">
                        <i class="fas fa-database"></i>
                        <span>Answers use structured metrics from your loaded sales, inventory, and purchase orders</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        this.elements = {
            window: document.getElementById('ai-chat-window'),
            messages: document.getElementById('ai-chat-messages'),
            welcome: document.getElementById('ai-chat-welcome'),
            input: document.getElementById('ai-chat-input'),
            sendBtn: document.getElementById('ai-chat-send'),
            closeBtn: document.getElementById('ai-chat-close'),
            clearBtn: document.getElementById('ai-chat-clear'),
            suggestions: document.getElementById('ai-chat-suggestions'),
        };

        // Defensive: ensure FAB is never treated as disabled (especially in native app webviews).
        this.ensureLauncherButtons();
        this.bindLauncherButtons();
    }

    ensureLauncherButtons() {
        const addIfMissing = (container, id, label, icon) => {
            if (!container || document.getElementById(id)) return null;
            const btn = document.createElement('button');
            btn.id = id;
            btn.type = 'button';
            btn.className = 'ai-chat-launcher-btn';
            btn.setAttribute('aria-label', 'Open AI assistant');
            btn.innerHTML = `<i class="${icon}"></i> <span>${label}</span>`;
            container.appendChild(btn);
            return btn;
        };

        // Header launcher (desktop/tablet and webview-safe)
        const authControls = document.getElementById('auth-controls');
        addIfMissing(authControls, 'ai-chat-launcher-header', 'AI Assistant', 'fas fa-robot');

        // Mobile bottom nav launcher
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
            document.getElementById('ai-chat-launcher-header'),
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
        this.messages = [];
        this.elements.messages.innerHTML = '';
        this.elements.messages.appendChild(this.elements.welcome);
        this.elements.welcome.style.display = 'flex';
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

            const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    question: text,
                    context: this.getBusinessContext(),
                    datasets: this.getAgentDatasets(),
                    history,
                })
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
            this.appendMessage('assistant', data.response || 'No response received.');
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
}

const aiChatService = new AIChatService();
window.aiChatService = aiChatService;
export default aiChatService;
