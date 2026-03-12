// Simplified POS App using existing bookkeeping infrastructure
import { firebaseService } from './services/firebase-service.js';
import { State } from './utils/state.js';
import { Utils } from './utils/utils.js';

export class POSApp {
    constructor() {
        this.cart = [];
        this.currentCustomer = null;
    }

    async init() {
        try {
            Utils.showSpinner();
            
            // Wait for Firebase to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check if user is logged in via Firebase auth state
            const auth = firebaseService.auth;
            if (!auth || !auth.currentUser) {
                console.log('No user logged in, redirecting...');
                window.location.href = 'index.html';
                return;
            }
            
            State.user = auth.currentUser;
            console.log('User authenticated:', State.user.email);
            
            // Load existing data
            await firebaseService.loadAllData();
            console.log('Data loaded:', State.products.length, 'products');
            
            // Render POS UI
            this.render();
            
            Utils.hideSpinner();
            Utils.showToast('POS Ready!', 'success');
        } catch (error) {
            console.error('POS Init Error:', error);
            Utils.hideSpinner();
            Utils.showToast('POS Init Failed: ' + error.message, 'error');
            // Redirect to login if error
            setTimeout(() => window.location.href = 'index.html', 2000);
        }
    }

    render() {
        document.getElementById('pos-app').innerHTML = `
            <div class="pos-container" style="display: flex; flex-direction: column; height: 100vh;">
                <header class="pos-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <button onclick="window.location.href='index.html'" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-arrow-left"></i> Back
                        </button>
                        <h1 style="margin: 0; display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-cash-register"></i> Point of Sale
                        </h1>
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <span><i class="fas fa-user"></i> ${State.user?.email || 'User'}</span>
                        <span><i class="fas fa-store"></i> ${State.currentOutlet || 'Main'}</span>
                    </div>
                </header>
                <div class="pos-main" style="display: flex; flex: 1; overflow: hidden;">
                    <div class="products-panel" style="flex: 2; padding: 1.5rem; overflow-y: auto; background: #f8f9fa;">
                        <div style="margin-bottom: 1rem;">
                            <input type="text" id="product-search" placeholder="🔍 Search products... (Press F1)" 
                                style="width: 100%; padding: 0.75rem; border: 2px solid #ddd; border-radius: 8px; font-size: 1rem;">
                        </div>
                        <h2 style="margin: 1rem 0 0.5rem 0; color: #333;">Products (${State.products.length})</h2>
                        <div id="products-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem;"></div>
                    </div>
                    <div class="cart-panel" style="flex: 1; background: white; padding: 1.5rem; border-left: 1px solid #ddd; display: flex; flex-direction: column; min-width: 350px;">
                        <div style="margin-bottom: 1rem;">
                            <button id="customer-btn" style="width: 100%; padding: 0.75rem; background: #f8f9fa; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                                <span><i class="fas fa-user"></i> <span id="customer-name">Walk-in Customer</span></span>
                                <i class="fas fa-chevron-down"></i>
                            </button>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                            <h2 style="margin: 0;">Cart (<span id="cart-count">0</span>)</h2>
                            <button id="clear-cart-btn" style="background: #dc3545; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                                <i class="fas fa-trash"></i> Clear
                            </button>
                        </div>
                        <div id="cart-items" style="flex: 1; overflow-y: auto; margin-bottom: 1rem; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; min-height: 200px;"></div>
                        <div id="cart-totals" style="border-top: 2px solid #ddd; padding-top: 1rem; margin-bottom: 1rem;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span>Subtotal:</span>
                                <span id="subtotal">GHS 0.00</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span>Tax (0%):</span>
                                <span id="tax">GHS 0.00</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 1.25rem; font-weight: bold; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid #ddd;">
                                <span>TOTAL:</span>
                                <span id="total">GHS 0.00</span>
                            </div>
                        </div>
                        <button id="checkout-btn" disabled style="width: 100%; padding: 1rem; background: #28a745; color: white; border: none; border-radius: 8px; font-size: 1.1rem; font-weight: bold; cursor: pointer; opacity: 0.5;">
                            <i class="fas fa-check-circle"></i> Checkout (F4)
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        this.renderProducts();
        this.setupEventListeners();
    }

    renderProducts() {
        const grid = document.getElementById('products-grid');
        if (!grid || !State.products || State.products.length === 0) {
            if (grid) {
                grid.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">No products available</p>';
            }
            return;
        }
        
        grid.innerHTML = State.products.map(p => `
            <div class="product-card" onclick="window.posApp.addToCart('${p.id}')" 
                style="background: white; border: 2px solid #ddd; border-radius: 8px; padding: 1rem; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"
                onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.15)';"
                onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)';">
                <div style="text-align: center; font-size: 2rem; margin-bottom: 0.5rem;">
                    ${p.image || '📦'}
                </div>
                <h3 style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600; color: #333;">${p.name}</h3>
                <p style="margin: 0.25rem 0; color: #666; font-size: 0.85rem;">${p.category || 'Uncategorized'}</p>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #eee;">
                    <span style="font-size: 1.1rem; font-weight: bold; color: #667eea;">GHS ${p.sellingPrice?.toFixed(2) || '0.00'}</span>
                    <span style="font-size: 0.85rem; color: ${p.quantity <= 5 ? '#dc3545' : '#28a745'};">
                        <i class="fas fa-box"></i> ${p.quantity || 0}
                    </span>
                </div>
            </div>
        `).join('');
    }

    setupEventListeners() {
        // Product search
        const searchInput = document.getElementById('product-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const grid = document.getElementById('products-grid');
                const filtered = State.products.filter(p => 
                    p.name.toLowerCase().includes(query) ||
                    (p.category && p.category.toLowerCase().includes(query)) ||
                    (p.barcode && p.barcode.includes(query))
                );
                
                grid.innerHTML = filtered.map(p => `
                    <div class="product-card" onclick="window.posApp.addToCart('${p.id}')" 
                        style="background: white; border: 2px solid #ddd; border-radius: 8px; padding: 1rem; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.15)';"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)';">
                        <div style="text-align: center; font-size: 2rem; margin-bottom: 0.5rem;">
                            ${p.image || '📦'}
                        </div>
                        <h3 style="margin: 0.5rem 0; font-size: 1rem; font-weight: 600; color: #333;">${p.name}</h3>
                        <p style="margin: 0.25rem 0; color: #666; font-size: 0.85rem;">${p.category || 'Uncategorized'}</p>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #eee;">
                            <span style="font-size: 1.1rem; font-weight: bold; color: #667eea;">GHS ${p.sellingPrice?.toFixed(2) || '0.00'}</span>
                            <span style="font-size: 0.85rem; color: ${p.quantity <= 5 ? '#dc3545' : '#28a745'};">
                                <i class="fas fa-box"></i> ${p.quantity || 0}
                            </span>
                        </div>
                    </div>
                `).join('');
            });
        }

        // Clear cart
        const clearBtn = document.getElementById('clear-cart-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (this.cart.length > 0 && confirm('Clear cart?')) {
                    this.cart = [];
                    this.renderCart();
                }
            });
        }

        // Checkout
        const checkoutBtn = document.getElementById('checkout-btn');
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                if (this.cart.length > 0) {
                    this.checkout();
                }
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F1') {
                e.preventDefault();
                document.getElementById('product-search')?.focus();
            }
            if (e.key === 'F4') {
                e.preventDefault();
                if (this.cart.length > 0) {
                    this.checkout();
                }
            }
        });
    }

    addToCart(productId) {
        const product = State.products.find(p => p.id === productId);
        if (!product) {
            Utils.showToast('Product not found', 'error');
            return;
        }
        
        if (product.quantity <= 0) {
            Utils.showToast('Out of stock!', 'error');
            return;
        }

        const existingItem = this.cart.find(item => item.id === productId);
        if (existingItem) {
            if (existingItem.cartQty < product.quantity) {
                existingItem.cartQty++;
                Utils.showToast(`Added ${product.name} (${existingItem.cartQty})`, 'success');
            } else {
                Utils.showToast('Cannot exceed available stock', 'warning');
            }
        } else {
            this.cart.push({...product, cartQty: 1});
            Utils.showToast(`Added ${product.name}`, 'success');
        }
        
        this.renderCart();
    }

    renderCart() {
        const container = document.getElementById('cart-items');
        const countEl = document.getElementById('cart-count');
        const checkoutBtn = document.getElementById('checkout-btn');
        
        if (!container) return;
        
        countEl.textContent = this.cart.length;
        
        if (this.cart.length === 0) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #999;">
                    <i class="fas fa-shopping-cart" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3;"></i>
                    <p>Cart is empty</p>
                    <small>Click products to add</small>
                </div>
            `;
            checkoutBtn.disabled = true;
            checkoutBtn.style.opacity = '0.5';
            checkoutBtn.style.cursor = 'not-allowed';
        } else {
            container.innerHTML = this.cart.map((item, i) => `
                <div style="background: #f8f9fa; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                        <div style="flex: 1;">
                            <h4 style="margin: 0 0 0.25rem 0; font-size: 0.95rem;">${item.name}</h4>
                            <p style="margin: 0; color: #666; font-size: 0.85rem;">GHS ${item.sellingPrice.toFixed(2)} each</p>
                        </div>
                        <button onclick="window.posApp.removeFromCart(${i})" 
                            style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: pointer; font-size: 0.85rem;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <button onclick="window.posApp.updateQuantity(${i}, -1)" 
                                style="background: #6c757d; color: white; border: none; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: pointer; width: 30px; height: 30px;">
                                <i class="fas fa-minus"></i>
                            </button>
                            <span style="font-weight: bold; min-width: 30px; text-align: center;">${item.cartQty}</span>
                            <button onclick="window.posApp.updateQuantity(${i}, 1)" 
                                style="background: #28a745; color: white; border: none; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: pointer; width: 30px; height: 30px;">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                        <span style="font-weight: bold; color: #667eea;">GHS ${(item.sellingPrice * item.cartQty).toFixed(2)}</span>
                    </div>
                </div>
            `).join('');
            
            checkoutBtn.disabled = false;
            checkoutBtn.style.opacity = '1';
            checkoutBtn.style.cursor = 'pointer';
        }
        
        this.updateTotals();
    }

    updateQuantity(index, change) {
        const item = this.cart[index];
        const product = State.products.find(p => p.id === item.id);
        
        const newQty = item.cartQty + change;
        
        if (newQty <= 0) {
            this.removeFromCart(index);
            return;
        }
        
        if (newQty > product.quantity) {
            Utils.showToast('Cannot exceed available stock', 'warning');
            return;
        }
        
        item.cartQty = newQty;
        this.renderCart();
    }

    removeFromCart(index) {
        const item = this.cart[index];
        this.cart.splice(index, 1);
        Utils.showToast(`Removed ${item.name}`, 'info');
        this.renderCart();
    }

    updateTotals() {
        const subtotal = this.cart.reduce((sum, item) => sum + (item.sellingPrice * item.cartQty), 0);
        const tax = subtotal * 0; // 0% tax for now
        const total = subtotal + tax;
        
        document.getElementById('subtotal').textContent = `GHS ${subtotal.toFixed(2)}`;
        document.getElementById('tax').textContent = `GHS ${tax.toFixed(2)}`;
        document.getElementById('total').textContent = `GHS ${total.toFixed(2)}`;
    }

    async checkout() {
        if (this.cart.length === 0) {
            Utils.showToast('Cart is empty', 'warning');
            return;
        }

        const total = this.cart.reduce((sum, item) => sum + (item.sellingPrice * item.cartQty), 0);
        
        // Simple payment method selection
        const paymentMethod = await this.selectPaymentMethod();
        if (!paymentMethod) return;

        try {
            Utils.showSpinner();
            
            // Save to Firebase sales
            const sale = {
                date: new Date().toISOString(),
                items: this.cart.map(item => ({
                    productId: item.id,
                    name: item.name,
                    quantity: item.cartQty,
                    price: item.sellingPrice,
                    subtotal: item.sellingPrice * item.cartQty
                })),
                subtotal: total,
                tax: 0,
                total: total,
                paymentMethod: paymentMethod,
                customer: this.currentCustomer || 'Walk-in',
                outlet: State.currentOutlet || 'Main',
                cashier: State.user?.email || 'Unknown',
                userId: State.user?.uid,
                timestamp: Date.now()
            };
            
            await firebaseService.addDocument('sales', sale);
            
            // Update inventory for each item
            for (const item of this.cart) {
                const product = State.products.find(p => p.id === item.id);
                if (product) {
                    const newQuantity = product.quantity - item.cartQty;
                    await firebaseService.updateDocument('products', item.id, {
                        quantity: newQuantity
                    });
                    // Update local state
                    product.quantity = newQuantity;
                }
            }
            
            // Show receipt
            this.showReceipt(sale);
            
            // Clear cart
            this.cart = [];
            this.renderCart();
            this.renderProducts(); // Refresh to show updated stock
            
            Utils.hideSpinner();
            Utils.showToast('Sale completed successfully!', 'success');
            
        } catch (error) {
            Utils.hideSpinner();
            console.error('Checkout error:', error);
            Utils.showToast('Checkout failed: ' + error.message, 'error');
        }
    }

    async selectPaymentMethod() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';
            
            modal.innerHTML = `
                <div style="background: white; border-radius: 12px; padding: 2rem; max-width: 400px; width: 90%;">
                    <h2 style="margin: 0 0 1.5rem 0; text-align: center;">Select Payment Method</h2>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <button class="payment-btn" data-method="cash" style="padding: 1.5rem; border: 2px solid #ddd; border-radius: 8px; background: white; cursor: pointer; font-size: 1rem; transition: all 0.2s;">
                            <i class="fas fa-money-bill-wave" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; color: #28a745;"></i>
                            Cash
                        </button>
                        <button class="payment-btn" data-method="card" style="padding: 1.5rem; border: 2px solid #ddd; border-radius: 8px; background: white; cursor: pointer; font-size: 1rem; transition: all 0.2s;">
                            <i class="fas fa-credit-card" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; color: #007bff;"></i>
                            Card
                        </button>
                        <button class="payment-btn" data-method="mobile_money" style="padding: 1.5rem; border: 2px solid #ddd; border-radius: 8px; background: white; cursor: pointer; font-size: 1rem; transition: all 0.2s;">
                            <i class="fas fa-mobile-alt" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; color: #ffc107;"></i>
                            Mobile Money
                        </button>
                        <button class="payment-btn" data-method="bank_transfer" style="padding: 1.5rem; border: 2px solid #ddd; border-radius: 8px; background: white; cursor: pointer; font-size: 1rem; transition: all 0.2s;">
                            <i class="fas fa-university" style="font-size: 2rem; display: block; margin-bottom: 0.5rem; color: #6c757d;"></i>
                            Bank
                        </button>
                    </div>
                    <button id="cancel-payment" style="width: 100%; margin-top: 1rem; padding: 0.75rem; background: #6c757d; color: white; border: none; border-radius: 8px; cursor: pointer;">
                        Cancel
                    </button>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            modal.querySelectorAll('.payment-btn').forEach(btn => {
                btn.addEventListener('mouseenter', function() {
                    this.style.borderColor = '#667eea';
                    this.style.transform = 'scale(1.05)';
                });
                btn.addEventListener('mouseleave', function() {
                    this.style.borderColor = '#ddd';
                    this.style.transform = 'scale(1)';
                });
                btn.addEventListener('click', function() {
                    document.body.removeChild(modal);
                    resolve(this.dataset.method);
                });
            });
            
            document.getElementById('cancel-payment').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(null);
            });
        });
    }

    showReceipt(sale) {
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        
        const receiptDate = new Date(sale.date).toLocaleString();
        const receiptId = 'RCPT-' + Date.now().toString().slice(-8);
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 12px; padding: 2rem; max-width: 400px; width: 90%; max-height: 90vh; overflow-y: auto;">
                <div style="text-align: center; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px dashed #ddd;">
                    <h2 style="margin: 0 0 0.5rem 0;">RECEIPT</h2>
                    <p style="margin: 0; color: #666; font-size: 0.9rem;">#${receiptId}</p>
                    <p style="margin: 0.25rem 0 0 0; color: #666; font-size: 0.85rem;">${receiptDate}</p>
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <p style="margin: 0.25rem 0;"><strong>Cashier:</strong> ${sale.cashier}</p>
                    <p style="margin: 0.25rem 0;"><strong>Outlet:</strong> ${sale.outlet}</p>
                    <p style="margin: 0.25rem 0;"><strong>Payment:</strong> ${sale.paymentMethod.replace('_', ' ').toUpperCase()}</p>
                </div>
                
                <table style="width: 100%; margin: 1rem 0; border-collapse: collapse;">
                    <thead>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <th style="text-align: left; padding: 0.5rem 0;">Item</th>
                            <th style="text-align: center; padding: 0.5rem 0;">Qty</th>
                            <th style="text-align: right; padding: 0.5rem 0;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sale.items.map(item => `
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 0.5rem 0;">${item.name}</td>
                                <td style="text-align: center; padding: 0.5rem 0;">${item.quantity}</td>
                                <td style="text-align: right; padding: 0.5rem 0;">GHS ${item.subtotal.toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 2px solid #ddd;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>Subtotal:</span>
                        <span>GHS ${sale.subtotal.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span>Tax:</span>
                        <span>GHS ${sale.tax.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 1.25rem; font-weight: bold; padding-top: 0.5rem; border-top: 1px solid #ddd;">
                        <span>TOTAL:</span>
                        <span>GHS ${sale.total.toFixed(2)}</span>
                    </div>
                </div>
                
                <div style="text-align: center; margin-top: 1.5rem; padding-top: 1rem; border-top: 2px dashed #ddd;">
                    <p style="margin: 0; color: #666;">Thank you for your business!</p>
                </div>
                
                <div style="display: flex; gap: 0.5rem; margin-top: 1.5rem;">
                    <button onclick="window.print()" style="flex: 1; padding: 0.75rem; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer;">
                        <i class="fas fa-print"></i> Print
                    </button>
                    <button onclick="this.closest('[style*=fixed]').remove()" style="flex: 1; padding: 0.75rem; background: #28a745; color: white; border: none; border-radius: 8px; cursor: pointer;">
                        <i class="fas fa-check"></i> Done
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
}

// Make globally accessible
window.posApp = null;
window.addEventListener('load', () => {
    window.posApp = new POSApp();
});
