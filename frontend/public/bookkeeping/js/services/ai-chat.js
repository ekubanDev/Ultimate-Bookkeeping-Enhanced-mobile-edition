/**
 * AI Chat Service — floating chat window for business Q&A
 */

const BACKEND_URL = window.BACKEND_URL || '';

class AIChatService {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.isLoading = false;
        this.state = null;
        this.elements = {};
        this.injected = false;
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
            <button class="ai-chat-fab" id="ai-chat-fab" title="Ask AI">
                <span class="fab-pulse"></span>
                <i class="fas fa-robot"></i>
            </button>

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
                        <span>Using your live business data for context</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        this.elements = {
            fab: document.getElementById('ai-chat-fab'),
            window: document.getElementById('ai-chat-window'),
            messages: document.getElementById('ai-chat-messages'),
            welcome: document.getElementById('ai-chat-welcome'),
            input: document.getElementById('ai-chat-input'),
            sendBtn: document.getElementById('ai-chat-send'),
            closeBtn: document.getElementById('ai-chat-close'),
            clearBtn: document.getElementById('ai-chat-clear'),
            suggestions: document.getElementById('ai-chat-suggestions'),
        };
    }

    bindEvents() {
        const { fab, closeBtn, clearBtn, input, sendBtn, suggestions } = this.elements;

        fab.addEventListener('click', () => this.toggle());
        closeBtn.addEventListener('click', () => this.close());
        clearBtn.addEventListener('click', () => this.clearConversation());

        sendBtn.addEventListener('click', () => this.send());

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

        suggestions.addEventListener('click', (e) => {
            const btn = e.target.closest('.ai-chat-suggestion');
            if (btn) {
                const q = btn.dataset.q;
                input.value = q;
                sendBtn.disabled = false;
                this.send();
            }
        });

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
        this.elements.fab.classList.add('hidden');
        setTimeout(() => this.elements.input.focus(), 300);
    }

    close() {
        this.isOpen = false;
        const win = this.elements.window;
        const hadScrollLock = this._aiBodyOverflow !== undefined;
        win.classList.remove('open');
        win.classList.remove('ai-chat-window--fullscreen');
        this.elements.fab.classList.remove('hidden');
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

    getBusinessContext() {
        const s = this.state || {};
        const products = s.allProducts || [];
        const sales = s.allSales || [];
        const expenses = s.allExpenses || [];
        const operatingExpenses = expenses.filter(e => {
            const type = (e.expenseType || '').toLowerCase();
            const cat = (e.category || '').toLowerCase();
            return type !== 'liability_payment' && cat !== 'debt payment' && cat !== 'loan repayment';
        });
        const debtPayments = expenses.filter(e => {
            const type = (e.expenseType || '').toLowerCase();
            const cat = (e.category || '').toLowerCase();
            return type === 'liability_payment' || cat === 'debt payment' || cat === 'loan repayment';
        });
        const totalRevenue = sales.reduce((sum, sl) => sum + (sl.quantity || 0) * (sl.price || 0), 0);
        const totalExpenses = operatingExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const totalDebtPayments = debtPayments.reduce((sum, e) => sum + (e.amount || 0), 0);
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

        this.appendMessage('user', text);
        this.showTyping();
        this.isLoading = true;

        try {
            const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: text,
                    context: this.getBusinessContext()
                })
            });

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
