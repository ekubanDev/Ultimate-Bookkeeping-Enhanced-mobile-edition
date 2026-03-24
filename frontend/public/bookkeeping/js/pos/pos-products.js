// ==================== POS PRODUCTS (pos11.html style) ====================
import { state } from '../utils/state.js';
import { POSUI } from './pos-ui.js';
import { POSCart } from './pos-cart.js';

export const POSProducts = {
    allProducts: [],

    init() {
        this.setupEventListeners();
    },

    setupEventListeners() {
        // Search input
        const searchInput = document.getElementById('product-search');
        searchInput?.addEventListener('input', (e) => {
            this.renderProductList(e.target.value.toLowerCase());
        });
    },

    setProducts(products) {
        this.allProducts = products || [];
        this.renderProductList();
    },

    renderProductList(filter = '') {
        const container = document.getElementById('product-list');
        if (!container) return;

        let products = this.allProducts;

        // Apply filter
        if (filter) {
            products = products.filter(p =>
                (p.name || '').toLowerCase().includes(filter) ||
                (p.barcode ? String(p.barcode).toLowerCase().includes(filter) : false) ||
                (p.category ? String(p.category).toLowerCase().includes(filter) : false)
            );
        }

        if (products.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#888;padding:1rem 0;">No products found</p>';
            return;
        }

        container.innerHTML = products.map((p) => {
            const qty = Number(p.quantity || 0);
            const outOfStock = qty <= 0;
            const onclick = outOfStock ? '' : `onclick="POSProducts.promptForQuantity('${p.id}')"`; // disabled buttons won't fire
            return `
                <button class="product-btn" type="button" ${onclick} ${outOfStock ? 'disabled' : ''}>
                    <div class="pos-product-name">${p.name || 'Untitled'}</div>
                    <small class="pos-product-meta">${POSUI.formatCurrency(p.price || 0)} | Stock: ${qty}</small>
                </button>
            `;
        }).join('');
    },

    promptForQuantity(productId) {
        const product = this.allProducts.find(p => p.id === productId);
        if (!product) return;

        // Set product name
        document.getElementById('product-name-display').textContent = 
            `${product.name} - ${POSUI.formatCurrency(product.price || 0)}`;

        // Reset quantity input
        const qtyInput = document.getElementById('quantity-input');
        qtyInput.value = 1;
        qtyInput.max = product.quantity;

        // Handle discount checkbox if product has discount
        const discountContainer = document.getElementById('discount-checkbox-container');
        const discountCheckbox = document.getElementById('apply-discount-checkbox');
        const discountLabel = document.getElementById('discount-label-text');

        if (product.discount && product.discount > 0) {
            discountContainer.style.display = 'block';
            discountCheckbox.checked = true;
            discountLabel.textContent = `Apply ${product.discount}% discount`;
        } else {
            discountContainer.style.display = 'none';
        }

        // Show modal
        const modal = document.getElementById('quantity-modal');
        modal.classList.add('active');

        // Focus input
        qtyInput.focus();
        qtyInput.select();

        // Setup buttons
        document.getElementById('cancel-quantity').onclick = () => {
            modal.classList.remove('active');
        };

        document.getElementById('add-quantity').onclick = () => {
            const qty = parseInt(qtyInput.value) || 1;
            const applyDiscount = discountCheckbox.checked && product.discount;
            const discount = applyDiscount ? (product.price * qty * product.discount / 100) : 0;

            POSCart.addToCart(product, qty, discount);
            modal.classList.remove('active');
        };

        // Handle Enter key
        qtyInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                document.getElementById('add-quantity').click();
            } else if (e.key === 'Escape') {
                modal.classList.remove('active');
            }
        };
    }
};
