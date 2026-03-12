/**
 * Enhanced Dashboard Analytics Service
 * Provides AI-powered insights, advanced visualizations, and comprehensive metrics
 */

const BACKEND_URL = window.BACKEND_URL || '';

export class EnhancedDashboard {
    constructor() {
        this.charts = {};
        this.aiInsights = null;
        this.forecast = null;
        this.isLoading = false;
        this.dashboardThemes = [
            { id: 'midnight', label: 'Midnight', desc: 'Default dark', color: '#0f1419' },
            { id: 'daylight', label: 'Daylight', desc: 'Clean light', color: '#f0f2f5' },
            { id: 'ocean',    label: 'Ocean',    desc: 'Cool blue',   color: '#0c1929' },
            { id: 'emerald',  label: 'Emerald',  desc: 'Rich green',  color: '#071a12' },
            { id: 'sunset',   label: 'Sunset',   desc: 'Warm amber',  color: '#1a1008' },
            { id: 'royal',    label: 'Royal',     desc: 'Deep purple', color: '#13091f' },
        ];
        this.currentDashboardTheme = localStorage.getItem('dashboard-theme') || 'midnight';
        this.applyDashboardTheme(this.currentDashboardTheme);
    }

    /**
     * Initialize enhanced dashboard
     */
    async init(state) {
        console.log('🚀 Initializing Enhanced Dashboard...');
        this.state = state;
        if (window.aiChatService) window.aiChatService.state = state;
        await this.render();
    }

    /**
     * Render the complete enhanced dashboard
     */
    async render() {
        const container = document.getElementById('dashboard');
        if (!container) return;

        // Add enhanced class for styling
        container.classList.add('enhanced-dashboard');
        
        const period = document.getElementById('date-filter')?.value || 'month';
        const metrics = this.calculateMetrics(period);
        
        container.innerHTML = this.buildDashboardHTML(metrics, period);
        
        // Initialize charts after DOM is ready
        setTimeout(() => {
            this.initializeCharts(period);
        }, 100);

        // Load AI insights asynchronously
        this.loadAIInsights(period);
    }

    /**
     * Calculate all dashboard metrics
     */
    calculateMetrics(period) {
        const { start, end } = this.getDateRange(period);
        const { start: prevStart, end: prevEnd } = this.getPreviousPeriodRange(period);

        // Current period data
        const currentSales = (this.state?.allSales || []).filter(s => s.date >= start && s.date <= end);
        const allCurrentExpenses = (this.state?.allExpenses || []).filter(e => e.date >= start && e.date <= end);
        const currentExpenses = allCurrentExpenses.filter(e => !this.isDebtPayment(e));
        const currentDebtPayments = allCurrentExpenses.filter(e => this.isDebtPayment(e));

        // Previous period data for comparison
        const prevSales = (this.state?.allSales || []).filter(s => s.date >= prevStart && s.date <= prevEnd);
        const prevExpenses = (this.state?.allExpenses || []).filter(e => e.date >= prevStart && e.date <= prevEnd && !this.isDebtPayment(e));

        // Revenue calculations
        const revenue = this.calculateRevenue(currentSales);
        const prevRevenue = this.calculateRevenue(prevSales);
        const revenueChange = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue * 100) : 0;

        // Expense calculations (operating expenses only, excludes debt payments)
        const expenses = currentExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const debtPayments = currentDebtPayments.reduce((sum, e) => sum + (e.amount || 0), 0);
        const prevExpensesTotal = prevExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const expenseChange = prevExpensesTotal > 0 ? ((expenses - prevExpensesTotal) / prevExpensesTotal * 100) : 0;

        // COGS calculation
        const cogs = this.calculateCOGS(currentSales);
        const grossProfit = revenue - cogs;
        const netProfit = grossProfit - expenses;
        const prevNetProfit = this.calculateRevenue(prevSales) - this.calculateCOGS(prevSales) - prevExpensesTotal;
        const profitChange = prevNetProfit !== 0 ? ((netProfit - prevNetProfit) / Math.abs(prevNetProfit) * 100) : 0;

        // Inventory metrics
        const products = this.state?.allProducts || [];
        const inventoryValue = products.reduce((sum, p) => sum + (p.quantity || 0) * (p.cost || 0), 0);
        const lowStockCount = products.filter(p => (p.quantity || 0) <= (p.minStock || 10)).length;
        const outOfStockCount = products.filter(p => (p.quantity || 0) === 0).length;

        // Top products
        const topProducts = this.getTopProducts(currentSales, 5);
        
        // Top customers
        const topCustomers = this.getTopCustomers(currentSales, 5);

        // Sales by category
        const salesByCategory = this.getSalesByCategory(currentSales);

        // Daily sales trend
        const dailySales = this.getDailySalesTrend(currentSales, period);

        // Gross margin
        const grossMargin = revenue > 0 ? ((revenue - cogs) / revenue * 100) : 0;

        // Inventory turnover
        const avgInventory = products.reduce((sum, p) => sum + (p.quantity || 0), 0);
        const totalQtySold = currentSales.reduce((sum, s) => sum + (s.quantity || 0), 0);
        const turnover = avgInventory > 0 ? (totalQtySold / avgInventory) : 0;

        // Customer metrics
        const customerPurchases = {};
        currentSales.forEach(s => {
            customerPurchases[s.customer] = (customerPurchases[s.customer] || 0) + 1;
        });
        const repeatCustomers = Object.values(customerPurchases).filter(c => c > 1).length;
        const totalCustomers = Object.keys(customerPurchases).length;
        const repeatRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers * 100) : 0;

        // Transactions count
        const transactionCount = currentSales.length;
        const avgTransactionValue = transactionCount > 0 ? revenue / transactionCount : 0;

        return {
            revenue,
            revenueChange,
            expenses,
            debtPayments,
            expenseChange,
            netProfit,
            profitChange,
            grossProfit,
            grossMargin,
            cogs,
            inventoryValue,
            lowStockCount,
            outOfStockCount,
            turnover,
            repeatRate,
            transactionCount,
            avgTransactionValue,
            topProducts,
            topCustomers,
            salesByCategory,
            dailySales,
            totalCustomers
        };
    }

    isDebtPayment(expense) {
        const type = (expense.expenseType || '').toLowerCase();
        const cat = (expense.category || '').toLowerCase();
        return type === 'liability_payment'
            || cat === 'debt payment'
            || cat === 'loan repayment';
    }

    getThemeColor(varName) {
        const dashboard = document.getElementById('dashboard');
        if (!dashboard) return '';
        return getComputedStyle(dashboard).getPropertyValue(varName).trim();
    }

    applyDashboardTheme(themeId) {
        this.currentDashboardTheme = themeId;
        document.documentElement.setAttribute('data-dashboard-theme', themeId);
        localStorage.setItem('dashboard-theme', themeId);
    }

    toggleThemePicker() {
        const dropdown = document.getElementById('dashboard-theme-dropdown');
        if (!dropdown) return;
        dropdown.classList.toggle('open');

        const closeOnClick = (e) => {
            if (!e.target.closest('.dashboard-theme-picker')) {
                dropdown.classList.remove('open');
                document.removeEventListener('click', closeOnClick);
            }
        };
        if (dropdown.classList.contains('open')) {
            setTimeout(() => document.addEventListener('click', closeOnClick), 0);
        }
    }

    setDashboardTheme(themeId) {
        this.applyDashboardTheme(themeId);
        const dropdown = document.getElementById('dashboard-theme-dropdown');
        if (dropdown) {
            dropdown.innerHTML = this.buildThemeOptions();
            dropdown.classList.remove('open');
        }
        // Re-render charts so they pick up new theme colors
        setTimeout(() => {
            this.initRevenueTrendChart();
            this.initCategoryChart();
        }, 50);
    }

    buildThemeOptions() {
        return this.dashboardThemes.map(t => `
            <button class="theme-option ${t.id === this.currentDashboardTheme ? 'active' : ''}"
                    onclick="window.enhancedDashboard?.setDashboardTheme('${t.id}')">
                <span class="theme-option-swatch" style="background: ${t.color};"></span>
                <span>
                    <span class="theme-option-label">${t.label}</span><br>
                    <span class="theme-option-desc">${t.desc}</span>
                </span>
            </button>
        `).join('');
    }

    /**
     * Build dashboard HTML
     */
    buildDashboardHTML(metrics, period) {
        const currencySymbol = '₵';
        
        return `
            <div class="dashboard-header">
                <h2><i class="fas fa-chart-line"></i> Analytics Dashboard</h2>
                <div class="dashboard-controls">
                    <select id="date-filter" class="enhanced-filter" onchange="window.enhancedDashboard?.render()">
                        <option value="week" ${period === 'week' ? 'selected' : ''}>Last Week</option>
                        <option value="month" ${period === 'month' ? 'selected' : ''}>Last Month</option>
                        <option value="quarter" ${period === 'quarter' ? 'selected' : ''}>Last Quarter</option>
                        <option value="year" ${period === 'year' ? 'selected' : ''}>Last Year</option>
                        <option value="all" ${period === 'all' ? 'selected' : ''}>All Time</option>
                    </select>
                    <div class="dashboard-theme-picker">
                        <button class="theme-picker-btn" onclick="window.enhancedDashboard?.toggleThemePicker()">
                            <i class="fas fa-palette"></i> Theme
                        </button>
                        <div class="theme-picker-dropdown" id="dashboard-theme-dropdown">
                            ${this.buildThemeOptions()}
                        </div>
                    </div>
                    <button class="ask-ai-btn" onclick="window.enhancedDashboard?.showAIChat()">
                        <i class="fas fa-robot"></i> Ask AI
                    </button>
                </div>
            </div>

            <!-- KPI Cards -->
            <div class="kpi-grid">
                ${this.buildKPICard('Total Revenue', `${currencySymbol}${this.formatNumber(metrics.revenue)}`, metrics.revenueChange, 'fa-coins', 'green', 'positive')}
                ${this.buildKPICard('Net Profit', `${currencySymbol}${this.formatNumber(metrics.netProfit)}`, metrics.profitChange, 'fa-chart-line', metrics.netProfit >= 0 ? 'green' : 'red', metrics.netProfit >= 0 ? 'positive' : 'negative')}
                ${this.buildKPICard('Operating Expenses', `${currencySymbol}${this.formatNumber(metrics.expenses)}`, -metrics.expenseChange, 'fa-credit-card', 'red', 'negative')}
                ${this.buildKPICard('Debt Payments', `${currencySymbol}${this.formatNumber(metrics.debtPayments)}`, 0, 'fa-hand-holding-usd', 'gold', 'warning')}
            </div>

            <!-- Secondary KPIs -->
            <div class="kpi-grid" style="margin-bottom: 1.5rem;">
                ${this.buildKPICard('Gross Margin', `${metrics.grossMargin.toFixed(1)}%`, 0, 'fa-percentage', 'purple', 'neutral')}
                ${this.buildKPICard('Turnover Rate', `${metrics.turnover.toFixed(1)}x`, 0, 'fa-sync', 'blue', 'neutral')}
                ${this.buildKPICard('Repeat Customers', `${metrics.repeatRate.toFixed(1)}%`, 0, 'fa-users', 'gold', 'warning')}
                ${this.buildKPICard('Avg. Transaction', `${currencySymbol}${this.formatNumber(metrics.avgTransactionValue)}`, 0, 'fa-receipt', 'blue', 'neutral')}
            </div>

            <!-- AI Insights Panel -->
            <div class="ai-insights-panel" id="ai-insights-panel">
                <div class="ai-header">
                    <span class="ai-badge"><i class="fas fa-sparkles"></i> AI-Powered</span>
                    <span class="ai-title">Business Insights</span>
                    <button class="refresh-btn" onclick="window.enhancedDashboard?.loadAIInsights('${period}')" title="Refresh Insights">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
                <div class="ai-content" id="ai-insights-content">
                    <div class="ai-loading">
                        <i class="fas fa-circle-notch"></i>
                        Loading AI insights...
                    </div>
                </div>
            </div>

            <!-- Charts Row -->
            <div class="charts-grid">
                <div class="chart-card">
                    <div class="chart-header">
                        <span class="chart-title"><i class="fas fa-chart-area"></i> Revenue Trend</span>
                        <div class="chart-actions">
                            <button class="chart-btn active" data-view="line">Line</button>
                            <button class="chart-btn" data-view="bar">Bar</button>
                        </div>
                    </div>
                    <div class="chart-container">
                        <canvas id="revenue-trend-chart"></canvas>
                    </div>
                </div>
                <div class="chart-card">
                    <div class="chart-header">
                        <span class="chart-title"><i class="fas fa-chart-pie"></i> Sales by Category</span>
                    </div>
                    <div class="chart-container">
                        <canvas id="category-chart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Analytics Row -->
            <div class="analytics-row">
                <!-- Top Products -->
                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <span class="analytics-card-title"><i class="fas fa-trophy"></i> Top Products</span>
                    </div>
                    <ul class="analytics-list">
                        ${metrics.topProducts.map((p, i) => this.buildProductListItem(p, i)).join('')}
                        ${metrics.topProducts.length === 0 ? '<li class="analytics-list-item"><span style="color: var(--text-muted);">No sales data</span></li>' : ''}
                    </ul>
                </div>

                <!-- Top Customers -->
                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <span class="analytics-card-title"><i class="fas fa-users"></i> Top Customers</span>
                    </div>
                    <ul class="analytics-list">
                        ${metrics.topCustomers.map((c, i) => this.buildCustomerListItem(c, i)).join('')}
                        ${metrics.topCustomers.length === 0 ? '<li class="analytics-list-item"><span style="color: var(--text-muted);">No customer data</span></li>' : ''}
                    </ul>
                </div>

                <!-- Forecast Card -->
                <div class="forecast-card" id="forecast-card">
                    <div class="forecast-header">
                        <span class="forecast-title"><i class="fas fa-crystal-ball"></i> Sales Forecast</span>
                        <span class="forecast-trend stable" id="forecast-trend">
                            <i class="fas fa-minus"></i> Calculating...
                        </span>
                    </div>
                    <div id="forecast-content">
                        <div class="ai-loading">
                            <i class="fas fa-circle-notch"></i>
                            Generating forecast...
                        </div>
                    </div>
                </div>
            </div>

            <!-- Stock Alerts & Activity -->
            <div class="charts-grid">
                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <span class="analytics-card-title"><i class="fas fa-exclamation-triangle" style="color: var(--accent-gold);"></i> Stock Alerts</span>
                        <span style="color: var(--text-muted); font-size: 0.8rem;">${metrics.lowStockCount} items need attention</span>
                    </div>
                    ${this.buildStockAlerts()}
                </div>
                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <span class="analytics-card-title"><i class="fas fa-history"></i> Recent Activity</span>
                    </div>
                    <div class="activity-feed" id="activity-feed">
                        ${this.buildActivityFeed()}
                    </div>
                </div>
            </div>

            ${this.buildOutletPerformance()}
        `;
    }

    /**
     * Build KPI Card HTML
     */
    buildKPICard(label, value, change, icon, iconColor, cardType) {
        const changeIcon = change > 0 ? 'fa-arrow-up' : change < 0 ? 'fa-arrow-down' : 'fa-minus';
        const changeClass = change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';
        
        return `
            <div class="kpi-card ${cardType}">
                <div class="kpi-header">
                    <span class="kpi-label">${label}</span>
                    <div class="kpi-icon ${iconColor}">
                        <i class="fas ${icon}"></i>
                    </div>
                </div>
                <div class="kpi-value">${value}</div>
                ${change !== 0 ? `
                    <div class="kpi-change ${changeClass}">
                        <i class="fas ${changeIcon}"></i>
                        ${Math.abs(change).toFixed(1)}% vs prev period
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Build product list item
     */
    buildProductListItem(product, index) {
        const maxQty = (this.state?.allSales || []).reduce((max, s) => Math.max(max, s.quantity || 0), 1);
        const percentage = (product.quantity / maxQty * 100) || 0;
        
        return `
            <li class="analytics-list-item">
                <span class="analytics-item-rank ${index === 0 ? 'gold' : ''}">${index + 1}</span>
                <div class="analytics-item-info">
                    <div class="analytics-item-name">${this.escapeHtml(product.name)}</div>
                    <div class="analytics-item-meta">${product.quantity} units sold</div>
                </div>
                <span class="analytics-item-value">₵${this.formatNumber(product.revenue)}</span>
                <div class="progress-bar-container">
                    <div class="progress-bar">
                        <div class="progress-bar-fill ${index === 0 ? 'gold' : 'blue'}" style="width: ${percentage}%"></div>
                    </div>
                </div>
            </li>
        `;
    }

    /**
     * Build customer list item
     */
    buildCustomerListItem(customer, index) {
        return `
            <li class="analytics-list-item">
                <span class="analytics-item-rank ${index === 0 ? 'gold' : ''}">${index + 1}</span>
                <div class="analytics-item-info">
                    <div class="analytics-item-name">${this.escapeHtml(customer.name)}</div>
                    <div class="analytics-item-meta">${customer.transactions} transactions</div>
                </div>
                <span class="analytics-item-value">₵${this.formatNumber(customer.total)}</span>
            </li>
        `;
    }

    /**
     * Build stock alerts section
     */
    buildStockAlerts() {
        const products = this.state?.allProducts || [];
        const lowStock = products
            .filter(p => (p.quantity || 0) <= (p.minStock || 10))
            .sort((a, b) => (a.quantity || 0) - (b.quantity || 0))
            .slice(0, 5);

        if (lowStock.length === 0) {
            return `<p style="color: var(--text-muted); padding: 1rem; text-align: center;">All stock levels are healthy!</p>`;
        }

        return `
            <ul class="analytics-list">
                ${lowStock.map(p => `
                    <li class="analytics-list-item">
                        <div class="activity-icon ${p.quantity === 0 ? 'expense' : 'inventory'}">
                            <i class="fas ${p.quantity === 0 ? 'fa-times-circle' : 'fa-exclamation'}"></i>
                        </div>
                        <div class="analytics-item-info">
                            <div class="analytics-item-name">${this.escapeHtml(p.name)}</div>
                            <div class="analytics-item-meta">${p.category || 'Uncategorized'}</div>
                        </div>
                        <span style="color: ${p.quantity === 0 ? 'var(--accent-red)' : 'var(--accent-gold)'}; font-weight: 600;">
                            ${p.quantity || 0} left
                        </span>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    /**
     * Build activity feed
     */
    buildActivityFeed() {
        const activities = [];
        
        // Add recent sales
        (this.state?.allSales || []).slice(-10).forEach(s => {
            activities.push({
                type: 'sale',
                text: `Sale to ${s.customer}`,
                meta: s.product,
                amount: s.quantity * s.price,
                date: s.date,
                positive: true
            });
        });

        // Add recent expenses
        (this.state?.allExpenses || []).slice(-5).forEach(e => {
            activities.push({
                type: 'expense',
                text: e.description,
                meta: e.category,
                amount: e.amount,
                date: e.date,
                positive: false
            });
        });

        // Sort by date
        activities.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (activities.length === 0) {
            return `<p style="color: var(--text-muted); padding: 1rem; text-align: center;">No recent activity</p>`;
        }

        return activities.slice(0, 10).map(a => `
            <div class="activity-item">
                <div class="activity-icon ${a.type}">
                    <i class="fas ${a.type === 'sale' ? 'fa-shopping-cart' : 'fa-receipt'}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-text">${this.escapeHtml(a.text)}</div>
                    <div class="activity-time">${this.escapeHtml(a.meta)} • ${this.formatDate(a.date)}</div>
                </div>
                <span class="activity-amount ${a.positive ? 'positive' : 'negative'}">
                    ${a.positive ? '+' : '-'}₵${this.formatNumber(a.amount)}
                </span>
            </div>
        `).join('');
    }

    /**
     * Build outlet performance section
     */
    buildOutletPerformance() {
        const outlets = this.state?.allOutlets || [];
        const activeOutlets = outlets.filter(o => o.status === 'active');
        const mainRevenue = this.getMainShopRevenue();
        const mainSalesCount = this.getMainShopSalesCount();
        const mainAvgTransaction = mainSalesCount > 0 ? mainRevenue / mainSalesCount : 0;
        const totalAllRevenue = mainRevenue + activeOutlets.reduce((sum, o) => sum + this.getOutletRevenue(o.id), 0);

        return `
            <div class="analytics-card" style="margin-top: 1.5rem;">
                <div class="analytics-card-header">
                    <span class="analytics-card-title"><i class="fas fa-store"></i> Outlet Performance</span>
                    <span style="font-size: 0.8rem; color: var(--text-muted);">${activeOutlets.length + 1} location${activeOutlets.length > 0 ? 's' : ''}</span>
                </div>
                <div class="outlet-grid">
                    <div class="outlet-card main">
                        <span class="outlet-badge">MAIN</span>
                        <div class="outlet-name">Main Shop</div>
                        <div class="outlet-location">Primary Location</div>
                        <div class="outlet-stats">
                            <div class="outlet-stat">
                                <div class="outlet-stat-value">₵${this.formatNumber(mainRevenue)}</div>
                                <div class="outlet-stat-label">Revenue</div>
                            </div>
                            <div class="outlet-stat">
                                <div class="outlet-stat-value">${mainSalesCount}</div>
                                <div class="outlet-stat-label">Sales</div>
                            </div>
                            <div class="outlet-stat">
                                <div class="outlet-stat-value">₵${this.formatNumber(mainAvgTransaction)}</div>
                                <div class="outlet-stat-label">Avg. Sale</div>
                            </div>
                            <div class="outlet-stat">
                                <div class="outlet-stat-value">${totalAllRevenue > 0 ? ((mainRevenue / totalAllRevenue) * 100).toFixed(0) : 100}%</div>
                                <div class="outlet-stat-label">Share</div>
                            </div>
                        </div>
                    </div>
                    ${activeOutlets.map(outlet => {
                        const outletRev = this.getOutletRevenue(outlet.id);
                        const outletSales = this.getOutletSales(outlet.id);
                        const outletSalesCount = outletSales.length;
                        const outletAvg = outletSalesCount > 0 ? outletRev / outletSalesCount : 0;
                        return `
                        <div class="outlet-card">
                            <div class="outlet-name">${this.escapeHtml(outlet.name)}</div>
                            <div class="outlet-location">${this.escapeHtml(outlet.location || '')}</div>
                            <div class="outlet-stats">
                                <div class="outlet-stat">
                                    <div class="outlet-stat-value">₵${this.formatNumber(outletRev)}</div>
                                    <div class="outlet-stat-label">Revenue</div>
                                </div>
                                <div class="outlet-stat">
                                    <div class="outlet-stat-value">${outletSalesCount}</div>
                                    <div class="outlet-stat-label">Sales</div>
                                </div>
                                <div class="outlet-stat">
                                    <div class="outlet-stat-value">₵${this.formatNumber(outletAvg)}</div>
                                    <div class="outlet-stat-label">Avg. Sale</div>
                                </div>
                                <div class="outlet-stat">
                                    <div class="outlet-stat-value">${outlet.commissionRate || 15}%</div>
                                    <div class="outlet-stat-label">Commission</div>
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
                ${activeOutlets.length === 0 ? `
                    <div style="text-align: center; padding: 1rem 0; color: var(--text-muted); font-size: 0.85rem;">
                        <i class="fas fa-info-circle"></i> No outlets configured yet. Add outlets in Settings to track multi-location performance.
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Initialize all charts
     */
    initializeCharts(period) {
        this.initRevenueTrendChart(period);
        this.initCategoryChart();
    }

    /**
     * Initialize revenue trend chart
     */
    initRevenueTrendChart(period) {
        const ctx = document.getElementById('revenue-trend-chart');
        if (!ctx) return;

        const dailySales = this.getDailySalesTrend(this.state?.allSales || [], period);
        
        if (this.charts.revenueTrend) {
            this.charts.revenueTrend.destroy();
        }

        const accentGreen = this.getThemeColor('--accent-green') || '#00c853';
        const accentGreenSoft = this.getThemeColor('--accent-green-soft') || 'rgba(0, 200, 83, 0.1)';
        const cardSurface = this.getThemeColor('--card-surface') || '#1a1f26';
        const textPrimary = this.getThemeColor('--text-primary') || '#e7e9ea';
        const textSecondary = this.getThemeColor('--text-secondary') || '#71767b';
        const borderSubtle = this.getThemeColor('--border-subtle') || 'rgba(255,255,255,0.05)';

        this.charts.revenueTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dailySales.map(d => d.date),
                datasets: [{
                    label: 'Revenue',
                    data: dailySales.map(d => d.revenue),
                    borderColor: accentGreen,
                    backgroundColor: accentGreenSoft,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: accentGreen
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: cardSurface,
                        titleColor: textPrimary,
                        bodyColor: textSecondary,
                        borderColor: borderSubtle,
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            label: (ctx) => `₵${ctx.parsed.y.toLocaleString()}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textSecondary, maxTicksLimit: 8 }
                    },
                    y: {
                        grid: { color: borderSubtle },
                        ticks: {
                            color: textSecondary,
                            callback: (val) => '₵' + val.toLocaleString()
                        }
                    }
                }
            }
        });
    }

    /**
     * Initialize category chart
     */
    initCategoryChart() {
        const ctx = document.getElementById('category-chart');
        if (!ctx) return;

        const salesByCategory = this.getSalesByCategory(this.state?.allSales || []);
        const colors = [
            this.getThemeColor('--accent-green') || '#00c853',
            this.getThemeColor('--accent-blue') || '#1d9bf0',
            this.getThemeColor('--accent-gold') || '#ffd54f',
            this.getThemeColor('--accent-red') || '#ff5252',
            this.getThemeColor('--accent-purple') || '#9c27b0',
            '#00bcd4'
        ];

        if (this.charts.category) {
            this.charts.category.destroy();
        }

        const catCardSurface = this.getThemeColor('--card-surface') || '#1a1f26';
        const catTextPrimary = this.getThemeColor('--text-primary') || '#e7e9ea';
        const catTextSecondary = this.getThemeColor('--text-secondary') || '#71767b';

        this.charts.category = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: salesByCategory.map(c => c.category),
                datasets: [{
                    data: salesByCategory.map(c => c.revenue),
                    backgroundColor: colors.slice(0, salesByCategory.length),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: catTextSecondary,
                            padding: 15,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        backgroundColor: catCardSurface,
                        titleColor: catTextPrimary,
                        bodyColor: catTextSecondary,
                        callbacks: {
                            label: (ctx) => `₵${ctx.parsed.toLocaleString()}`
                        }
                    }
                }
            }
        });
    }

    /**
     * Load AI insights from backend
     */
    async loadAIInsights(period) {
        const contentEl = document.getElementById('ai-insights-content');
        const refreshBtn = document.querySelector('.refresh-btn');
        
        if (refreshBtn) refreshBtn.classList.add('loading');
        
        try {
            const response = await fetch(`${BACKEND_URL}/api/ai/insights`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sales_data: this.state?.allSales || [],
                    expenses_data: this.state?.allExpenses || [],
                    products_data: this.state?.allProducts || [],
                    period: period,
                    analysis_type: 'general'
                })
            });

            if (!response.ok) throw new Error('Failed to load insights');
            
            const data = await response.json();
            this.aiInsights = data;
            
            if (contentEl) {
                contentEl.innerHTML = `
                    <div class="ai-summary">
                        ${data.insights || 'No insights available.'}
                    </div>
                    <div class="ai-recommendations">
                        <h4><i class="fas fa-lightbulb"></i> Recommendations</h4>
                        <ul>
                            ${(data.recommendations || []).map(r => `<li>${this.escapeHtml(r)}</li>`).join('')}
                        </ul>
                    </div>
                    <div class="ai-alerts">
                        <h4><i class="fas fa-bell"></i> Alerts</h4>
                        <ul>
                            ${(data.alerts || []).filter(a => a).map(a => `<li>${this.escapeHtml(a)}</li>`).join('') || '<li>No alerts</li>'}
                        </ul>
                    </div>
                `;
            }

            // Load forecast
            this.loadForecast();

        } catch (error) {
            console.error('AI insights error:', error);
            if (contentEl) {
                contentEl.innerHTML = `
                    <div class="ai-summary">
                        <strong>Summary:</strong> Unable to load AI insights. The analysis requires backend connection.
                    </div>
                    <div class="ai-recommendations">
                        <h4><i class="fas fa-lightbulb"></i> Quick Tips</h4>
                        <ul>
                            <li>Review low stock items regularly</li>
                            <li>Track your top-selling products</li>
                            <li>Monitor expense categories</li>
                        </ul>
                    </div>
                    <div class="ai-alerts">
                        <h4><i class="fas fa-bell"></i> Alerts</h4>
                        <ul>
                            <li>Check inventory levels</li>
                        </ul>
                    </div>
                `;
            }
        } finally {
            if (refreshBtn) refreshBtn.classList.remove('loading');
        }
    }

    /**
     * Load sales forecast
     */
    async loadForecast() {
        const contentEl = document.getElementById('forecast-content');
        const trendEl = document.getElementById('forecast-trend');
        
        try {
            const response = await fetch(`${BACKEND_URL}/api/ai/forecast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    historical_sales: this.state?.allSales || [],
                    forecast_days: 30
                })
            });

            if (!response.ok) throw new Error('Forecast failed');
            
            const data = await response.json();
            this.forecast = data;

            if (contentEl) {
                contentEl.innerHTML = `
                    <div class="forecast-value">₵${this.formatNumber(data.predicted_daily_average || 0)}</div>
                    <div class="forecast-label">Predicted Daily Average (Next 30 Days)</div>
                    <div style="margin-top: 0.75rem; font-size: 0.8rem; color: var(--text-muted);">
                        Confidence: ${data.confidence || 'Medium'}
                    </div>
                `;
            }

            if (trendEl) {
                const trend = data.trend || 'stable';
                const icon = trend === 'up' ? 'fa-arrow-up' : trend === 'down' ? 'fa-arrow-down' : 'fa-minus';
                trendEl.className = `forecast-trend ${trend}`;
                trendEl.innerHTML = `<i class="fas ${icon}"></i> ${trend.charAt(0).toUpperCase() + trend.slice(1)}`;
            }

        } catch (error) {
            console.error('Forecast error:', error);
            if (contentEl) {
                const avgSale = this.calculateAverageDailySales();
                contentEl.innerHTML = `
                    <div class="forecast-value">₵${this.formatNumber(avgSale)}</div>
                    <div class="forecast-label">Average Daily Sales (Historical)</div>
                `;
            }
        }
    }

    /**
     * Show AI chat window
     */
    showAIChat() {
        if (window.aiChatService) {
            window.aiChatService.state = this.state;
            window.aiChatService.open();
        }
    }

    // ==================== UTILITY METHODS ====================

    calculateRevenue(sales) {
        return sales.reduce((sum, s) => {
            const subtotal = (s.quantity || 0) * (s.price || 0);
            const discounted = subtotal * (1 - (s.discount || 0) / 100);
            return sum + discounted * (1 + (s.tax || 0) / 100);
        }, 0);
    }

    calculateCOGS(sales) {
        return sales.reduce((sum, s) => {
            const product = (this.state?.allProducts || []).find(p => p.name === s.product);
            const cost = product ? product.cost : (s.cost || 0);
            return sum + ((s.quantity || 0) * cost);
        }, 0);
    }

    getTopProducts(sales, limit) {
        const productStats = {};
        sales.forEach(s => {
            if (!productStats[s.product]) {
                productStats[s.product] = { name: s.product, quantity: 0, revenue: 0 };
            }
            productStats[s.product].quantity += s.quantity || 0;
            productStats[s.product].revenue += (s.quantity || 0) * (s.price || 0);
        });
        return Object.values(productStats)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, limit);
    }

    getTopCustomers(sales, limit) {
        const customerStats = {};
        sales.forEach(s => {
            if (!customerStats[s.customer]) {
                customerStats[s.customer] = { name: s.customer, transactions: 0, total: 0 };
            }
            customerStats[s.customer].transactions++;
            customerStats[s.customer].total += (s.quantity || 0) * (s.price || 0);
        });
        return Object.values(customerStats)
            .sort((a, b) => b.total - a.total)
            .slice(0, limit);
    }

    getSalesByCategory(sales) {
        const categoryStats = {};
        sales.forEach(s => {
            const product = (this.state?.allProducts || []).find(p => p.name === s.product);
            const category = product?.category || 'Other';
            if (!categoryStats[category]) {
                categoryStats[category] = { category, revenue: 0 };
            }
            categoryStats[category].revenue += (s.quantity || 0) * (s.price || 0);
        });
        return Object.values(categoryStats).sort((a, b) => b.revenue - a.revenue);
    }

    getDailySalesTrend(sales, period) {
        const dailyTotals = {};
        sales.forEach(s => {
            const date = (s.date || '').slice(0, 10);
            if (!dailyTotals[date]) {
                dailyTotals[date] = { date, revenue: 0 };
            }
            dailyTotals[date].revenue += (s.quantity || 0) * (s.price || 0);
        });
        return Object.values(dailyTotals).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
    }

    isMainShopSale(sale) {
        const loc = sale.location || sale.outletId || '';
        return !loc || loc === 'main';
    }

    getMainShopRevenue() {
        const mainSales = (this.state?.allSales || []).filter(s => this.isMainShopSale(s));
        return this.calculateRevenue(mainSales);
    }

    getMainShopSalesCount() {
        return (this.state?.allSales || []).filter(s => this.isMainShopSale(s)).length;
    }

    getOutletRevenue(outletId) {
        const outletSales = (this.state?.allSales || []).filter(s =>
            s.location === outletId || s.outletId === outletId
        );
        return this.calculateRevenue(outletSales);
    }

    getOutletSales(outletId) {
        return (this.state?.allSales || []).filter(s =>
            s.location === outletId || s.outletId === outletId
        );
    }

    calculateAverageDailySales() {
        const sales = this.state?.allSales || [];
        if (sales.length === 0) return 0;
        const total = this.calculateRevenue(sales);
        const dates = [...new Set(sales.map(s => (s.date || '').slice(0, 10)))];
        return dates.length > 0 ? total / dates.length : 0;
    }

    getDateRange(period) {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        let start;
        
        switch(period) {
            case 'day': start = today; break;
            case 'week':
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                start = weekAgo.toISOString().slice(0, 10);
                break;
            case 'month':
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                start = monthAgo.toISOString().slice(0, 10);
                break;
            case 'quarter':
                const quarterAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                start = quarterAgo.toISOString().slice(0, 10);
                break;
            case 'year':
                const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                start = yearAgo.toISOString().slice(0, 10);
                break;
            default: start = '2000-01-01';
        }
        
        return { start, end: today };
    }

    getPreviousPeriodRange(period) {
        const { start, end } = this.getDateRange(period);
        const startDate = new Date(start);
        const endDate = new Date(end);
        const duration = endDate.getTime() - startDate.getTime();
        
        const prevEnd = new Date(startDate.getTime() - 1);
        const prevStart = new Date(prevEnd.getTime() - duration);
        
        return {
            start: prevStart.toISOString().slice(0, 10),
            end: prevEnd.toISOString().slice(0, 10)
        };
    }

    formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toFixed(2);
    }

    formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return date.toLocaleDateString();
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create global instance
window.enhancedDashboard = new EnhancedDashboard();
export default window.enhancedDashboard;
