/**
 * Profit Analysis Service
 * Calculates and displays product profitability metrics
 */

import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';

class ProfitAnalysisService {
    /** Normalize date to YYYY-MM-DD for filtering */
    _getDateStr(obj, key = 'date') {
        const d = obj && obj[key];
        if (!d) return '';
        if (typeof d === 'string') return d.indexOf('T') !== -1 ? d.split('T')[0] : d;
        if (d && typeof d.toDate === 'function') return d.toDate().toISOString().split('T')[0];
        if (d && (d.seconds != null || d._seconds != null)) {
            const sec = d.seconds ?? d._seconds;
            return new Date(sec * 1000).toISOString().split('T')[0];
        }
        return '';
    }

    /**
     * Calculate profit metrics for a single product
     * @param {Object} product - Product object
     * @param {{start:string,end:string}} dateRange - Optional {start,end} as YYYY-MM-DD to filter sales
     */
    getProductProfitMetrics(product, dateRange = null) {
        const cost = parseFloat(product.cost) || 0;
        const price = parseFloat(product.price) || 0;
        const quantity = parseFloat(product.quantity) || 0;

        // Calculate margins
        const grossProfit = price - cost;
        const profitMargin = price > 0 ? ((grossProfit / price) * 100) : 0;
        const markup = cost > 0 ? ((grossProfit / cost) * 100) : 0;

        // Get sales data for this product
        let productSales = state.allSales.filter(s => 
            s.productId === product.id || s.product === product.name
        );
        if (dateRange && dateRange.start && dateRange.end) {
            productSales = productSales.filter(s => {
                const d = this._getDateStr(s);
                return d && d >= dateRange.start && d <= dateRange.end;
            });
        }

        const totalQuantitySold = productSales.reduce((sum, s) => 
            sum + (parseFloat(s.quantity) || 0), 0
        );

        const totalRevenue = productSales.reduce((sum, s) => {
            const rev = parseFloat(s.total);
            if (!isNaN(rev) && rev !== 0) return sum + rev;
            const qty = parseFloat(s.quantity) || 0;
            const price = parseFloat(s.price) || 0;
            const discount = parseFloat(s.discount) || 0;
            const tax = parseFloat(s.tax) || 0;
            const subtotal = qty * price;
            const discounted = subtotal * (1 - discount / 100);
            return sum + discounted * (1 + tax / 100);
        }, 0);

        const totalCostOfGoodsSold = totalQuantitySold * cost;
        const realizedProfit = totalRevenue - totalCostOfGoodsSold;

        // Inventory value
        const inventoryValue = quantity * cost;
        const potentialProfit = quantity * grossProfit;

        return {
            productId: product.id,
            productName: product.name,
            category: product.category,
            cost,
            price,
            grossProfit,
            profitMargin: profitMargin.toFixed(2),
            markup: markup.toFixed(2),
            currentStock: quantity,
            totalQuantitySold,
            totalRevenue,
            totalCostOfGoodsSold,
            realizedProfit,
            inventoryValue,
            potentialProfit,
            profitability: profitMargin >= 30 ? 'excellent' : 
                          profitMargin >= 20 ? 'good' : 
                          profitMargin >= 10 ? 'fair' : 'poor'
        };
    }

    /**
     * Get profit analysis for all products
     * @param {{start:string,end:string}} dateRange - Optional {start,end} as YYYY-MM-DD to filter
     */
    getAllProductsAnalysis(dateRange = null) {
        return state.allProducts.map(product => this.getProductProfitMetrics(product, dateRange));
    }

    /**
     * Get top profitable products
     */
    getTopProfitableProducts(limit = 10, dateRange = null) {
        return this.getAllProductsAnalysis(dateRange)
            .sort((a, b) => parseFloat(b.realizedProfit) - parseFloat(a.realizedProfit))
            .slice(0, limit);
    }

    /**
     * Get products by profitability category
     */
    getProductsByProfitability(dateRange = null) {
        const analysis = this.getAllProductsAnalysis(dateRange);
        return {
            excellent: analysis.filter(p => p.profitability === 'excellent'),
            good: analysis.filter(p => p.profitability === 'good'),
            fair: analysis.filter(p => p.profitability === 'fair'),
            poor: analysis.filter(p => p.profitability === 'poor')
        };
    }

    /**
     * Get category-wise profitability
     */
    getCategoryAnalysis(dateRange = null) {
        const analysis = this.getAllProductsAnalysis(dateRange);
        const categories = {};

        analysis.forEach(product => {
            const cat = product.category || 'Uncategorized';
            if (!categories[cat]) {
                categories[cat] = {
                    category: cat,
                    productCount: 0,
                    totalRevenue: 0,
                    totalCost: 0,
                    totalProfit: 0,
                    avgMargin: 0,
                    inventoryValue: 0
                };
            }
            categories[cat].productCount++;
            categories[cat].totalRevenue += product.totalRevenue;
            categories[cat].totalCost += product.totalCostOfGoodsSold;
            categories[cat].totalProfit += product.realizedProfit;
            categories[cat].inventoryValue += product.inventoryValue;
        });

        // Calculate average margin for each category
        Object.values(categories).forEach(cat => {
            cat.avgMargin = cat.totalRevenue > 0 
                ? ((cat.totalProfit / cat.totalRevenue) * 100).toFixed(2)
                : 0;
        });

        return Object.values(categories).sort((a, b) => b.totalProfit - a.totalProfit);
    }

    /**
     * Get overall business profitability summary
     * @param {{start:string,end:string}} dateRange - Optional {start,end} as YYYY-MM-DD. When provided, filters sales and expenses to match dashboard.
     */
    getOverallSummary(dateRange = null) {
        const analysis = this.getAllProductsAnalysis(dateRange);
        
        const totalRevenue = analysis.reduce((sum, p) => sum + p.totalRevenue, 0);
        const totalCOGS = analysis.reduce((sum, p) => sum + p.totalCostOfGoodsSold, 0);
        const totalProfit = totalRevenue - totalCOGS;
        const totalInventoryValue = analysis.reduce((sum, p) => sum + p.inventoryValue, 0);
        const totalPotentialProfit = analysis.reduce((sum, p) => sum + p.potentialProfit, 0);

        // Get operating expenses only (debt payments are balance sheet, not P&L)
        const isOperating = (e) => {
            const type = (e.expenseType || '').toLowerCase();
            const cat = (e.category || '').toLowerCase();
            return type !== 'liability_payment'
                && cat !== 'debt payment'
                && cat !== 'loan repayment';
        };

        let totalExpenses;
        if (dateRange && dateRange.start && dateRange.end) {
            totalExpenses = state.allExpenses.filter(isOperating).reduce((sum, e) => {
                const d = this._getDateStr(e);
                if (!d || d < dateRange.start || d > dateRange.end) return sum;
                const amount = parseFloat(e.amount);
                return sum + (isNaN(amount) ? 0 : amount);
            }, 0);
        } else {
            totalExpenses = state.allExpenses.filter(isOperating).reduce((sum, e) => {
                const amount = parseFloat(e.amount);
                return sum + (isNaN(amount) ? 0 : amount);
            }, 0);
        }

        const netProfit = totalProfit - totalExpenses;
        const grossMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100) : 0;
        const netMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100) : 0;

        return {
            totalRevenue,
            totalCOGS,
            grossProfit: totalProfit,
            totalExpenses,
            netProfit,
            grossMargin: grossMargin.toFixed(2),
            netMargin: netMargin.toFixed(2),
            totalInventoryValue,
            totalPotentialProfit,
            productsAnalyzed: analysis.length,
            profitableProducts: analysis.filter(p => parseFloat(p.profitMargin) > 0).length,
            unprofitableProducts: analysis.filter(p => parseFloat(p.profitMargin) <= 0).length
        };
    }

    /**
     * Render profit analysis dashboard section
     * @param {{start:string,end:string}} dateRange - Optional {start,end} to match dashboard period
     */
    renderProfitDashboard(dateRange = null) {
        const summary = this.getOverallSummary(dateRange);
        const topProducts = this.getTopProfitableProducts(5, dateRange);
        const categoryAnalysis = this.getCategoryAnalysis(dateRange);
        const profitability = this.getProductsByProfitability(dateRange);

        return `
            <div class="profit-analysis-dashboard">
                <!-- Summary Cards -->
                <div class="profit-summary-grid">
                    <div class="profit-card revenue">
                        <i class="fas fa-chart-line"></i>
                        <h4>Total Revenue</h4>
                        <p class="amount">${Utils.formatCurrency(summary.totalRevenue)}</p>
                    </div>
                    <div class="profit-card gross">
                        <i class="fas fa-coins"></i>
                        <h4>Gross Profit</h4>
                        <p class="amount">${Utils.formatCurrency(summary.grossProfit)}</p>
                        <span class="margin">${summary.grossMargin}% margin</span>
                    </div>
                    <div class="profit-card expenses">
                        <i class="fas fa-receipt"></i>
                        <h4>Total Expenses</h4>
                        <p class="amount">${Utils.formatCurrency(summary.totalExpenses)}</p>
                    </div>
                    <div class="profit-card net ${summary.netProfit >= 0 ? 'positive' : 'negative'}">
                        <i class="fas fa-balance-scale"></i>
                        <h4>Net Profit</h4>
                        <p class="amount">${Utils.formatCurrency(summary.netProfit)}</p>
                        <span class="margin">${summary.netMargin}% margin</span>
                    </div>
                </div>

                <!-- Profitability Distribution -->
                <div class="profit-distribution card">
                    <h3><i class="fas fa-chart-pie"></i> Product Profitability Distribution</h3>
                    <div class="distribution-bars">
                        <div class="dist-item excellent">
                            <span class="label">Excellent (>30%)</span>
                            <div class="bar-container">
                                <div class="bar" style="width: ${(profitability.excellent.length / summary.productsAnalyzed * 100) || 0}%"></div>
                            </div>
                            <span class="count">${profitability.excellent.length}</span>
                        </div>
                        <div class="dist-item good">
                            <span class="label">Good (20-30%)</span>
                            <div class="bar-container">
                                <div class="bar" style="width: ${(profitability.good.length / summary.productsAnalyzed * 100) || 0}%"></div>
                            </div>
                            <span class="count">${profitability.good.length}</span>
                        </div>
                        <div class="dist-item fair">
                            <span class="label">Fair (10-20%)</span>
                            <div class="bar-container">
                                <div class="bar" style="width: ${(profitability.fair.length / summary.productsAnalyzed * 100) || 0}%"></div>
                            </div>
                            <span class="count">${profitability.fair.length}</span>
                        </div>
                        <div class="dist-item poor">
                            <span class="label">Poor (<10%)</span>
                            <div class="bar-container">
                                <div class="bar" style="width: ${(profitability.poor.length / summary.productsAnalyzed * 100) || 0}%"></div>
                            </div>
                            <span class="count">${profitability.poor.length}</span>
                        </div>
                    </div>
                </div>

                <!-- Top Profitable Products -->
                <div class="top-products card">
                    <h3><i class="fas fa-trophy"></i> Top 5 Profitable Products</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Category</th>
                                <th>Margin</th>
                                <th>Units Sold</th>
                                <th>Profit</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${topProducts.map((p, index) => `
                                <tr>
                                    <td>
                                        <span class="rank">#${index + 1}</span>
                                        ${p.productName}
                                    </td>
                                    <td>${p.category || 'N/A'}</td>
                                    <td class="margin-cell ${p.profitability}">${p.profitMargin}%</td>
                                    <td>${p.totalQuantitySold}</td>
                                    <td class="${p.realizedProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
                                        ${Utils.formatCurrency(p.realizedProfit)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <!-- Category Analysis -->
                <div class="category-analysis card">
                    <h3><i class="fas fa-layer-group"></i> Category Performance</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Category</th>
                                <th>Products</th>
                                <th>Revenue</th>
                                <th>Profit</th>
                                <th>Avg Margin</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${categoryAnalysis.map(cat => `
                                <tr>
                                    <td><strong>${cat.category}</strong></td>
                                    <td>${cat.productCount}</td>
                                    <td>${Utils.formatCurrency(cat.totalRevenue)}</td>
                                    <td class="${cat.totalProfit >= 0 ? 'profit-positive' : 'profit-negative'}">
                                        ${Utils.formatCurrency(cat.totalProfit)}
                                    </td>
                                    <td>${cat.avgMargin}%</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <!-- Inventory Value -->
                <div class="inventory-value card">
                    <h3><i class="fas fa-warehouse"></i> Inventory Analysis</h3>
                    <div class="inventory-metrics">
                        <div class="inv-metric">
                            <span class="label">Total Inventory Value</span>
                            <span class="value">${Utils.formatCurrency(summary.totalInventoryValue)}</span>
                        </div>
                        <div class="inv-metric">
                            <span class="label">Potential Profit in Stock</span>
                            <span class="value">${Utils.formatCurrency(summary.totalPotentialProfit)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Export profit analysis to CSV
     */
    async exportToCSV() {
        const analysis = this.getAllProductsAnalysis();
        const headers = [
            'Product Name', 'Category', 'Cost', 'Price', 'Gross Profit', 
            'Margin %', 'Markup %', 'Current Stock', 'Qty Sold', 
            'Revenue', 'COGS', 'Realized Profit', 'Profitability'
        ];

        const rows = analysis.map(p => [
            p.productName,
            p.category || 'N/A',
            p.cost.toFixed(2),
            p.price.toFixed(2),
            p.grossProfit.toFixed(2),
            p.profitMargin,
            p.markup,
            p.currentStock,
            p.totalQuantitySold,
            p.totalRevenue.toFixed(2),
            p.totalCostOfGoodsSold.toFixed(2),
            p.realizedProfit.toFixed(2),
            p.profitability
        ]);

        await Utils.exportToCSV([headers, ...rows], 'profit-analysis.csv');
    }
}

export const profitAnalysis = new ProfitAnalysisService();
window.profitAnalysis = profitAnalysis;
