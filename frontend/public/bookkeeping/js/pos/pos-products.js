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

    _activeCategory: '',

    setProducts(products) {
        this.allProducts = products || [];
        this._buildCategoryChips();
        this.renderProductList();
    },

    _buildCategoryChips() {
        const chipsEl = document.getElementById('pos-categories');
        if (!chipsEl) return;

        const cats = [...new Set(
            this.allProducts.map(p => p.category).filter(Boolean)
        )].sort();

        const allChip = `<button class="pos-category-chip${this._activeCategory === '' ? ' active' : ''}" data-category="" onclick="POSProducts._filterCategory('')">All</button>`;
        const catChips = cats.map(c =>
            `<button class="pos-category-chip${this._activeCategory === c ? ' active' : ''}" data-category="${c}" onclick="POSProducts._filterCategory('${c}')">${c}</button>`
        ).join('');

        chipsEl.innerHTML = allChip + catChips;
    },

    _filterCategory(cat) {
        this._activeCategory = cat;
        // Update chip active states
        document.querySelectorAll('.pos-category-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === cat);
        });
        const searchVal = document.getElementById('product-search')?.value.toLowerCase() || '';
        this.renderProductList(searchVal);
    },

    renderProductList(filter = '') {
        const container = document.getElementById('product-list');
        if (!container) return;

        let products = this.allProducts;

        // Category filter
        if (this._activeCategory) {
            products = products.filter(p => p.category === this._activeCategory);
        }

        // Text filter
        if (filter) {
            products = products.filter(p =>
                (p.name || '').toLowerCase().includes(filter) ||
                (p.barcode ? String(p.barcode).toLowerCase().includes(filter) : false) ||
                (p.category ? String(p.category).toLowerCase().includes(filter) : false)
            );
        }

        if (products.length === 0) {
            container.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:2.5rem 1rem;color:var(--pos-muted,#64748B);">
                    <i class="fas fa-search" style="font-size:1.5rem;opacity:0.3;display:block;margin-bottom:0.5rem;"></i>
                    <span style="font-size:0.85rem;font-weight:600;">No products found</span>
                </div>`;
            return;
        }

        container.innerHTML = products.map((p) => {
            const qty = Number(p.quantity || 0);
            const outOfStock = qty <= 0;
            const isLow = !outOfStock && qty <= 5;
            const stockClass = outOfStock ? 'out' : isLow ? 'low' : '';
            const stockIcon = outOfStock ? 'fa-ban' : 'fa-cube';
            const onclick = outOfStock ? '' : `onclick="POSProducts.promptForQuantity('${p.id}')"`;
            return `
                <button class="product-btn product-card" type="button" ${onclick} ${outOfStock ? 'disabled' : ''}>
                    <div class="pos-product-name product-card__name">${p.name || 'Untitled'}</div>
                    <div class="product-card__price">${POSUI.formatCurrency(p.price || 0)}</div>
                    <div class="product-card__stock pos-product-meta ${stockClass}">
                        <i class="fas ${stockIcon}"></i>
                        ${outOfStock ? 'Out of Stock' : `${qty} in stock`}
                    </div>
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
