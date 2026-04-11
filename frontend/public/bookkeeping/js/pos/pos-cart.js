// ==================== POS CART (pos11.html style) ====================
import { state } from '../utils/state.js';
import { POSUI } from './pos-ui.js';
import { POSCheckout } from './pos-checkout.js';
import { POSData } from './pos-data.js';
import { metricsService } from '../services/metrics-service.js';

export const POSCart = {
    cart: [],

    init() {
        this.loadCart();
        this.setupEventListeners();
        this.renderCart();
    },

    setupEventListeners() {
        // Clear cart
        document.getElementById('clear-cart')?.addEventListener('click', () => {
            if (confirm('Clear cart?')) {
                this.cart = [];
                this.saveCart();
                this.renderCart();
                POSUI.showNotification('Cart cleared', 'success');
            }
        });

        // Checkout button
        document.getElementById('checkout')?.addEventListener('click', () => {
            if (this.cart.length === 0) {
                POSUI.showNotification('Cart is empty', 'error');
                return;
            }
            this.showCheckoutModal();
        });

        // View inventory
        document.getElementById('view-inventory')?.addEventListener('click', () => {
            this.showInventoryModal();
        });
    },

    addToCart(product, qty, discount = 0) {
        if (qty > product.quantity) {
            POSUI.showNotification('Not enough stock', 'error');
            return;
        }

        // Check if already in cart
        const existing = this.cart.find(item => item.id === product.id);
        if (existing) {
            existing.qty += qty;
            existing.discount += discount;
        } else {
            this.cart.push({
                id: product.id,
                name: product.name,
                price: product.price || 0,
                qty: qty,
                discount: discount
            });
        }

        this.saveCart();
        this.renderCart();
        POSUI.showNotification(`Added ${product.name}`, 'success');
    },

    removeFromCart(index) {
        this.cart.splice(index, 1);
        this.saveCart();
        this.renderCart();
    },

    decreaseQty(index) {
        if (this.cart[index].qty > 1) {
            this.cart[index].qty--;
            this.saveCart();
            this.renderCart();
        } else {
            this.removeFromCart(index);
        }
    },

    renderCart() {
        const container = document.getElementById('cart');
        const totalEl = document.querySelector('.total');
        const checkoutBtn = document.getElementById('checkout');
        
        if (!container) return;

        if (this.cart.length === 0) {
            container.innerHTML = '<p>Your cart is empty.</p>';
            totalEl.textContent = 'Total: ₵0.00';
            if (checkoutBtn) checkoutBtn.disabled = true;
            return;
        }

        if (checkoutBtn) checkoutBtn.disabled = false;

        let total = 0;
        container.innerHTML = this.cart.map((item, index) => {
            const subtotal = item.price * item.qty - item.discount;
            total += subtotal;
            return `
                <div class="cart-item">
                    <div>
                        <strong>${item.name}</strong><br>
                        <small>${POSUI.formatCurrency(item.price)} × ${item.qty} = ${POSUI.formatCurrency(item.price * item.qty)}</small>
                        ${item.discount > 0 ? `<br><small style="color: green;">-${POSUI.formatCurrency(item.discount)} discount</small>` : ''}
                    </div>
                    <div class="cart-controls">
                        <button onclick="POSCart.decreaseQty(${index})" style="background: #e74c3c; color: white;">−</button>
                        <button onclick="POSCart.removeFromCart(${index})" style="background: #95a5a6; color: white;">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');

        totalEl.textContent = `Total: ${POSUI.formatCurrency(total)}`;
    },

    showCheckoutModal() {
        const modal = document.getElementById('checkout-modal');
        if (!modal) return;
        const customerName = modal.querySelector('#customer-name');
        const invoicePreview = modal.querySelector('#invoice-preview');

        // Generate invoice preview (defensive so preview never remains stuck at "Loading...")
        try {
            if (invoicePreview) invoicePreview.textContent = this.generateInvoice();
        } catch (e) {
            console.error('Invoice preview generation failed:', e);
            if (invoicePreview) {
                invoicePreview.textContent = 'Unable to render invoice preview. Please continue checkout.';
            }
        }

        modal.classList.add('active');
        if (customerName) {
            customerName.value = '';
            customerName.focus();
        }

        // Cancel button
        const cancelBtn = modal.querySelector('#cancel-checkout');
        if (cancelBtn) cancelBtn.onclick = () => {
            modal.classList.remove('active');
        };

        // Confirm button
        const confirmBtn = modal.querySelector('#confirm-sale');
        if (confirmBtn) {
            confirmBtn.onclick = async () => {
                await this.confirmSale((customerName?.value || 'Walk-in Customer'));
            };
        }
    },

    generateInvoice() {
        const lines = ['========== INVOICE =========='];
        lines.push(`Date: ${new Date().toLocaleString()}`);
        lines.push('');
        
        let total = 0;
        this.cart.forEach(item => {
            const price = Number(item.price) || 0;
            const qty = Number(item.qty) || 0;
            const discount = Number(item.discount) || 0;
            const subtotal = price * qty - discount;
            total += subtotal;
            lines.push(`${item.name}`);
            lines.push(`  ${qty} × ₵${price.toFixed(2)} = ₵${(price * qty).toFixed(2)}`);
            if (discount > 0) {
                lines.push(`  Discount: -₵${discount.toFixed(2)}`);
            }
            lines.push('');
        });

        lines.push('-----------------------------');
        lines.push(`TOTAL: ₵${total.toFixed(2)}`);
        lines.push('=============================');
        
        return lines.join('\n');
    },

    async confirmSale(customerName) {
        const flowStartedAt = Date.now();
        const correlationId = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `flow_${Date.now()}`;

        metricsService.emit('flow_started', {
            flow_name: 'pos_checkout',
            cart_items: this.cart.length
        }, { correlationId });

        try {
            const modal = document.getElementById('checkout-modal');

            // Prepare cart data
            let subtotal = 0;
            const items = this.cart.map(item => {
                const price = Number(item.price) || 0;
                const qty = Number(item.qty) || 0;
                const discount = Number(item.discount) || 0;
                const itemSubtotal = price * qty - discount;
                subtotal += itemSubtotal;
                return {
                    productId: item.id,
                    name: item.name,
                    quantity: qty,
                    price: price,
                    discount: discount,
                    subtotal: itemSubtotal
                };
            });

            const cartData = {
                items: items,
                subtotal: subtotal,
                discount: 0,
                tax: 0,
                total: subtotal
            };

            // Process sale
            await POSCheckout.processSale(cartData, customerName);

            // Clear cart
            this.cart = [];
            this.saveCart();
            this.renderCart();

            // Close modal
            modal.classList.remove('active');

            POSUI.showNotification('Sale completed!', 'success');

            metricsService.emit('flow_completed', {
                flow_name: 'pos_checkout',
                duration_ms: Date.now() - flowStartedAt,
                result: 'success',
                items_sold: this.cart.length
            }, { correlationId });

            if (window.POSMain) {
                await window.POSMain.loadData();
            }

        } catch (error) {
            console.error('[POSCart] confirmSale error:', error);
            metricsService.emit('flow_completed', {
                flow_name: 'pos_checkout',
                duration_ms: Date.now() - flowStartedAt,
                result: 'blocked',
                error_message: error?.message || String(error)
            }, { correlationId });
            POSUI.showNotification('Sale failed: ' + error.message, 'error');
        }
    },

    showInventoryModal() {
        const modal = document.getElementById('inventory-modal');
        const tbody = document.getElementById('inventory-list');

        if (!tbody) return;

        const products = state.products || [];
        tbody.innerHTML = products.map(p => `
            <tr>
                <td>${p.name}</td>
                <td>${POSUI.formatCurrency(p.price || 0)}</td>
                <td>${p.quantity || 0}</td>
            </tr>
        `).join('');

        modal.classList.add('active');

        document.getElementById('close-inventory').onclick = () => {
            modal.classList.remove('active');
        };
    },

    saveCart() {
        localStorage.setItem('pos-cart', JSON.stringify(this.cart));
    },

    loadCart() {
        const saved = localStorage.getItem('pos-cart');
        if (saved) {
            try {
                this.cart = JSON.parse(saved);
            } catch (e) {
                this.cart = [];
            }
        }
    }
};
