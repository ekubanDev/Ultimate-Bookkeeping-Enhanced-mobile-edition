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

        const productIds = products.map(p => p.id).filter(Boolean);
        const totalNeeded = products.reduce((sum, p) => {
            const min = parseFloat(p.minStock) || 10;
            const qty = parseFloat(p.quantity) || 0;
            return sum + Math.max(0, min - qty);
        }, 0);

        let content = '';

        if (products.length > 1 && (type === 'danger' || type === 'warning')) {
            content += `
                <div style="background: linear-gradient(135deg, #e8f5e9, #c8e6c9); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
                    <div>
                        <strong style="color: #2e7d32;"><i class="fas fa-lightbulb"></i> Suggested Action</strong>
                        <p style="margin: 0.25rem 0 0; color: #1b5e20; font-size: 0.9rem;">
                            Create a purchase order for all ${products.length} items (${Math.ceil(totalNeeded)} units needed)
                        </p>
                    </div>
                    <button onclick="window.appController.openCreatePOForProducts([${productIds.map(id => "'" + id + "'").join(',')}]); document.getElementById('stock-alerts-modal').style.display='none';"
                            style="background: #2e7d32; color: white; border: none; padding: 0.625rem 1.25rem; border-radius: 8px; cursor: pointer; font-weight: 600; white-space: nowrap;">
                        <i class="fas fa-file-invoice"></i> Create Purchase Order
                    </button>
                </div>
            `;
        }

        content += '<div class="table-responsive"><table class="stock-alerts-table">';
        content += '<thead><tr><th>Product</th><th>Category</th><th>Current</th><th>Min.</th><th>Needed</th><th>Action</th></tr></thead>';
        content += '<tbody>';

        products.forEach(product => {
            const qty = parseFloat(product.quantity) || 0;
            const min = parseFloat(product.minStock) || 10;
            const needed = Math.max(0, min - qty);
            const stockClass = qty <= 0 ? 'stock-critical' : 'stock-warning';
            content += `
                <tr>
                    <td><strong>${product.name}</strong></td>
                    <td>${product.category || 'N/A'}</td>
                    <td class="${stockClass}">${qty}</td>
                    <td>${min}</td>
                    <td><strong>${needed}</strong></td>
                    <td>
                        <button onclick="window.appController.openCreatePOForProduct('${product.id}')" 
                                class="btn-sm btn-primary" style="white-space: nowrap;">
                            <i class="fas fa-shopping-cart"></i> Order
                        </button>
                    </td>
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

        let rows = '';
        allProblems.forEach(p => {
            const qty = parseFloat(p.quantity) || 0;
            const min = parseFloat(p.minStock) || 10;
            const needed = Math.max(0, min - qty);
            let badge = '';
            if (p._alertType === 'out') {
                badge = '<span style="background:#dc3545;color:#fff;padding:2px 8px;border-radius:10px;font-size:0.75rem;">Out of Stock</span>';
            } else if (p._alertType === 'low') {
                badge = '<span style="background:#ffc107;color:#333;padding:2px 8px;border-radius:10px;font-size:0.75rem;">Low Stock</span>';
            } else {
                badge = '<span style="background:#17a2b8;color:#fff;padding:2px 8px;border-radius:10px;font-size:0.75rem;">Expiring</span>';
            }
            rows += `<tr>
                <td><strong>${(p.name || '').replace(/</g, '&lt;')}</strong></td>
                <td>${badge}</td>
                <td style="text-align:center;">${qty}</td>
                <td style="text-align:center;">${min}</td>
                <td style="text-align:center;font-weight:600;">${p._alertType === 'exp' ? '-' : needed}</td>
            </tr>`;
        });

        let poButton = '';
        if (restockItems.length > 0) {
            poButton = `
                <button onclick="window.appController?.openCreatePOForProducts([${restockIds.map(id => "'" + id + "'").join(',')}]); document.getElementById('startup-stock-alert').remove();"
                        style="background:#2e7d32;color:#fff;border:none;padding:0.6rem 1.25rem;border-radius:8px;cursor:pointer;font-weight:600;">
                    <i class="fas fa-file-invoice"></i> Create Purchase Order (${restockItems.length} items, ${Math.ceil(totalNeeded)} units)
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
}

export const stockAlerts = new StockAlertsService();
window.stockAlerts = stockAlerts;
