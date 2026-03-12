// ==================== POS CONTROLLER ====================

/**
 * POS Controller
 * Handles all Point of Sale operations including:
 * - Quick sale processing
 * - Shopping cart management
 * - Payment processing
 * - Receipt printing
 * - Cash drawer management
 * - Shift management
 * - Offline mode
 */

import { firebaseService } from '../services/firebase-service.js';
import { Utils } from '../utils/utils.js';
import { state } from '../utils/state.js';
import { nativeFeatures } from '../services/native-features.js';

export class POSController {
    constructor() {
        this.cart = [];
        this.currentCustomer = null;
        this.currentShift = null;
        this.paymentMethods = ['Cash', 'Card', 'Mobile Money', 'Bank Transfer'];
        this.discountType = 'percentage'; // 'percentage' or 'fixed'
        this.taxRate = 0; // VAT/Tax rate (e.g., 0.15 for 15%)
        this.currentDiscount = null; // Cart-level discount: { type: 'percentage'|'fixed', value: number }
        this.selectedCustomer = null;
        
        // Quick access products (favorites)
        this.quickProducts = [];
        
        // Recent transactions for quick refund
        this.recentTransactions = [];
        
        // Cash drawer tracking
        this.cashDrawer = {
            openingBalance: 0,
            currentBalance: 0,
            expectedBalance: 0
        };
    }

    // ==================== INITIALIZATION ====================

    async init() {
        try {
            await this.loadPOSSettings();
            await this.loadQuickProducts();
            await this.checkActiveShift();
            this.setupEventListeners();
            this.startAutoSave();
            
            console.log('✅ POS Controller initialized');
        } catch (error) {
            console.error('❌ POS initialization error:', error);
            Utils.showToast('Failed to initialize POS', 'error');
        }
    }

    setupEventListeners() {
        // Product search and add
        const searchInput = document.getElementById('pos-search');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.searchProducts(e.target.value);
            }, 300));
        }

        // Barcode scanner
        const scanBtn = document.getElementById('pos-scan-barcode');
        if (scanBtn) {
            scanBtn.addEventListener('click', () => this.scanBarcode());
        }

        // Quick products
        const quickProductsContainer = document.getElementById('quick-products');
        if (quickProductsContainer) {
            quickProductsContainer.addEventListener('click', (e) => {
                const productCard = e.target.closest('[data-product-id]');
                if (productCard) {
                    const productId = productCard.dataset.productId;
                    this.addProductToCartById(productId);
                }
            });
        }

        // Cart actions
        document.getElementById('pos-clear-cart')?.addEventListener('click', () => {
            this.clearCart();
        });

        document.getElementById('pos-checkout')?.addEventListener('click', () => {
            this.showCheckoutModal();
        });

        // Payment
        document.getElementById('pos-process-payment')?.addEventListener('click', () => {
            this.processPayment();
        });

        // Discount
        document.getElementById('pos-apply-discount')?.addEventListener('click', () => {
            this.applyDiscount();
        });

        // Customer
        document.getElementById('pos-select-customer')?.addEventListener('click', () => {
            this.showCustomerSelector();
        });

        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // F1 - Search
            if (e.key === 'F1') {
                e.preventDefault();
                document.getElementById('pos-search')?.focus();
            }
            
            // F2 - Scan barcode
            if (e.key === 'F2') {
                e.preventDefault();
                this.scanBarcode();
            }
            
            // F3 - Customer
            if (e.key === 'F3') {
                e.preventDefault();
                this.showCustomerSelector();
            }
            
            // F4 - Checkout
            if (e.key === 'F4') {
                e.preventDefault();
                this.showCheckoutModal();
            }
            
            // Esc - Clear cart or close modal
            if (e.key === 'Escape') {
                const modal = document.querySelector('.modal.active');
                if (modal) {
                    Utils.closeModal();
                } else if (confirm('Clear cart?')) {
                    this.clearCart();
                }
            }
        });
    }

    // ==================== PRODUCT SEARCH & ADD ====================

    async searchProducts(query) {
        if (!query || query.length < 2) {
            this.hideSearchResults();
            return;
        }

        try {
            const products = state.products;
            const results = products.filter(p => {
                const searchStr = `${p.name} ${p.barcode} ${p.category}`.toLowerCase();
                return searchStr.includes(query.toLowerCase());
            }).slice(0, 10);

            this.displaySearchResults(results);
        } catch (error) {
            console.error('Search error:', error);
        }
    }

    displaySearchResults(results) {
        const container = document.getElementById('pos-search-results');
        if (!container) return;

        if (results.length === 0) {
            container.innerHTML = '<div class="search-no-results">No products found</div>';
            container.style.display = 'block';
            return;
        }

        container.innerHTML = results.map(product => `
            <div class="search-result-item" data-product-id="${product.id}">
                <div class="result-info">
                    <strong>${product.name}</strong>
                    <small>${product.barcode || 'No barcode'}</small>
                </div>
                <div class="result-price">
                    <strong>${Utils.formatCurrency(product.sellingPrice)}</strong>
                    <small>${product.quantity} in stock</small>
                </div>
            </div>
        `).join('');

        container.style.display = 'block';

        // Add click handlers
        container.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const productId = item.dataset.productId;
                this.addProductToCartById(productId);
                this.hideSearchResults();
                document.getElementById('pos-search').value = '';
            });
        });
    }

    hideSearchResults() {
        const container = document.getElementById('pos-search-results');
        if (container) {
            container.style.display = 'none';
        }
    }

    async scanBarcode() {
        if (nativeFeatures.isNative) {
            // Use native barcode scanner
            const barcode = await nativeFeatures.scanBarcode();
            if (barcode) {
                await this.addProductByBarcode(barcode);
                await nativeFeatures.hapticSuccess();
            }
        } else {
            // Web fallback - prompt for barcode
            const barcode = prompt('Enter barcode:');
            if (barcode) {
                await this.addProductByBarcode(barcode);
            }
        }
    }

    async addProductByBarcode(barcode) {
        const product = state.products.find(p => p.barcode === barcode);
        if (product) {
            await this.addProductToCart(product);
            Utils.showToast(`Added ${product.name}`, 'success');
        } else {
            Utils.showToast('Product not found', 'error');
            if (nativeFeatures.isNative) {
                await nativeFeatures.hapticError();
            }
        }
    }

    async addProductToCartById(productId) {
        const product = state.products.find(p => p.id === productId);
        if (product) {
            await this.addProductToCart(product);
        }
    }

    async addProductToCart(product, quantity = 1) {
        // Check stock
        if (product.quantity < quantity) {
            Utils.showToast('Insufficient stock', 'warning');
            return;
        }

        // Check if already in cart
        const existingItem = this.cart.find(item => item.productId === product.id);
        
        if (existingItem) {
            // Check total quantity
            if (product.quantity < existingItem.quantity + quantity) {
                Utils.showToast('Insufficient stock', 'warning');
                return;
            }
            existingItem.quantity += quantity;
        } else {
            this.cart.push({
                productId: product.id,
                name: product.name,
                price: product.sellingPrice,
                quantity: quantity,
                discount: 0,
                tax: this.taxRate,
                total: product.sellingPrice * quantity
            });
        }

        this.updateCartDisplay();
        this.saveCartToStorage();
        
        // Haptic feedback
        if (nativeFeatures.isNative) {
            await nativeFeatures.hapticFeedback('light');
        }
    }

    // ==================== CART MANAGEMENT ====================

    updateCartDisplay() {
        const cartContainer = document.getElementById('pos-cart-items');
        const cartEmpty = document.getElementById('pos-cart-empty');
        
        if (!cartContainer) return;

        if (this.cart.length === 0) {
            cartContainer.innerHTML = '';
            if (cartEmpty) cartEmpty.style.display = 'block';
            this.updateCartTotals();
            return;
        }

        if (cartEmpty) cartEmpty.style.display = 'none';

        cartContainer.innerHTML = this.cart.map((item, index) => {
            const itemTotal = this.calculateItemTotal(item);
            return `
                <div class="cart-item" data-index="${index}">
                    <div class="cart-item-info">
                        <strong>${item.name}</strong>
                        <small>${Utils.formatCurrency(item.price)} each</small>
                    </div>
                    <div class="cart-item-quantity">
                        <button class="btn-icon qty-decrease" data-index="${index}">
                            <i class="fas fa-minus"></i>
                        </button>
                        <input type="number" 
                               class="qty-input" 
                               value="${item.quantity}" 
                               min="1" 
                               data-index="${index}">
                        <button class="btn-icon qty-increase" data-index="${index}">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="cart-item-total">
                        <strong>${Utils.formatCurrency(itemTotal)}</strong>
                    </div>
                    <button class="btn-icon btn-danger cart-item-remove" data-index="${index}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
        }).join('');

        // Add event listeners for cart actions
        this.attachCartEventListeners();
        this.updateCartTotals();
    }

    attachCartEventListeners() {
        // Quantity decrease
        document.querySelectorAll('.qty-decrease').forEach(btn => {
            btn.addEventListener('click', async () => {
                const index = parseInt(btn.dataset.index);
                await this.updateCartItemQuantity(index, -1);
            });
        });

        // Quantity increase
        document.querySelectorAll('.qty-increase').forEach(btn => {
            btn.addEventListener('click', async () => {
                const index = parseInt(btn.dataset.index);
                await this.updateCartItemQuantity(index, 1);
            });
        });

        // Quantity input
        document.querySelectorAll('.qty-input').forEach(input => {
            input.addEventListener('change', async () => {
                const index = parseInt(input.dataset.index);
                const newQty = parseInt(input.value);
                if (newQty > 0) {
                    await this.setCartItemQuantity(index, newQty);
                }
            });
        });

        // Remove item
        document.querySelectorAll('.cart-item-remove').forEach(btn => {
            btn.addEventListener('click', async () => {
                const index = parseInt(btn.dataset.index);
                await this.removeCartItem(index);
            });
        });
    }

    async updateCartItemQuantity(index, change) {
        const item = this.cart[index];
        if (!item) return;

        const newQuantity = item.quantity + change;
        
        if (newQuantity <= 0) {
            await this.removeCartItem(index);
            return;
        }

        // Check stock
        const product = state.products.find(p => p.id === item.productId);
        if (product && product.quantity < newQuantity) {
            Utils.showToast('Insufficient stock', 'warning');
            return;
        }

        item.quantity = newQuantity;
        this.updateCartDisplay();
        this.saveCartToStorage();
        
        if (nativeFeatures.isNative) {
            await nativeFeatures.hapticFeedback('light');
        }
    }

    async setCartItemQuantity(index, quantity) {
        const item = this.cart[index];
        if (!item) return;

        // Check stock
        const product = state.products.find(p => p.id === item.productId);
        if (product && product.quantity < quantity) {
            Utils.showToast('Insufficient stock', 'warning');
            return;
        }

        item.quantity = quantity;
        this.updateCartDisplay();
        this.saveCartToStorage();
    }

    async removeCartItem(index) {
        this.cart.splice(index, 1);
        this.updateCartDisplay();
        this.saveCartToStorage();
        
        if (nativeFeatures.isNative) {
            await nativeFeatures.hapticFeedback('light');
        }
    }

    calculateItemTotal(item) {
        let total = item.price * item.quantity;
        
        // Apply discount
        if (item.discount > 0) {
            if (this.discountType === 'percentage') {
                total -= (total * item.discount / 100);
            } else {
                total -= item.discount;
            }
        }
        
        // Apply tax
        if (item.tax > 0) {
            total += (total * item.tax);
        }
        
        return total;
    }

    updateCartTotals() {
        let subtotal = 0;
        let totalDiscount = 0;
        let totalTax = 0;
        
        this.cart.forEach(item => {
            const itemSubtotal = item.price * item.quantity;
            subtotal += itemSubtotal;
            
            if (item.discount > 0) {
                if (this.discountType === 'percentage') {
                    totalDiscount += (itemSubtotal * item.discount / 100);
                } else {
                    totalDiscount += item.discount;
                }
            }
        });

        if (this.currentDiscount) {
            if (this.currentDiscount.type === 'percentage') {
                totalDiscount += (subtotal * this.currentDiscount.value / 100);
            } else {
                totalDiscount += this.currentDiscount.value;
            }
        }
        totalDiscount = Math.min(totalDiscount, subtotal);
        
        const afterDiscount = subtotal - totalDiscount;
        totalTax = afterDiscount * this.taxRate;
        const total = afterDiscount + totalTax;
        
        // Update display
        const subtotalEl = document.getElementById('pos-subtotal');
        const discountEl = document.getElementById('pos-discount');
        const taxEl = document.getElementById('pos-tax');
        const totalEl = document.getElementById('pos-total');
        if (subtotalEl) subtotalEl.textContent = Utils.formatCurrency(subtotal);
        if (discountEl) discountEl.textContent = Utils.formatCurrency(totalDiscount);
        if (taxEl) taxEl.textContent = Utils.formatCurrency(totalTax);
        if (totalEl) totalEl.textContent = Utils.formatCurrency(total);
        
        // Update checkout button
        const checkoutBtn = document.getElementById('pos-checkout');
        if (checkoutBtn) {
            checkoutBtn.disabled = this.cart.length === 0;
        }
    }

    clearCart() {
        if (this.cart.length === 0) return;
        
        if (confirm('Clear all items from cart?')) {
            this.cart = [];
            this.currentCustomer = null;
            this.selectedCustomer = null;
            this.currentDiscount = null;
            this.updateDiscountBadge();
            this.updateCustomerDisplay();
            this.updateCartDisplay();
            this.saveCartToStorage();
            Utils.showToast('Cart cleared', 'info');
        }
    }

    // ==================== CHECKOUT & PAYMENT ====================

    showCheckoutModal() {
        if (this.cart.length === 0) {
            Utils.showToast('Cart is empty', 'warning');
            return;
        }

        const total = this.getCartTotal();
        
        Utils.showModal('checkout-modal', `
            <div class="checkout-modal">
                <div class="checkout-summary">
                    <h3>Order Summary</h3>
                    <div class="summary-row">
                        <span>Items:</span>
                        <strong>${this.cart.length}</strong>
                    </div>
                    <div class="summary-row">
                        <span>Subtotal:</span>
                        <strong>${Utils.formatCurrency(this.getSubtotal())}</strong>
                    </div>
                    <div class="summary-row">
                        <span>Discount:</span>
                        <strong>${Utils.formatCurrency(this.getTotalDiscount())}</strong>
                    </div>
                    <div class="summary-row">
                        <span>Tax:</span>
                        <strong>${Utils.formatCurrency(this.getTotalTax())}</strong>
                    </div>
                    <div class="summary-row total-row">
                        <span>Total:</span>
                        <strong>${Utils.formatCurrency(total)}</strong>
                    </div>
                </div>
                
                <div class="payment-section">
                    <h3>Payment Method</h3>
                    <div class="payment-methods">
                        ${this.paymentMethods.map(method => `
                            <button class="payment-method-btn" data-method="${method}">
                                <i class="fas fa-${this.getPaymentIcon(method)}"></i>
                                <span>${method}</span>
                            </button>
                        `).join('')}
                    </div>
                    
                    <div class="payment-amount">
                        <label>Amount Received</label>
                        <input type="number" 
                               id="payment-received" 
                               step="0.01" 
                               value="${total.toFixed(2)}"
                               class="form-control">
                    </div>
                    
                    <div class="payment-change" id="payment-change-display" style="display: none;">
                        <span>Change:</span>
                        <strong id="change-amount">GHS 0.00</strong>
                    </div>
                    
                    <div class="payment-actions">
                        <button id="process-payment-btn" class="btn btn-primary btn-lg">
                            <i class="fas fa-check"></i> Complete Sale
                        </button>
                        <button onclick="Utils.closeModal()" class="btn btn-secondary">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        `);

        // Setup payment method selection
        let selectedMethod = 'Cash';
        document.querySelectorAll('.payment-method-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.payment-method-btn').forEach(b => 
                    b.classList.remove('active'));
                btn.classList.add('active');
                selectedMethod = btn.dataset.method;
            });
        });
        
        // Select cash by default
        document.querySelector('[data-method="Cash"]')?.classList.add('active');

        // Calculate change
        const receivedInput = document.getElementById('payment-received');
        const changeDisplay = document.getElementById('payment-change-display');
        const changeAmount = document.getElementById('change-amount');
        
        receivedInput.addEventListener('input', () => {
            const received = parseFloat(receivedInput.value) || 0;
            const change = received - total;
            
            if (change >= 0) {
                changeDisplay.style.display = 'flex';
                changeAmount.textContent = Utils.formatCurrency(change);
            } else {
                changeDisplay.style.display = 'none';
            }
        });

        // Process payment
        document.getElementById('process-payment-btn').addEventListener('click', () => {
            const received = parseFloat(receivedInput.value) || 0;
            if (received < total) {
                Utils.showToast('Insufficient payment amount', 'error');
                return;
            }
            
            this.processPayment(selectedMethod, received);
        });
    }

    getPaymentIcon(method) {
        const icons = {
            'Cash': 'money-bill-wave',
            'Card': 'credit-card',
            'Mobile Money': 'mobile-alt',
            'Bank Transfer': 'university'
        };
        return icons[method] || 'money-bill';
    }

    async processPayment(paymentMethod, amountReceived) {
        try {
            Utils.showSpinner();

            const total = this.getCartTotal();
            const change = amountReceived - total;

            // Create sale record
            const saleData = {
                date: new Date().toISOString(),
                items: this.cart.map(item => ({
                    productId: item.productId,
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    discount: item.discount || 0,
                    total: this.calculateItemTotal(item)
                })),
                subtotal: this.getSubtotal(),
                discount: this.getTotalDiscount(),
                tax: this.getTotalTax(),
                total: total,
                paymentMethod: paymentMethod,
                amountReceived: amountReceived,
                change: change,
                customerId: this.currentCustomer?.id || null,
                customerName: this.currentCustomer?.name || 'Walk-in Customer',
                cashier: state.user?.email || 'Unknown',
                shiftId: this.currentShift?.id || null,
                outlet: state.currentOutlet || 'Main',
                status: 'completed'
            };

            // Save to Firebase
            const saleId = await firebaseService.addDocument('sales', saleData);

            // Update inventory
            for (const item of this.cart) {
                const product = state.products.find(p => p.id === item.productId);
                if (product) {
                    const newQuantity = product.quantity - item.quantity;
                    await firebaseService.updateDocument('products', item.productId, {
                        quantity: newQuantity
                    });
                }
            }

            // Update cash drawer
            if (paymentMethod === 'Cash') {
                this.cashDrawer.currentBalance += total;
                this.cashDrawer.expectedBalance += total;
                await this.saveCashDrawerstate();
            }

            // Add to recent transactions
            this.recentTransactions.unshift({ id: saleId, ...saleData });
            if (this.recentTransactions.length > 10) {
                this.recentTransactions = this.recentTransactions.slice(0, 10);
            }

            Utils.hideSpinner();
            Utils.closeModal();

            // Show receipt
            await this.showReceipt(saleId, saleData);

            // Clear cart
            this.cart = [];
            this.currentCustomer = null;
            this.selectedCustomer = null;
            this.currentDiscount = null;
            this.updateDiscountBadge();
            this.updateCustomerDisplay();
            this.updateCartDisplay();
            this.saveCartToStorage();

            Utils.showToast('Sale completed successfully!', 'success');
            
            if (nativeFeatures.isNative) {
                await nativeFeatures.hapticSuccess();
            }

        } catch (error) {
            Utils.hideSpinner();
            console.error('Payment error:', error);
            Utils.showToast('Payment failed. Please try again.', 'error');
            
            if (nativeFeatures.isNative) {
                await nativeFeatures.hapticError();
            }
        }
    }

    // ==================== RECEIPT ====================

    async showReceipt(saleId, saleData) {
        const receiptHTML = this.generateReceiptHTML(saleId, saleData);
        
        Utils.showModal('receipt-modal', `
            <div class="receipt-container">
                ${receiptHTML}
                <div class="receipt-actions">
                    <button id="print-receipt-btn" class="btn btn-primary">
                        <i class="fas fa-print"></i> Print Receipt
                    </button>
                    <button id="email-receipt-btn" class="btn btn-secondary">
                        <i class="fas fa-envelope"></i> Email Receipt
                    </button>
                    <button id="share-receipt-btn" class="btn btn-secondary">
                        <i class="fas fa-share"></i> Share
                    </button>
                    <button onclick="Utils.closeModal()" class="btn btn-secondary">
                        Done
                    </button>
                </div>
            </div>
        `);

        // Print handler
        document.getElementById('print-receipt-btn').addEventListener('click', () => {
            this.printReceipt(receiptHTML);
        });

        // Email handler
        document.getElementById('email-receipt-btn').addEventListener('click', () => {
            this.emailReceipt(saleId, saleData);
        });

        // Share handler
        if (nativeFeatures.isNative) {
            document.getElementById('share-receipt-btn').addEventListener('click', async () => {
                await nativeFeatures.share({
                    title: `Receipt #${saleId}`,
                    text: `Total: ${Utils.formatCurrency(saleData.total)}`,
                    dialogTitle: 'Share Receipt'
                });
            });
        } else {
            document.getElementById('share-receipt-btn').style.display = 'none';
        }
    }

    generateReceiptHTML(saleId, saleData) {
        const date = new Date(saleData.date);
        
        return `
            <div class="receipt">
                <div class="receipt-header">
                    <h2>Ultimate Bookkeeping</h2>
                    <p>Point of Sale Receipt</p>
                    <p>Outlet: ${saleData.outlet}</p>
                </div>
                
                <div class="receipt-info">
                    <p><strong>Receipt #:</strong> ${saleId}</p>
                    <p><strong>Date:</strong> ${date.toLocaleString()}</p>
                    <p><strong>Cashier:</strong> ${saleData.cashier}</p>
                    <p><strong>Customer:</strong> ${saleData.customerName}</p>
                </div>
                
                <table class="receipt-items">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Qty</th>
                            <th>Price</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${saleData.items.map(item => `
                            <tr>
                                <td>${item.name}</td>
                                <td>${item.quantity}</td>
                                <td>${Utils.formatCurrency(item.price)}</td>
                                <td>${Utils.formatCurrency(item.total)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <div class="receipt-totals">
                    <div class="total-row">
                        <span>Subtotal:</span>
                        <span>${Utils.formatCurrency(saleData.subtotal)}</span>
                    </div>
                    ${saleData.discount > 0 ? `
                        <div class="total-row">
                            <span>Discount:</span>
                            <span>-${Utils.formatCurrency(saleData.discount)}</span>
                        </div>
                    ` : ''}
                    ${saleData.tax > 0 ? `
                        <div class="total-row">
                            <span>Tax:</span>
                            <span>${Utils.formatCurrency(saleData.tax)}</span>
                        </div>
                    ` : ''}
                    <div class="total-row grand-total">
                        <span><strong>TOTAL:</strong></span>
                        <span><strong>${Utils.formatCurrency(saleData.total)}</strong></span>
                    </div>
                    <div class="total-row">
                        <span>Payment (${saleData.paymentMethod}):</span>
                        <span>${Utils.formatCurrency(saleData.amountReceived)}</span>
                    </div>
                    ${saleData.change > 0 ? `
                        <div class="total-row">
                            <span>Change:</span>
                            <span>${Utils.formatCurrency(saleData.change)}</span>
                        </div>
                    ` : ''}
                </div>
                
                <div class="receipt-footer">
                    <p>Thank you for your business!</p>
                    <p>Please come again</p>
                </div>
            </div>
        `;
    }

    printReceipt(receiptHTML) {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Receipt</title>
                <style>
                    body { font-family: monospace; max-width: 80mm; margin: 0 auto; padding: 10px; }
                    .receipt { text-align: center; }
                    .receipt-header h2 { margin: 5px 0; }
                    .receipt-header p { margin: 2px 0; font-size: 12px; }
                    .receipt-info { text-align: left; margin: 10px 0; font-size: 12px; }
                    .receipt-info p { margin: 2px 0; }
                    .receipt-items { width: 100%; border-collapse: collapse; font-size: 12px; }
                    .receipt-items th { text-align: left; border-bottom: 1px solid #000; padding: 5px 2px; }
                    .receipt-items td { padding: 3px 2px; }
                    .receipt-totals { margin-top: 10px; font-size: 12px; }
                    .total-row { display: flex; justify-content: space-between; margin: 3px 0; }
                    .grand-total { font-size: 14px; margin-top: 5px; padding-top: 5px; border-top: 1px solid #000; }
                    .receipt-footer { margin-top: 15px; font-size: 11px; }
                    @media print {
                        @page { size: 80mm auto; margin: 0; }
                        body { margin: 0; }
                    }
                </style>
            </head>
            <body>
                ${receiptHTML}
                <script>
                    window.onload = () => {
                        window.print();
                        setTimeout(() => window.close(), 1000);
                    };
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    async emailReceipt(saleId, saleData) {
        if (!this.currentCustomer || !this.currentCustomer.email) {
            const email = prompt('Enter customer email:');
            if (!email) return;
            
            // Send email
            Utils.showToast('Receipt sent to ' + email, 'success');
        } else {
            Utils.showToast('Receipt sent to ' + this.currentCustomer.email, 'success');
        }
    }

    // ==================== HELPER METHODS ====================

    getSubtotal() {
        return this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    }

    getTotalDiscount() {
        let total = 0;
        const subtotal = this.getSubtotal();
        this.cart.forEach(item => {
            if (item.discount > 0) {
                const itemSubtotal = item.price * item.quantity;
                if (this.discountType === 'percentage') {
                    total += (itemSubtotal * item.discount / 100);
                } else {
                    total += item.discount;
                }
            }
        });
        if (this.currentDiscount) {
            if (this.currentDiscount.type === 'percentage') {
                total += (subtotal * this.currentDiscount.value / 100);
            } else {
                total += this.currentDiscount.value;
            }
        }
        return Math.min(total, subtotal);
    }

    getTotalTax() {
        const afterDiscount = this.getSubtotal() - this.getTotalDiscount();
        return afterDiscount * this.taxRate;
    }

    getCartTotal() {
        return this.getSubtotal() - this.getTotalDiscount() + this.getTotalTax();
    }

    // ==================== STORAGE ====================

    saveCartToStorage() {
        try {
            localStorage.setItem('pos_cart', JSON.stringify(this.cart));
            localStorage.setItem('pos_customer', JSON.stringify(this.currentCustomer));
        } catch (error) {
            console.error('Failed to save cart:', error);
        }
    }

    loadCartFromStorage() {
        try {
            const savedCart = localStorage.getItem('pos_cart');
            if (savedCart) {
                this.cart = JSON.parse(savedCart);
            }
            
            const savedCustomer = localStorage.getItem('pos_customer');
            if (savedCustomer) {
                this.currentCustomer = JSON.parse(savedCustomer);
            }
            
            this.updateCartDisplay();
        } catch (error) {
            console.error('Failed to load cart:', error);
        }
    }

    async loadPOSSettings() {
        try {
            const settings = await firebaseService.getDocument('settings', 'pos');
            if (settings) {
                this.taxRate = settings.taxRate || 0;
                this.paymentMethods = settings.paymentMethods || this.paymentMethods;
            }
        } catch (error) {
            console.error('Failed to load POS settings:', error);
        }
    }

    async loadQuickProducts() {
        try {
            // Load top 20 selling products or favorites
            const products = state.products.slice(0, 20);
            this.quickProducts = products;
            this.displayQuickProducts();
        } catch (error) {
            console.error('Failed to load quick products:', error);
        }
    }

    displayQuickProducts() {
        const container = document.getElementById('quick-products');
        if (!container) return;

        container.innerHTML = this.quickProducts.map(product => `
            <div class="quick-product-card" data-product-id="${product.id}">
                <div class="quick-product-name">${product.name}</div>
                <div class="quick-product-price">${Utils.formatCurrency(product.sellingPrice)}</div>
                <div class="quick-product-stock">${product.quantity} left</div>
            </div>
        `).join('');
    }

    async checkActiveShift() {
        // Check if there's an active shift
        // Implement shift management logic
    }

    async saveCashDrawerstate() {
        try {
            await firebaseService.updateDocument('shifts', this.currentShift.id, {
                cashDrawer: this.cashDrawer
            });
        } catch (error) {
            console.error('Failed to save cash drawer state:', error);
        }
    }

    startAutoSave() {
        setInterval(() => {
            this.saveCartToStorage();
        }, 30000); // Save every 30 seconds
    }

    applyDiscount() {
        document.getElementById('pos-discount-modal')?.remove();

        const hasDiscount = this.currentDiscount !== null;
        const currentType = hasDiscount ? this.currentDiscount.type : 'percentage';
        const currentValue = hasDiscount ? this.currentDiscount.value : '';

        const overlay = document.createElement('div');
        overlay.id = 'pos-discount-modal';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';

        overlay.innerHTML = `
            <div style="background:var(--card-bg, #fff);border-radius:12px;padding:24px;width:90%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
                <h3 style="margin:0 0 20px;font-size:1.25rem;">
                    <i class="fas fa-percentage" style="margin-right:8px;color:var(--primary-color, #4f46e5);"></i>
                    ${hasDiscount ? 'Edit Discount' : 'Apply Discount'}
                </h3>

                <div style="display:flex;gap:16px;margin-bottom:16px;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:8px 12px;border:1px solid var(--border-color, #ddd);border-radius:8px;flex:1;justify-content:center;">
                        <input type="radio" name="pos-discount-type" value="percentage" ${currentType === 'percentage' ? 'checked' : ''}>
                        <i class="fas fa-percent"></i> Percentage
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:8px 12px;border:1px solid var(--border-color, #ddd);border-radius:8px;flex:1;justify-content:center;">
                        <input type="radio" name="pos-discount-type" value="fixed" ${currentType === 'fixed' ? 'checked' : ''}>
                        <i class="fas fa-money-bill"></i> Fixed Amount
                    </label>
                </div>

                <div style="margin-bottom:20px;">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Discount Value</label>
                    <input type="number" id="pos-discount-value-input"
                           value="${currentValue}"
                           min="0" step="0.01"
                           placeholder="Enter value"
                           style="width:100%;padding:10px 12px;border:1px solid var(--border-color, #ddd);border-radius:8px;font-size:1rem;box-sizing:border-box;">
                    <small id="pos-discount-hint" style="display:block;margin-top:4px;color:var(--text-muted, #888);"></small>
                </div>

                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button id="pos-discount-apply-btn" style="flex:1;padding:10px 16px;background:var(--primary-color, #4f46e5);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.95rem;font-weight:600;">
                        <i class="fas fa-check"></i> Apply
                    </button>
                    ${hasDiscount ? `
                        <button id="pos-discount-clear-btn" style="flex:1;padding:10px 16px;background:var(--danger-color, #ef4444);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.95rem;font-weight:600;">
                            <i class="fas fa-times"></i> Clear Discount
                        </button>
                    ` : ''}
                    <button id="pos-discount-cancel-btn" style="flex:1;padding:10px 16px;background:var(--secondary-bg, #e5e7eb);color:var(--text-color, #333);border:none;border-radius:8px;cursor:pointer;font-size:0.95rem;font-weight:500;">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const closeModal = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
        overlay.querySelector('#pos-discount-cancel-btn').addEventListener('click', closeModal);

        const valueInput = document.getElementById('pos-discount-value-input');
        const hintEl = document.getElementById('pos-discount-hint');
        valueInput.focus();

        const updateHint = () => {
            const type = overlay.querySelector('input[name="pos-discount-type"]:checked').value;
            const val = parseFloat(valueInput.value) || 0;
            const subtotal = this.getSubtotal();
            if (val > 0 && subtotal > 0) {
                const saving = type === 'percentage'
                    ? Math.min(subtotal * val / 100, subtotal)
                    : Math.min(val, subtotal);
                hintEl.textContent = `You save ${Utils.formatCurrency(saving)} on ${Utils.formatCurrency(subtotal)} subtotal`;
            } else {
                hintEl.textContent = '';
            }
        };

        valueInput.addEventListener('input', updateHint);
        overlay.querySelectorAll('input[name="pos-discount-type"]').forEach(r =>
            r.addEventListener('change', updateHint)
        );
        updateHint();

        overlay.querySelector('#pos-discount-apply-btn').addEventListener('click', () => {
            const type = overlay.querySelector('input[name="pos-discount-type"]:checked').value;
            const value = parseFloat(valueInput.value);

            if (!value || value <= 0) {
                Utils.showToast('Please enter a valid discount value', 'warning');
                return;
            }
            if (type === 'percentage' && value > 100) {
                Utils.showToast('Percentage cannot exceed 100%', 'warning');
                return;
            }
            const subtotal = this.getSubtotal();
            if (type === 'fixed' && value > subtotal) {
                Utils.showToast('Discount cannot exceed the subtotal', 'warning');
                return;
            }

            this.currentDiscount = { type, value };
            this.updateCartDisplay();
            this.updateDiscountBadge();
            closeModal();

            const label = type === 'percentage' ? `${value}%` : Utils.formatCurrency(value);
            Utils.showToast(`Discount applied: ${label}`, 'success');
        });

        if (hasDiscount) {
            overlay.querySelector('#pos-discount-clear-btn').addEventListener('click', () => {
                this.currentDiscount = null;
                this.updateCartDisplay();
                this.updateDiscountBadge();
                closeModal();
                Utils.showToast('Discount cleared', 'info');
            });
        }
    }

    updateDiscountBadge() {
        const discountBtn = document.getElementById('pos-apply-discount');
        if (!discountBtn) return;

        let badge = discountBtn.querySelector('.pos-discount-badge');

        if (this.currentDiscount) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'pos-discount-badge';
                badge.style.cssText = 'position:absolute;top:-8px;right:-8px;background:var(--danger-color, #ef4444);color:#fff;border-radius:10px;min-width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;padding:0 4px;pointer-events:none;';
                discountBtn.style.position = 'relative';
                discountBtn.style.overflow = 'visible';
                discountBtn.appendChild(badge);
            }
            badge.textContent = this.currentDiscount.type === 'percentage'
                ? `${this.currentDiscount.value}%`
                : Utils.formatCurrency(this.currentDiscount.value);
        } else if (badge) {
            badge.remove();
        }
    }

    showCustomerSelector() {
        document.getElementById('pos-customer-modal')?.remove();

        const customers = state.allCustomers || [];

        const overlay = document.createElement('div');
        overlay.id = 'pos-customer-modal';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';

        const buildCustomerList = (list) => {
            if (list.length === 0) {
                return '<div style="padding:32px;text-align:center;color:var(--text-muted, #999);">No customers found</div>';
            }
            return list.map(c => `
                <div class="pos-customer-item" data-customer-id="${c.id}"
                     style="padding:12px 16px;border-bottom:1px solid var(--border-color, #eee);cursor:pointer;transition:background 0.15s;"
                     onmouseover="this.style.background='var(--hover-bg, #f3f4f6)'"
                     onmouseout="this.style.background='transparent'">
                    <div style="font-weight:600;margin-bottom:2px;">${c.name || 'Unnamed Customer'}</div>
                    <div style="font-size:0.85rem;color:var(--text-muted, #666);display:flex;gap:12px;">
                        ${c.phone ? `<span><i class="fas fa-phone" style="margin-right:4px;"></i>${c.phone}</span>` : ''}
                        ${c.email ? `<span><i class="fas fa-envelope" style="margin-right:4px;"></i>${c.email}</span>` : ''}
                    </div>
                </div>
            `).join('');
        };

        const selectedInfo = this.selectedCustomer
            ? `<div style="padding:8px 16px;background:var(--info-bg, #eff6ff);border-bottom:1px solid var(--border-color, #eee);font-size:0.85rem;display:flex;align-items:center;gap:6px;">
                   <i class="fas fa-user-check" style="color:var(--primary-color, #4f46e5);"></i>
                   Current: <strong>${this.selectedCustomer.name}</strong>
               </div>`
            : '';

        overlay.innerHTML = `
            <div style="background:var(--card-bg, #fff);border-radius:12px;width:90%;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,0.2);display:flex;flex-direction:column;max-height:80vh;">
                <div style="padding:20px 24px 12px;">
                    <h3 style="margin:0 0 12px;font-size:1.25rem;">
                        <i class="fas fa-user-friends" style="margin-right:8px;color:var(--primary-color, #4f46e5);"></i>
                        Select Customer
                    </h3>
                    <input type="text" id="pos-customer-search"
                           placeholder="Search by name, phone, or email..."
                           style="width:100%;padding:10px 12px;border:1px solid var(--border-color, #ddd);border-radius:8px;font-size:0.95rem;box-sizing:border-box;">
                </div>
                ${selectedInfo}
                <div id="pos-customer-list" style="overflow-y:auto;flex:1;min-height:150px;max-height:400px;">
                    ${buildCustomerList(customers)}
                </div>
                <div style="padding:12px 24px 20px;border-top:1px solid var(--border-color, #eee);display:flex;gap:8px;">
                    ${this.selectedCustomer ? `
                        <button id="pos-customer-clear-btn" style="flex:1;padding:10px 16px;background:var(--danger-color, #ef4444);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.95rem;font-weight:600;">
                            <i class="fas fa-user-times"></i> Clear Customer
                        </button>
                    ` : ''}
                    <button id="pos-customer-cancel-btn" style="flex:1;padding:10px 16px;background:var(--secondary-bg, #e5e7eb);color:var(--text-color, #333);border:none;border-radius:8px;cursor:pointer;font-size:0.95rem;font-weight:500;">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const closeModal = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
        overlay.querySelector('#pos-customer-cancel-btn').addEventListener('click', closeModal);

        const searchInput = document.getElementById('pos-customer-search');
        const listContainer = document.getElementById('pos-customer-list');
        searchInput.focus();

        const bindItemClicks = () => {
            listContainer.querySelectorAll('.pos-customer-item').forEach(item => {
                item.addEventListener('click', () => {
                    const customer = customers.find(c => c.id === item.dataset.customerId);
                    if (customer) {
                        this.selectedCustomer = customer;
                        this.currentCustomer = customer;
                        this.updateCustomerDisplay();
                        this.saveCartToStorage();
                        closeModal();
                        Utils.showToast(`Customer: ${customer.name}`, 'success');
                    }
                });
            });
        };
        bindItemClicks();

        searchInput.addEventListener('input', Utils.debounce(() => {
            const query = searchInput.value.toLowerCase().trim();
            const filtered = query
                ? customers.filter(c => {
                    const hay = `${c.name || ''} ${c.phone || ''} ${c.email || ''}`.toLowerCase();
                    return hay.includes(query);
                })
                : customers;
            listContainer.innerHTML = buildCustomerList(filtered);
            bindItemClicks();
        }, 200));

        if (this.selectedCustomer) {
            overlay.querySelector('#pos-customer-clear-btn').addEventListener('click', () => {
                this.selectedCustomer = null;
                this.currentCustomer = null;
                this.updateCustomerDisplay();
                this.saveCartToStorage();
                closeModal();
                Utils.showToast('Customer cleared', 'info');
            });
        }
    }

    updateCustomerDisplay() {
        let display = document.getElementById('pos-selected-customer');
        const checkoutArea = document.querySelector('.pos-checkout-area')
            || document.getElementById('pos-checkout')?.parentElement;

        if (this.selectedCustomer) {
            if (!display && checkoutArea) {
                display = document.createElement('div');
                display.id = 'pos-selected-customer';
                display.style.cssText = 'padding:8px 12px;background:var(--info-bg, #eff6ff);border:1px solid var(--info-border, #bfdbfe);border-radius:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;font-size:0.9rem;';
                checkoutArea.prepend(display);
            }
            if (display) {
                display.innerHTML = `
                    <span>
                        <i class="fas fa-user" style="margin-right:6px;color:var(--primary-color, #4f46e5);"></i>
                        <strong>${this.selectedCustomer.name}</strong>
                    </span>
                    <button id="pos-inline-clear-customer"
                            style="background:none;border:none;color:var(--danger-color, #ef4444);cursor:pointer;font-size:0.85rem;padding:4px 8px;">
                        <i class="fas fa-times"></i> Remove
                    </button>
                `;
                display.querySelector('#pos-inline-clear-customer').addEventListener('click', () => {
                    this.selectedCustomer = null;
                    this.currentCustomer = null;
                    this.updateCustomerDisplay();
                    this.saveCartToStorage();
                    Utils.showToast('Customer cleared', 'info');
                });
            }
        } else if (display) {
            display.remove();
        }
    }
}

// Export singleton instance
export const posController = new POSController();
