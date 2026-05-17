/**
 * Stock Alerts Service
 * Handles low stock notifications and alerts
 */

import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';

class StockAlertsService {
    constructor() {
        this.alertsShown = new Set();
        this.notificationPermission = ('Notification' in window) ? Notification.permission : 'denied';
    }

    async requestNotificationPermission() {
        if ('Notification' in window && this.notificationPermission === 'default') {
            this.notificationPermission = await Notification.requestPermission();
        }
        return this.notificationPermission;
    }

    /**
     * Check all products for low stock
     * @returns {Array} Products below minimum stock level
     */
    getLowStockProducts() {
        return state.allProducts.filter(product => {
            const quantity = parseFloat(product.quantity) || 0;
            const minStock = parseFloat(product.minStock) || 10;
            return quantity <= minStock && quantity > 0;
        });
    }

    /**
     * Get products that are completely out of stock
     * @returns {Array} Products with zero quantity
     */
    getOutOfStockProducts() {
        return state.allProducts.filter(product => {
            const quantity = parseFloat(product.quantity) || 0;
            return quantity <= 0;
        });
    }

    /**
     * Build a map of productId → pending PO info for products already on order.
     * Derived from state.allPurchaseOrders — no extra Firestore reads needed.
     * Status automatically reverts when a PO is deleted or cancelled from state.
     * @returns {Map<string, {poNumber: string, poId: string, pendingQty: number}>}
     */
    getProductsOnOrder() {
        const map = new Map();
        const pendingPOs = (state.allPurchaseOrders || []).filter(po => po.status === 'pending');
        pendingPOs.forEach(po => {
            (po.items || []).forEach(item => {
                if (!item.productId) return;
                const existing = map.get(item.productId);
                if (existing) {
                    existing.pendingQty += (parseFloat(item.quantity) || 0);
                } else {
                    map.set(item.productId, {
                        poNumber: po.poNumber,
                        poId: po.id,
                        pendingQty: parseFloat(item.quantity) || 0
                    });
                }
            });
        });
        return map;
    }

    /**
     * Rule-based order quantity prediction.
     * Uses last 90 days of sales to compute average daily velocity,
     * then targets 45 days of forward stock minus what's already on hand.
     * Falls back to minStock when there is no sales history.
     * @param {Object} product
     * @returns {{ qty: number, avgDailySales: number, basedOnDays: number }}
     */
    suggestOrderQuantity(product) {
        const sales = state.allSales || [];
        const lookbackDays = 90;
        const targetDays = 45;

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - lookbackDays);
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        const productSales = sales.filter(s =>
            (s.product === product.name || s.productId === product.id) &&
            s.date >= cutoffStr
        );

        const totalQtySold = productSales.reduce((sum, s) => sum + (parseFloat(s.quantity) || 0), 0);
        const avgDailySales = totalQtySold / lookbackDays;
        const currentStock = parseFloat(product.quantity) || 0;
        const minStock = parseFloat(product.minStock) || 10;

        const targetStock = Math.ceil(avgDailySales * targetDays);
        const suggested = Math.max(minStock, targetStock - currentStock);

        return {
            qty: Math.ceil(suggested),
            avgDailySales: Math.round(avgDailySales * 10) / 10,
            basedOnDays: lookbackDays
        };
    }

    /**
     * Re-render the dashboard stock alerts widget so "On Order" status
     * reflects the current state.allPurchaseOrders immediately after any PO change.
     */
    refreshAlertWidget() {
        const widget = document.getElementById('stock-alerts-widget');
        if (!widget) return;
        widget.innerHTML = this.generateAlertsWidget();
    }

    /**
     * Get products expiring soon (if expiry date is tracked)
     * @param {number} daysThreshold - Days until expiry
     * @returns {Array} Products expiring within threshold
     */
    getExpiringProducts(daysThreshold = 30) {
        const today = new Date();
        const thresholdDate = new Date(today.getTime() + (daysThreshold * 24 * 60 * 60 * 1000));
        
        return state.allProducts.filter(product => {
            if (!product.expiryDate) return false;
            const expiryDate = new Date(product.expiryDate);
            return expiryDate <= thresholdDate && expiryDate >= today;
        });
    }

    /**
     * Show browser notification for low stock
     * @param {Object} product - Product object
     */
    async showBrowserNotification(product) {
        if (!('Notification' in window) || this.alertsShown.has(product.id)) return;

        if (this.notificationPermission === 'default') {
            await this.requestNotificationPermission();
        }

        if (this.notificationPermission === 'granted') {
            new Notification('Low Stock Alert', {
                body: `${product.name} is running low (${product.quantity} remaining)`,
                icon: '/bookkeeping/assets/icons/icon-192x192.png',
                tag: `stock-alert-${product.id}`
            });
            this.alertsShown.add(product.id);
        }
    }

    /**
     * Generate stock alerts summary
     * @returns {Object} Summary of all stock alerts
     */
    getAlertsSummary() {
        const lowStock = this.getLowStockProducts();
        const outOfStock = this.getOutOfStockProducts();
        const expiring = this.getExpiringProducts();

        return {
            lowStock: {
                count: lowStock.length,
                products: lowStock,
                severity: lowStock.length > 5 ? 'critical' : lowStock.length > 2 ? 'warning' : 'info'
            },
            outOfStock: {
                count: outOfStock.length,
                products: outOfStock,
                severity: outOfStock.length > 0 ? 'critical' : 'info'
            },
            expiring: {
                count: expiring.length,
                products: expiring,
                severity: expiring.length > 3 ? 'warning' : 'info'
            },
            totalAlerts: lowStock.length + outOfStock.length + expiring.length
        };
    }

    /**
     * Render stock alerts widget HTML
     * @returns {string} HTML for alerts widget
     */
    renderAlertsWidget() {
        const summary = this.getAlertsSummary();
        
        if (summary.totalAlerts === 0) {
            return `
                <div class="stock-alerts-widget">
                    <div class="alert-item success">
                        <i class="fas fa-check-circle"></i>
                        <span>All stock levels are healthy</span>
                    </div>
                </div>
            `;
        }

        let html = '<div class="stock-alerts-widget">';
        
        // Out of stock alerts (critical)
        if (summary.outOfStock.count > 0) {
            html += `
                <div class="alert-item critical" onclick="stockAlerts.showOutOfStockModal()">
                    <i class="fas fa-exclamation-circle"></i>
                    <span><strong>${summary.outOfStock.count}</strong> products out of stock</span>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `;
        }

        // Low stock alerts
        if (summary.lowStock.count > 0) {
            html += `
                <div class="alert-item warning" onclick="stockAlerts.showLowStockModal()">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span><strong>${summary.lowStock.count}</strong> products running low</span>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `;
        }

        // Expiring products alerts
        if (summary.expiring.count > 0) {
            html += `
                <div class="alert-item info" onclick="stockAlerts.showExpiringModal()">
                    <i class="fas fa-clock"></i>
                    <span><strong>${summary.expiring.count}</strong> products expiring soon</span>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `;
        }

        html += '</div>';
        return html;
    }

    /**
     * Show modal with out of stock products
     */
    showOutOfStockModal() {
        const products = this.getOutOfStockProducts();
        this.showProductListModal('Out of Stock Products', products, 'danger');
    }

    /**
     * Show modal with low stock products
     */
    showLowStockModal() {
        const products = this.getLowStockProducts();
        this.showProductListModal('Low Stock Products', products, 'warning');
    }

    /**
     * Show modal with expiring products
     */
    showExpiringModal() {
        const products = this.getExpiringProducts();
        this.showProductListModal('Expiring Products', products, 'info');
    }

    /**
     * Generic modal for showing product lists
     */
    showProductListModal(title, products, type) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('stock-alerts-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'stock-alerts-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 700px;">
                    <span class="close" onclick="document.getElementById('stock-alerts-modal').style.display='none'">&times;</span>
                    <h3 id="stock-alerts-modal-title"></h3>
                    <div id="stock-alerts-modal-content"></div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const iconMap = {
            danger: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        document.getElementById('stock-alerts-modal-title').innerHTML = 
            `<i class="fas ${iconMap[type]}" style="color: var(--${type === 'danger' ? 'danger' : type})"></i> ${title}`;

        const onOrderMap = this.getProductsOnOrder();
        const productIds = products.map(p => p.id).filter(Boolean);

        // Only include products NOT already on order in the bulk PO suggestion
        const notOnOrder = products.filter(p => !onOrderMap.has(p.id));
        const totalSuggested = notOnOrder.reduce((sum, p) => sum + this.suggestOrderQuantity(p).qty, 0);

        let content = '';

        if (notOnOrder.length > 0 && (type === 'danger' || type === 'warning')) {
            const idsToOrder = notOnOrder.map(p => p.id);
            content += `
                <div style="background: linear-gradient(135deg, #e8f5e9, #c8e6c9); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
                    <div>
                        <strong style="color: #2e7d32;"><i class="fas fa-lightbulb"></i> Suggested Action</strong>
                        <p style="margin: 0.25rem 0 0; color: #1b5e20; font-size: 0.9rem;">
                            Create a purchase order for ${notOnOrder.length} item${notOnOrder.length > 1 ? 's' : ''} (~${Math.ceil(totalSuggested)} units suggested)
                        </p>
                    </div>
                    <button onclick="window.appController.openCreatePOForProducts([${idsToOrder.map(id => "'" + id + "'").join(',')}]); document.getElementById('stock-alerts-modal').style.display='none';"
                            style="background: #2e7d32; color: white; border: none; padding: 0.625rem 1.25rem; border-radius: 8px; cursor: pointer; font-weight: 600; white-space: nowrap;">
                        <i class="fas fa-file-invoice"></i> Create Purchase Order
                    </button>
                </div>
            `;
        } else if (products.length > 0 && notOnOrder.length === 0 && (type === 'danger' || type === 'warning')) {
            content += `
                <div style="background: linear-gradient(135deg, #e3f2fd, #bbdefb); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 1rem;">
                    <strong style="color: #1565c0;"><i class="fas fa-truck"></i> All items are on order</strong>
                    <p style="margin: 0.25rem 0 0; color: #0d47a1; font-size: 0.9rem;">Purchase orders are pending for all flagged products.</p>
                </div>
            `;
        }

        content += '<div class="table-responsive"><table class="stock-alerts-table">';
        content += '<thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Min.</th><th>Suggested Qty</th><th>Status / Action</th></tr></thead>';
        content += '<tbody>';

        products.forEach(product => {
            const qty = parseFloat(product.quantity) || 0;
            const min = parseFloat(product.minStock) || 10;
            const stockClass = qty <= 0 ? 'stock-critical' : 'stock-warning';
            const suggestion = this.suggestOrderQuantity(product);
            const onOrder = onOrderMap.get(product.id);

            const suggestedCell = `<strong>${suggestion.qty}</strong><br><small style="color:#888;">${suggestion.avgDailySales}/day avg</small>`;

            let actionCell;
            if (onOrder) {
                actionCell = `
                    <span style="background:#1565c0;color:#fff;padding:3px 8px;border-radius:10px;font-size:0.75rem;white-space:nowrap;">
                        <i class="fas fa-truck"></i> On Order (${onOrder.pendingQty} units)
                    </span>
                    <br><small style="color:#555;margin-top:2px;display:inline-block;">PO: ${(onOrder.poNumber || '').replace(/</g,'&lt;')}</small>`;
            } else {
                actionCell = `
                    <button onclick="window.appController.openCreatePOForProduct('${product.id}')"
                            class="btn-sm btn-primary" style="white-space: nowrap;">
                        <i class="fas fa-shopping-cart"></i> Order
                    </button>`;
            }

            content += `
                <tr>
                    <td><strong>${(product.name || '').replace(/</g,'&lt;')}</strong></td>
                    <td>${(product.category || 'N/A').replace(/</g,'&lt;')}</td>
                    <td class="${stockClass}">${qty}</td>
                    <td>${min}</td>
                    <td>${suggestedCell}</td>
                    <td>${actionCell}</td>
                </tr>
            `;
        });

        content += '</tbody></table></div>';
        document.getElementById('stock-alerts-modal-content').innerHTML = content;
        modal.style.display = 'block';
    }

    /**
     * Check alerts, show browser notifications, and notify backend for email.
     */
    async checkAndNotify() {
        const lowStock = this.getLowStockProducts();
        lowStock.forEach(product => {
            this.showBrowserNotification(product);
        });

        const outOfStock = this.getOutOfStockProducts();
        if (outOfStock.length > 0) {
            Utils.showToast(`${outOfStock.length} products are out of stock!`, 'warning');
        }

        const allProblemProducts = [...outOfStock, ...lowStock];
        if (allProblemProducts.length > 0) {
            this._sendStockAlertToBackend(allProblemProducts);
        }
    }

    /**
     * POST low/out-of-stock products to backend so it can email the admin.
     */
    async _sendStockAlertToBackend(products) {
        try {
            const BACKEND_URL = window.BACKEND_URL || '';
            const payload = {
                products: products.map(p => ({
                    id: p.id,
                    name: p.name,
                    category: p.category || '',
                    quantity: parseFloat(p.quantity) || 0,
                    minStock: parseFloat(p.minStock) || 10,
                    price: parseFloat(p.price) || 0
                })),
                recipient: '',  // backend reads from settings if empty
                business_name: document.getElementById('business-name')?.value || 'Ultimate Bookkeeping'
            };

            const settingsDoc = window.firebaseService
                ? await import('../config/firebase.js').then(m => {
                    const { getDoc } = window.firebaseImports || {};
                    if (getDoc && m.firebaseService?.settingsRef) {
                        return getDoc(m.firebaseService.settingsRef());
                    }
                    return null;
                }).catch(() => null)
                : null;

            if (settingsDoc && settingsDoc.exists?.()) {
                const s = settingsDoc.data();
                if (s.notificationEmail) payload.recipient = s.notificationEmail;
                if (s.name) payload.business_name = s.name;
            }

            if (!payload.recipient) return;

            await fetch(`${BACKEND_URL}/api/email/stock-alert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            console.warn('Backend stock alert email failed (non-critical):', err.message);
        }
    }

    /**
     * Show a comprehensive stock alert modal once on app startup.
     * Only fires once per session; skips if there are no alerts.
     */
    showStartupAlerts() {
        if (this._startupShown) return;
        this._startupShown = true;

        const summary = this.getAlertsSummary();
        if (summary.totalAlerts === 0) return;

        const allProblems = [
            ...summary.outOfStock.products.map(p => ({ ...p, _alertType: 'out' })),
            ...summary.lowStock.products.map(p => ({ ...p, _alertType: 'low' })),
            ...summary.expiring.products.map(p => ({ ...p, _alertType: 'exp' }))
        ];

        const restockItems = allProblems.filter(p => p._alertType !== 'exp');
        const totalNeeded = restockItems.reduce((sum, p) => {
            const min = parseFloat(p.minStock) || 10;
            const qty = parseFloat(p.quantity) || 0;
            return sum + Math.max(0, min - qty);
        }, 0);
        const restockIds = restockItems.map(p => p.id).filter(Boolean);

        let modal = document.getElementById('startup-stock-alert');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'startup-stock-alert';
        modal.className = 'modal';
        modal.style.display = 'block';

        const onOrderMap = this.getProductsOnOrder();
        const notOnOrderItems = restockItems.filter(p => !onOrderMap.has(p.id));

        let rows = '';
        allProblems.forEach(p => {
            const qty = parseFloat(p.quantity) || 0;
            const min = parseFloat(p.minStock) || 10;
            const needed = Math.max(0, min - qty);
            const onOrder = onOrderMap.get(p.id);

            let badge = '';
            if (onOrder) {
                badge = `<span style="background:#1565c0;color:#fff;padding:2px 8px;border-radius:10px;font-size:0.75rem;" title="PO: ${(onOrder.poNumber || '').replace(/"/g, '&quot;')}"><i class="fas fa-truck"></i> On Order</span>`;
            } else if (p._alertType === 'out') {
                badge = '<span style="background:#dc3545;color:#fff;padding:2px 8px;border-radius:10px;font-size:0.75rem;">Out of Stock</span>';
            } else if (p._alertType === 'low') {
                badge = '<span style="background:#ffc107;color:#333;padding:2px 8px;border-radius:10px;font-size:0.75rem;">Low Stock</span>';
            } else {
                badge = '<span style="background:#17a2b8;color:#fff;padding:2px 8px;border-radius:10px;font-size:0.75rem;">Expiring</span>';
            }

            const suggestedQty = (p._alertType !== 'exp' && !onOrder)
                ? this.suggestOrderQuantity(p).qty
                : (onOrder ? onOrder.pendingQty : '-');

            rows += `<tr>
                <td><strong>${(p.name || '').replace(/</g, '&lt;')}</strong></td>
                <td>${badge}</td>
                <td style="text-align:center;">${qty}</td>
                <td style="text-align:center;">${min}</td>
                <td style="text-align:center;font-weight:600;">${p._alertType === 'exp' ? '-' : needed}</td>
                <td style="text-align:center;color:#1565c0;font-weight:600;">${suggestedQty}</td>
            </tr>`;
        });

        let poButton = '';
        if (notOnOrderItems.length > 0) {
            const notOnOrderIds = notOnOrderItems.map(p => p.id).filter(Boolean);
            const totalSuggested = notOnOrderItems.reduce((sum, p) => sum + this.suggestOrderQuantity(p).qty, 0);
            const isReady = state.dataReady;
            const label = `<i class="fas fa-file-invoice"></i> Create Purchase Order (${notOnOrderItems.length} items, ~${Math.ceil(totalSuggested)} units)`;
            poButton = `
                <button id="startup-po-btn"
                        data-product-ids='${JSON.stringify(notOnOrderIds)}'
                        data-label="${label.replace(/"/g, '&quot;')}"
                        ${isReady ? `onclick="(function(b){window.appController?.openCreatePOForProducts(JSON.parse(b.dataset.productIds));document.getElementById('startup-stock-alert')?.remove();})(this)"` : ''}
                        ${isReady ? '' : 'disabled'}
                        style="background:${isReady ? '#2e7d32' : '#94a3b8'};color:#fff;border:none;padding:0.6rem 1.25rem;border-radius:8px;cursor:${isReady ? 'pointer' : 'not-allowed'};font-weight:600;display:flex;align-items:center;gap:0.5rem;opacity:${isReady ? '1' : '0.7'};">
                    ${isReady ? '' : '<i class="fas fa-spinner fa-spin"></i>'}
                    ${isReady ? label : 'Loading data...'}
                </button>`;
        }

        modal.innerHTML = `
            <div class="modal-content" style="max-width:700px;">
                <span class="close" onclick="document.getElementById('startup-stock-alert').remove()">&times;</span>
                <h3 style="margin-bottom:0.25rem;"><i class="fas fa-exclamation-triangle" style="color:#ffc107;"></i> Stock Alerts</h3>
                <p style="color:#666;font-size:0.9rem;margin-bottom:1rem;">
                    ${summary.outOfStock.count > 0 ? `<strong style="color:#dc3545;">${summary.outOfStock.count}</strong> out of stock ` : ''}
                    ${summary.lowStock.count > 0 ? `<strong style="color:#e67e00;">${summary.lowStock.count}</strong> low stock ` : ''}
                    ${summary.expiring.count > 0 ? `<strong style="color:#17a2b8;">${summary.expiring.count}</strong> expiring soon` : ''}
                </p>
                <div style="max-height:45vh;overflow-y:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                        <thead>
                            <tr style="background:#f8f9fa;text-align:left;">
                                <th style="padding:0.5rem;">Product</th>
                                <th style="padding:0.5rem;">Status</th>
                                <th style="padding:0.5rem;text-align:center;">Stock</th>
                                <th style="padding:0.5rem;text-align:center;">Min.</th>
                                <th style="padding:0.5rem;text-align:center;">Needed</th>
                                <th style="padding:0.5rem;text-align:center;">Suggest&nbsp;Qty</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div style="margin-top:1rem;display:flex;gap:0.75rem;flex-wrap:wrap;justify-content:flex-end;">
                    ${poButton}
                    <button onclick="document.getElementById('startup-stock-alert').remove()"
                            style="background:#6c757d;color:#fff;border:none;padding:0.6rem 1.25rem;border-radius:8px;cursor:pointer;font-weight:600;">
                        Dismiss
                    </button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);
    }

    enableStartupPOButton() {
        const btn = document.getElementById('startup-po-btn');
        if (!btn) return;
        btn.disabled = false;
        btn.style.background = '#2e7d32';
        btn.style.cursor = 'pointer';
        btn.style.opacity = '1';
        const idsRaw = btn.dataset.productIds;
        if (idsRaw) {
            try {
                const ids = JSON.parse(idsRaw);
                btn.onclick = () => {
                    window.appController?.openCreatePOForProducts(ids);
                    document.getElementById('startup-stock-alert')?.remove();
                };
            } catch (_) {}
        }
        btn.innerHTML = btn.dataset.label || '<i class="fas fa-file-invoice"></i> Create Purchase Order';
    }
}

export const stockAlerts = new StockAlertsService();
window.stockAlerts = stockAlerts;
