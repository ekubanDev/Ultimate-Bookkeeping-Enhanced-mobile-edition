// ==================== APP CONTROLLER ====================

/**
 * Main Application Controller
 * Manages all application logic, UI updates, and user interactions
 * 
 * WARNING: This is a large file (~8000 lines)
 * Consider splitting into smaller controllers:
 * - auth-controller.js
 * - inventory-controller.js  
 * - sales-controller.js
 * - expense-controller.js
 * - customer-controller.js
 * - invoice-controller.js
 * - outlet-controller.js
 * - report-controller.js
 */

import { 
    auth, db, CONFIG,
    onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
    onSnapshot, query, orderBy, limit, where, writeBatch, serverTimestamp, increment,
    secondaryAuth
} from '../config/firebase.js';
import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';
import { isDebtPayment, getSaleTotal, validateProductWrite, validateExpenseWrite, validateLiabilityWrite } from '../utils/accounting.js';
import { firebaseService } from '../services/firebase-service.js';
import { dataLoader } from '../services/data-loader.js';
import ActivityLogger from '../services/activity-logger.js';
import { metricsService } from '../services/metrics-service.js';

class AppController {
            constructor() {
                this.currentInvoiceData = null;
                this._lastOutOfStockIds = null;
                this._sectionRendered = {};
                this._sectionDirty = {};
                this._currentSection = null;
                this._posInitialized = false;
                this._posInitPromise = null;
                // Track Firestore subscriptions so we can unsubscribe on user switch.
                this._realtimeUnsubs = [];
                this.initializeUI();
                this.setupEventListeners();
                this.setupAuthObserver();
            }

            _shouldRenderSection(name) {
                return !this._sectionRendered[name] || !!this._sectionDirty[name];
            }

            _markRendered(name) {
                this._sectionRendered[name] = true;
                this._sectionDirty[name] = false;
            }

            markSectionDirty(name) {
                this._sectionDirty[name] = true;
            }

            markSectionsDirty(names) {
                names.forEach(n => { this._sectionDirty[n] = true; });
            }

            _refreshCurrentSectionIfDirty() {
                const cur = this._currentSection;
                if (!cur) return;
                // Most sections are refreshed only when marked dirty.
                // POS is initialized lazily on first open, so allow it even if not marked dirty yet.
                if (cur !== 'pos' && !this._sectionDirty[cur]) return;
                switch (cur) {
                    case 'dashboard': if (window.enhancedDashboard) { window.enhancedDashboard.state = state; window.enhancedDashboard.render(); } else this.renderDashboard(); break;
                    case 'pos':
                        // Lazy-init embedded POS exactly once.
                        if (!this._posInitPromise) {
                            this._posInitPromise = Promise.all([
                                import('../pos/pos-main.js'),
                                import('../pos/pos-ui.js'),
                                import('../pos/pos-cart.js'),
                                import('../pos/pos-products.js'),
                                import('../pos/pos-checkout.js'),
                                import('../pos/pos-scanner.js'),
                                import('../pos/pos-modal.js'),
                                import('../pos/pos-data.js'),
                                import('../pos/pos-invoice.js')
                            ]).then((mods) => {
                                window.POSMain = mods[0].POSMain;
                                window.POSUI = mods[1].POSUI;
                                window.POSCart = mods[2].POSCart;
                                window.POSProducts = mods[3].POSProducts;
                                window.POSCheckout = mods[4].POSCheckout;
                                window.POSScanner = mods[5].POSScanner;
                                window.POSModal = mods[6].POSModal;
                                window.POSData = mods[7].POSData;
                                window.POSInvoice = mods[8].POSInvoice;

                                this._posInitialized = true;
                                return window.POSMain.init();
                            });
                        }
                        this._posInitPromise?.catch((e) => console.error('Embedded POS init failed:', e));
                        break;
                    case 'sales': this.renderSales(); break;
                    case 'inventory': this.renderInventoryTable(); break;
                    case 'expenses': this.renderExpenses(); break;
                    case 'customers': this.renderCustomers(); break;
                    case 'analytics': this.renderAnalytics(); break;
                    case 'accounting': this.renderAccounting(); break;
                    case 'suppliers': this.renderSuppliers(); break;
                    case 'purchase-orders': this.renderPurchaseOrders(); break;
                    case 'consignments': this.renderConsignments(); break;
                    case 'settlements': this.renderSettlements(); break;
                    case 'liabilities': this.renderLiabilities(); break;
                    case 'outlets': this.renderOutlets(); break;
                    case 'forecasting': this.renderForecasting(); break;
                    case 'reports': this.renderReports(); break;
                    default: break;
                }
                this._markRendered(cur);
            }

            initializeUI() {
                document.getElementById('sections-container').innerHTML = TemplateBuilder.buildAllSections();
            }

            /** Simple HTML-escape helper to avoid XSS when injecting strings into innerHTML. */
            escapeHtml(value) {
                if (value === null || value === undefined) return '';
                return String(value).replace(/[&<>"']/g, (ch) => {
                    switch (ch) {
                        case '&': return '&amp;';
                        case '<': return '&lt;';
                        case '>': return '&gt;';
                        case '"': return '&quot;';
                        case "'": return '&#39;';
                        default: return ch;
                    }
                });
            }

            setupEventListeners() {

                // Navigation
                /*document.querySelectorAll('nav ul li').forEach(li => {
                    li.addEventListener('click', () => this.navigateToSection(li.dataset.section));
                });*/

                document.querySelectorAll('nav li').forEach(item => {
                    item.addEventListener('click', () => {
                        const section = item.getAttribute('data-section');
                        if (section) {
                            this.showSection(section);
                        }
                    });
                });

                // Auth events
                document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
                document.getElementById('register-form').addEventListener('submit', (e) => this.handleRegister(e));
                //document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());
                const logoutBtn = document.getElementById('logout-btn');
                if (logoutBtn) {
                    logoutBtn.addEventListener('click', async () => {
                        try {
                            await signOut(auth);
                            state.userRole = null;
                            state.assignedOutlet = null;
                            Utils.showToast('Logged out successfully', 'success');
                            this.showLoginUI();
                        } catch (error) {
                            Utils.showToast('Logout failed: ' + error.message, 'error');
                        }
                    });
                }
                document.getElementById('show-register').addEventListener('click', (e) => {
                    e.preventDefault();
                    document.getElementById('login-modal').style.display = 'none';
                    document.getElementById('register-modal').style.display = 'block';
                });
                document.getElementById('show-login').addEventListener('click', (e) => {
                    e.preventDefault();
                    document.getElementById('register-modal').style.display = 'none';
                    document.getElementById('login-modal').style.display = 'flex';
                });

                // Modal close
                document.querySelectorAll('.close').forEach(btn => {
                    btn.addEventListener('click', () => {
                        document.getElementById(btn.dataset.modal).style.display = 'none';
                    });
                });

                // Dashboard filter
                const dateFilter = document.getElementById('date-filter');
                if (dateFilter) {
                    dateFilter.addEventListener('change', () => this.renderDashboard());
                }

                // Sales filters
                const salesDateFilter = document.getElementById('sales-date-filter');
                const salesCustomerSearch = document.getElementById('sales-customer-search');
                const salesProductSearch = document.getElementById('sales-product-search-table');
                
                if (salesDateFilter) {
                    const debouncedRender = Utils.debounce(() => this.renderSales(), 300);
                    salesDateFilter.addEventListener('change', debouncedRender);
                    if (salesCustomerSearch) salesCustomerSearch.addEventListener('input', debouncedRender);
                    if (salesProductSearch) salesProductSearch.addEventListener('input', debouncedRender);
                }

                // Product search in sales modal
                const saleProductSearch = document.getElementById('sale-product-search');
                if (saleProductSearch) {
                    saleProductSearch.addEventListener('input', Utils.debounce((e) => {
                        this.searchProductsForSale(e.target.value);
                    }, 300));
                    
                    saleProductSearch.addEventListener('focus', (e) => {
                        if (e.target.value.length >= 0) {
                            this.searchProductsForSale(e.target.value);
                        }
                    });
                    
                    // Close dropdown when clicking outside
                    document.addEventListener('click', (e) => {
                        const dropdown = document.getElementById('sale-product-dropdown');
                        if (dropdown && !saleProductSearch.contains(e.target) && !dropdown.contains(e.target)) {
                            dropdown.style.display = 'none';
                        }
                    });
                }

                // Expanded chart period selector
                const expandedChartPeriod = document.getElementById('expanded-chart-period');
                if (expandedChartPeriod) {
                    expandedChartPeriod.addEventListener('change', (e) => {
                        this.updateExpandedChart(e.target.value);
                    });
                }

                // Export buttons
                const exportSalesBtn = document.getElementById('export-sales-btn');
                if (exportSalesBtn) {
                    exportSalesBtn.addEventListener('click', () => this.exportSalesCSV());
                }
                const printSalesByDateBtn = document.getElementById('print-sales-by-date-btn');
                if (printSalesByDateBtn) {
                    printSalesByDateBtn.addEventListener('click', () => this.printSalesGroupByDate());
                }

                const exportInventoryBtn = document.getElementById('export-inventory-btn');
                if (exportInventoryBtn) {
                    exportInventoryBtn.addEventListener('click', () => this.exportInventoryCSV());
                }

                const exportExpensesBtn = document.getElementById('export-expenses-btn');
                if (exportExpensesBtn) {
                    exportExpensesBtn.addEventListener('click', () => this.exportExpensesCSV());
                }

                const exportCustomersBtn = document.getElementById('export-customers-btn');
                if (exportCustomersBtn) {
                    exportCustomersBtn.addEventListener('click', () => this.exportCustomersCSV());
                }

                const exportSupplierPaymentsCsvBtn = document.getElementById('export-supplier-payments-csv-btn');
                if (exportSupplierPaymentsCsvBtn) {
                    exportSupplierPaymentsCsvBtn.addEventListener('click', () => {
                        if (window.exportService) {
                            window.exportService.exportSupplierPaymentsReport({ format: 'csv' });
                        }
                    });
                }

                const exportSupplierPaymentsPdfBtn = document.getElementById('export-supplier-payments-pdf-btn');
                if (exportSupplierPaymentsPdfBtn) {
                    exportSupplierPaymentsPdfBtn.addEventListener('click', () => {
                        if (window.exportService) {
                            window.exportService.exportSupplierPaymentsReport({ format: 'pdf' });
                        }
                    });
                }

                // Invoice button
                const invoiceBtn = document.getElementById('invoice-btn');
                if (invoiceBtn) {
                    invoiceBtn.addEventListener('click', () => {
                        this.openInvoiceModal();
                    });
                }

                // Bulk purchase button
                const bulkSaleBtn = document.getElementById('bulk-sale-btn');
                if (bulkSaleBtn) {
                    bulkSaleBtn.addEventListener('click', () => {
                        this.openBulkPurchaseModal();
                    });
                }

                // Add bulk product row button
                const addBulkProductRowBtn = document.getElementById('add-bulk-product-row');
                if (addBulkProductRowBtn) {
                    addBulkProductRowBtn.addEventListener('click', () => {
                        this.addBulkProductRow();
                    });
                }

                // Bulk sale form
                const bulkSaleForm = document.getElementById('bulk-sale-form');
                if (bulkSaleForm) {
                    bulkSaleForm.addEventListener('submit', (e) => this.handleBulkSale(e));
                    
                    // Real-time total calculation
                    ['bulk-sale-discount', 'bulk-sale-tax'].forEach(id => {
                        const input = document.getElementById(id);
                        if (input) {
                            input.addEventListener('input', () => this.updateBulkSaleTotal());
                        }
                    });
                }


                // Print all barcodes button
                const printBarcodesBtn = document.getElementById('print-all-barcodes-btn');
                if (printBarcodesBtn) {
                    printBarcodesBtn.addEventListener('click', () => {
                        this.printAllBarcodes();
                    });
                }

                const generateInvoiceBtn = document.getElementById('generate-invoice-btn');
                if (generateInvoiceBtn) {
                    generateInvoiceBtn.addEventListener('click', () => {
                        this.generateInvoicePreview();
                    });
                }

                // Inventory buttons
                const addProductBtn = document.getElementById('add-product-btn');
                if (addProductBtn) {
                    addProductBtn.addEventListener('click', () => {
                        // Clear barcode preview
                        const barcodeInput = document.getElementById('product-barcode-input');
                        const previewCanvas = document.getElementById('preview-barcode');
                        if (barcodeInput) barcodeInput.value = '';
                        if (previewCanvas) previewCanvas.style.display = 'none';
                        
                        document.getElementById('add-product-modal').style.display = 'block';
                    });
                }

                // Generate barcode button
                const generateBarcodeBtn = document.getElementById('generate-barcode-btn');
                if (generateBarcodeBtn) {
                    generateBarcodeBtn.addEventListener('click', () => {
                        this.generateAndPreviewBarcode();
                    });
                }

                // Inventory pagination
                const itemsPerPageSelect = document.getElementById('inventory-items-per-page');
                if (itemsPerPageSelect) {
                    itemsPerPageSelect.addEventListener('change', (e) => {
                        state.inventoryItemsPerPage = parseInt(e.target.value);
                        state.inventoryCurrentPage = 1;
                        this.renderInventoryTable();
                    });
                }

                // Add product form
                const addProductForm = document.getElementById('add-product-form');
                if (addProductForm) {
                    addProductForm.addEventListener('submit', (e) => this.handleAddProduct(e));
                }

                // Edit product form
                const editProductForm = document.getElementById('edit-product-form');
                if (editProductForm) {
                    editProductForm.addEventListener('submit', (e) => this.handleEditProduct(e));
                }

                // Inventory filters
                const inventorySearch = document.getElementById('inventory-search');
                const inventoryCategoryFilter = document.getElementById('inventory-category-filter');
                const inventoryStockFilter = document.getElementById('inventory-stock-filter');
                
                if (inventorySearch) {
                    const debouncedFilter = Utils.debounce(() => this.renderInventoryTable(), 300);
                    inventorySearch.addEventListener('input', debouncedFilter);
                    if (inventoryCategoryFilter) inventoryCategoryFilter.addEventListener('change', debouncedFilter);
                    if (inventoryStockFilter) inventoryStockFilter.addEventListener('change', debouncedFilter);
                }

                // Suppliers button
                const addSupplierBtn = document.getElementById('add-supplier-btn');
                if (addSupplierBtn) {
                    addSupplierBtn.addEventListener('click', () => {
                        document.getElementById('add-supplier-form').reset();
                        document.getElementById('add-supplier-modal').style.display = 'block';
                    });
                }

                // Suppliers form submit
                const addSupplierForm = document.getElementById('add-supplier-form');
                if (addSupplierForm) {
                    addSupplierForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        
                        console.log('=== SUBMITTING SUPPLIER ===');
                        console.log('User:', state.currentUser?.email);
                        console.log('UID:', state.currentUser?.uid);
                        
                        Utils.showSpinner();
                        
                        try {
                            const supplierData = {
                                name: document.getElementById('supplier-name').value.trim(),
                                contactPerson: document.getElementById('supplier-contact').value.trim(),
                                phone: document.getElementById('supplier-phone').value.trim(),
                                email: document.getElementById('supplier-email').value.trim(),
                                address: document.getElementById('supplier-address').value.trim(),
                                paymentTerms: document.getElementById('supplier-payment-terms').value,
                                notes: document.getElementById('supplier-notes').value.trim(),
                                status: 'active',
                                outstandingBalance: 0,
                                totalPurchased: 0,
                                userId: state.currentUser.uid,
                                createdAt: serverTimestamp(),
                                updatedAt: serverTimestamp()
                            };
                            
                            console.log('Supplier data to save:', supplierData);
                            
                            const suppliersRef = collection(db, 'suppliers');
                            console.log('Saving to path:', `/suppliers`);
                            
                            const docRef = await addDoc(suppliersRef, supplierData);
                            
                            console.log('✅ Supplier saved with ID:', docRef.id);
                            
                            Utils.showToast('Supplier added successfully!', 'success');
                            document.getElementById('add-supplier-modal').style.display = 'none';
                            
                            // Reload suppliers
                            console.log('Reloading suppliers...');
                            await dataLoader.loadSuppliers();
                            console.log('Suppliers loaded, count:', state.allSuppliers.length);
                            
                            this.renderSuppliers();
                            console.log('Suppliers rendered');
                            
                        } catch (error) {
                            console.error('❌ Error adding supplier:', error);
                            console.error('Error code:', error.code);
                            console.error('Error message:', error.message);
                            console.error('Error stack:', error.stack);
                            Utils.showToast('Error adding supplier: ' + error.message, 'error');
                        } finally {
                            Utils.hideSpinner();
                        }
                    });
                }

                // Suppliers filters
                const supplierSearch = document.getElementById('supplier-search');
                const supplierStatusFilter = document.getElementById('supplier-status-filter');
                
                if (supplierSearch) {
                    const debouncedFilter = Utils.debounce(() => this.renderSuppliers(), 300);
                    supplierSearch.addEventListener('input', debouncedFilter);
                    if (supplierStatusFilter) supplierStatusFilter.addEventListener('change', debouncedFilter);
                }

                // Purchase Orders button
                const addPOBtn = document.getElementById('add-po-btn');
                if (addPOBtn) {
                    addPOBtn.addEventListener('click', () => this.setupCreatePOModal());
                }

                // Purchase Order form submit
                const addPOForm = document.getElementById('add-po-form');
                if (addPOForm) {
                    addPOForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        
                        console.log('=== SUBMITTING PURCHASE ORDER ===');
                        
                        Utils.showSpinner();
                        
                        try {
                            const supplierId = document.getElementById('po-supplier').value;
                            if (!supplierId) {
                                Utils.showToast('Please select a supplier', 'error');
                                Utils.hideSpinner();
                                return;
                            }
                            
                            const supplier = state.allSuppliers.find(s => s.id === supplierId);
                            if (!supplier) {
                                Utils.showToast('Supplier not found', 'error');
                                Utils.hideSpinner();
                                return;
                            }
                            
                            // Collect all items
                            const items = [];
                            const rows = document.querySelectorAll('.po-item-row');
                            
                            for (const row of rows) {
                                const index = row.dataset.rowIndex;
                                const productId = document.getElementById(`po-product-id-${index}`)?.value;
                                const productName = document.getElementById(`po-product-search-${index}`)?.value.trim();
                                const isNew = document.getElementById(`po-product-is-new-${index}`)?.value === 'true';
                                const qty = parseFloat(document.getElementById(`po-quantity-${index}`)?.value) || 0;
                                const cost = parseFloat(document.getElementById(`po-cost-${index}`)?.value) || 0;
                                
                                if (!productName) {
                                    Utils.showToast(`Please select or enter a product for Item ${parseInt(index) + 1}`, 'error');
                                    Utils.hideSpinner();
                                    return;
                                }
                                
                                if (qty <= 0) {
                                    Utils.showToast(`Please enter quantity for ${productName}`, 'error');
                                    Utils.hideSpinner();
                                    return;
                                }
                                
                                if (cost <= 0) {
                                    Utils.showToast(`Please enter unit cost for ${productName}`, 'error');
                                    Utils.hideSpinner();
                                    return;
                                }
                                
                                const itemData = {
                                    productId: productId || null,
                                    productName: productName,
                                    quantity: qty,
                                    unitCost: cost,
                                    totalCost: qty * cost,
                                    receivedQuantity: 0,
                                    isNewProduct: isNew
                                };
                                
                                items.push(itemData);
                            }
                            
                            if (items.length === 0) {
                                Utils.showToast('Please add at least one item', 'error');
                                Utils.hideSpinner();
                                return;
                            }
                            
                            // Generate PO number
                            const year = new Date().getFullYear();
                            const count = state.allPurchaseOrders.length + 1;
                            const poNumber = `PO-${year}-${String(count).padStart(3, '0')}`;
                            
                            const subtotal = parseFloat(document.getElementById('po-subtotal')?.value) || 0;
                            const taxPercent = parseFloat(document.getElementById('po-tax-percent')?.value) || 0;
                            const tax = parseFloat(document.getElementById('po-tax-amount')?.value) || 0;
                            const shipping = parseFloat(document.getElementById('po-shipping')?.value) || 0;
                            const total = parseFloat(document.getElementById('po-grand-total')?.value) || 0;
                            
                            const poData = {
                                poNumber: poNumber,
                                supplierId: supplierId,
                                supplierName: supplier.name,
                                orderDate: document.getElementById('po-date').value,
                                expectedDeliveryDate: document.getElementById('po-delivery-date').value || null,
                                status: 'pending',
                                paymentStatus: 'unpaid',
                                paymentTerms: supplier.paymentTerms,
                                items: items,
                                itemCount: items.length,
                                subtotal: subtotal,
                                taxPercent: taxPercent,
                                tax: tax,
                                shippingCost: shipping,
                                totalAmount: total,
                                notes: document.getElementById('po-notes').value.trim(),
                                receivedDate: null,
                                receivedBy: null,
                                liabilityId: null,
                                userId: state.currentUser.uid,
                                createdAt: serverTimestamp(),
                                updatedAt: serverTimestamp()
                            };
                            
                            console.log('PO Data:', poData);
                            console.log('Items:', items.length);
                            
                            const posRef = collection(db, 'purchase_orders');
                            const docRef = await addDoc(posRef, poData);
                            
                            console.log('✅ PO saved:', docRef.id);
                            
                            Utils.showToast(`Purchase Order ${poNumber} created with ${items.length} item(s)!`, 'success');
                            document.getElementById('add-po-modal').style.display = 'none';
                            
                            // Reload purchase orders
                            await dataLoader.loadPurchaseOrders();
                            this.renderPurchaseOrders();
                            
                        } catch (error) {
                            console.error('❌ Error creating PO:', error);
                            Utils.showToast('Error: ' + error.message, 'error');
                        } finally {
                            Utils.hideSpinner();
                        }
                    });
                }

                // Purchase Orders filters
                const poSearch = document.getElementById('po-search');
                const poStatusFilter = document.getElementById('po-status-filter');
                
                if (poSearch) {
                    const debouncedFilter = Utils.debounce(() => this.renderPurchaseOrders(), 300);
                    poSearch.addEventListener('input', debouncedFilter);
                    if (poStatusFilter) poStatusFilter.addEventListener('change', debouncedFilter);
                }

                // Receive Purchase Order form submit
                const receivePOForm = document.getElementById('receive-po-form');
                if (receivePOForm) {
                    receivePOForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        
                        console.log('=== RECEIVING PURCHASE ORDER ===');
                        
                        if (!confirm('Are you sure you want to receive this purchase order? This will update inventory and create accounting entries.')) {
                            return;
                        }
                        
                        Utils.showSpinner();
                        
                        try {
                            const poId = document.getElementById('receive-po-id').value;
                            const receiveDate = document.getElementById('receive-date').value;
                            const receivedBy = document.getElementById('received-by').value;
                            
                            const po = state.allPurchaseOrders.find(p => p.id === poId);
                            
                            if (!po) {
                                Utils.showToast('Purchase order not found', 'error');
                                Utils.hideSpinner();
                                return;
                            }
                            
                            console.log("📦 PO to receive:", po);
                            console.log("📦 Items count:", po.items.length);
                            console.log("📦 Items:", JSON.stringify(po.items, null, 2));
                            
                            //const batch = writeBatch(db);
                            
                            console.log('\n=== COLLECTING RECEIVED ITEMS FROM FORM ===');
                            const receivedItems = [];
                            const itemRows = document.querySelectorAll('.receive-item-row');
                            
                            itemRows.forEach((row, index) => {
                                const receivedQty = parseFloat(row.querySelector('.item-received-qty').value) || 0;
                                const productId = row.querySelector('.item-product-id').value || null;
                                const productName = row.querySelector('.item-product-name').value;
                                const isNew = row.querySelector('.item-is-new').value === 'true';
                                const category = row.querySelector('.item-category').value;
                                const sellingPrice = parseFloat(row.querySelector('.item-selling-price').value) || 0;
                                const unitCost = parseFloat(row.querySelector('.item-unit-cost').value) || 0;
                                const orderedQty = parseFloat(row.querySelector('.item-ordered-qty').value) || 0;
                                
                                console.log(`\n📦 Item #${index + 1}: ${productName}`);
                                console.log('  Ordered:', orderedQty);
                                console.log('  Received:', receivedQty);
                                console.log('  Product ID:', productId || 'NEW');
                                console.log('  Is New:', isNew);
                                
                                if (receivedQty > 0) {
                                    receivedItems.push({
                                        productId,
                                        productName,
                                        isNewProduct: isNew,
                                        category,
                                        sellingPrice,
                                        unitCost,
                                        orderedQty,
                                        receivedQty
                                    });
                                } else {
                                    console.log('  ⚠️ Skipping - zero quantity received');
                                }
                            });
                            
                            console.log(`\n📊 Summary: ${receivedItems.length} items to process (out of ${itemRows.length} ordered)`);
                            
                            const restockIso = receiveDate
                                ? new Date(`${receiveDate}T12:00:00.000Z`).toISOString()
                                : new Date().toISOString();
                            const restockSource = `po:${poId}`;

                            const batch = writeBatch(db);
                            let inventoryUpdates = 0;
                            let newProductsAdded = 0;
                            
                            // 1. Update each item in inventory
                            console.log('\n=== PROCESSING INVENTORY UPDATES ===');
                            console.log('📍 Using shared /inventory collection');
                            
                            for (let i = 0; i < receivedItems.length; i++) {
                                const item = receivedItems[i];
                                console.log(`\n📦 Item #${i + 1}: ${item.productName}`);
                                console.log('  Quantity to add:', item.receivedQty);
                                console.log('  Unit Cost: ₵', item.unitCost);
                                console.log('  Is New:', item.isNewProduct);
                                console.log('  Product ID:', item.productId || 'N/A');
                                
                                if (item.isNewProduct) {
                                    // Add new product to SHARED inventory
                                    const newProductRef = doc(collection(db, 'inventory'));
                                    const newProductData = {
                                        name: item.productName,
                                        category: item.category,
                                        quantity: item.receivedQty,
                                        cost: item.unitCost,
                                        price: item.sellingPrice,
                                        barcode: '',
                                        createdBy: state.currentUser.uid,
                                        createdAt: serverTimestamp(),
                                        updatedAt: serverTimestamp(),
                                        lastRestockedAt: restockIso,
                                        lastRestockSource: restockSource,
                                    };
                                    
                                    console.log('  📝 Creating new product in /inventory');
                                    console.log('  📝 Doc ID:', newProductRef.id);
                                    console.log('  📝 Data:', newProductData);
                                    
                                    batch.set(newProductRef, newProductData);
                                    newProductsAdded++;
                                    console.log('  ✅ Queued for creation');
                                    
                                } else if (item.productId) {
                                    // Update existing product in SHARED inventory
                                    console.log('  📝 Fetching existing product from /inventory/' + item.productId);
                                    const productRef = doc(db, 'inventory', item.productId);
                                    const productDoc = await getDoc(productRef);
                                    
                                    if (productDoc.exists()) {
                                        const currentProduct = productDoc.data();
                                        const currentQty = currentProduct.quantity || 0;
                                        const currentCost = currentProduct.cost || 0;
                                        const newQty = currentQty + item.receivedQty;
                                        
                                        // Weighted average cost
                                        const newCost = newQty > 0
                                            ? ((currentQty * currentCost) + (item.receivedQty * item.unitCost)) / newQty
                                            : item.unitCost;
                                        
                                        console.log('  📊 Current data:', {qty: currentQty, cost: currentCost});
                                        console.log('  ➕ Adding:', {qty: item.receivedQty, cost: item.unitCost});
                                        console.log('  🎯 New values:', {qty: newQty, cost: newCost.toFixed(2)});
                                        
                                        batch.update(productRef, {
                                            quantity: newQty,
                                            cost: newCost,
                                            updatedAt: serverTimestamp(),
                                            lastRestockedAt: restockIso,
                                            lastRestockSource: restockSource,
                                        });
                                        inventoryUpdates++;
                                        console.log('  ✅ Queued for update');
                                    } else {
                                        console.log('  ❌ ERROR: Product not found in /inventory/' + item.productId);
                                        console.log('  ❌ This product ID does not exist in the database!');
                                    }
                                } else {
                                    console.log('  ⚠️ SKIPPED - No product ID and not marked as new');
                                }
                            }
                            
                            console.log(`\n📊 Inventory changes queued: ${inventoryUpdates} updates, ${newProductsAdded} new products`);
                            
                            // 2. Create liability (Accounts Payable) in SHARED collection
                            console.log('\n=== CREATING LIABILITY ===');
                            console.log('📍 Using shared /liabilities collection');
                            const liabilityRef = doc(collection(db, 'liabilities'));
                            const liabilityData = {
                                type: 'accounts_payable',
                                creditor: po.supplierName,  // Add creditor field
                                description: `Purchase Order ${po.poNumber} - ${po.supplierName}`,
                                amount: po.totalAmount,  // Original total amount
                                balance: po.totalAmount,  // Current balance owed (initially same as amount)
                                supplierId: po.supplierId,
                                supplierName: po.supplierName,
                                poId: poId,
                                poNumber: po.poNumber,
                                status: 'unpaid',
                                dueDate: this.calculateDueDate(receiveDate, po.paymentTerms),
                                createdBy: state.currentUser.uid,
                                createdAt: serverTimestamp()
                            };
                            batch.set(liabilityRef, liabilityData);
                            console.log('✅ Liability queued:', Utils.formatCurrency(po.totalAmount));
                            console.log('   Initial balance:', Utils.formatCurrency(po.totalAmount));
                            console.log('   Status: unpaid (will remain until payment recorded)');
                            
                            // 3. Update supplier outstanding balance in SHARED collection
                            console.log('\n=== UPDATING SUPPLIER ===');
                            console.log('📍 Using shared /suppliers collection');
                            const supplierRef = doc(db, 'suppliers', po.supplierId);
                            const supplierDoc = await getDoc(supplierRef);
                            if (supplierDoc.exists()) {
                                const currentBalance = supplierDoc.data().outstandingBalance || 0;
                                batch.update(supplierRef, {
                                    outstandingBalance: currentBalance + po.totalAmount,
                                    totalPurchased: increment(po.totalAmount),
                                    updatedAt: serverTimestamp()
                                });
                                console.log(`✅ Balance update queued: ₵${currentBalance} + ₵${po.totalAmount} = ₵${currentBalance + po.totalAmount}`);
                            } else {
                                console.log('⚠️ Supplier not found in /suppliers/' + po.supplierId);
                            }
                            
                            // 4. Update purchase order status in SHARED collection
                            console.log('\n=== UPDATING PURCHASE ORDER ===');
                            console.log('📍 Using shared /purchase_orders collection');
                            const poRef = doc(db, 'purchase_orders', poId);
                            batch.update(poRef, {
                                status: 'received',
                                receivedDate: receiveDate,
                                receivedBy: receivedBy,
                                liabilityId: liabilityRef.id,
                                updatedAt: serverTimestamp()
                            });
                            console.log('✅ PO status update queued: pending → received');
                            
                            // Commit all changes
                            console.log('\n=== COMMITTING BATCH TRANSACTION ===');
                            console.log('🔄 Writing all changes to database...');
                            await batch.commit();
                            console.log('✅✅✅ ALL CHANGES COMMITTED SUCCESSFULLY! ✅✅✅');
                            console.log(`\n📊 Final summary:`);
                            console.log(`   • Inventory updates: ${inventoryUpdates}`);
                            console.log(`   • New products added: ${newProductsAdded}`);
                            console.log(`   • Liability created: ₵${po.totalAmount}`);
                            console.log(`   • Supplier balance updated`);
                            console.log(`   • PO status: received`);
                            
                            Utils.showToast(`Purchase Order ${po.poNumber} received successfully!`, 'success');
                            document.getElementById('receive-po-modal').style.display = 'none';
                            
                            // Reload data
                            console.log('\n=== RELOADING DATA ===');
                            await Promise.all([
                                dataLoader.loadProducts(),
                                dataLoader.loadPurchaseOrders(),
                                dataLoader.loadSuppliers(),
                                dataLoader.loadLiabilities()
                            ]);
                            
                            this.renderPurchaseOrders();
                            
                        } catch (error) {
                            console.error('❌ Error receiving PO:', error);
                            Utils.showToast('Error: ' + error.message, 'error');
                        } finally {
                            Utils.hideSpinner();
                        }
                    });
                }

                // Sales buttons
                const addSaleBtn = document.getElementById('add-sale-btn');
                if (addSaleBtn) {
                    addSaleBtn.addEventListener('click', () => {
                        document.getElementById('sale-date').valueAsDate = new Date();
                        // Populate location dropdown if admin
                        if (state.userRole === 'admin' && state.allOutlets.length > 0) {
                            const locationContainer = document.getElementById('sale-location-container');
                            const locationSelect = document.getElementById('sale-location');
                            
                            if (locationContainer && locationSelect) {
                                locationContainer.style.display = 'block';
                                
                                locationSelect.innerHTML = '<option value="main">Main Shop</option>' +
                                    state.allOutlets
                                        .filter(o => o.status === 'active')
                                        .map(outlet => `<option value="${outlet.id}">${outlet.name}</option>`)
                                        .join('');
                            }
                        }
                        document.getElementById('sale-product-search').value = '';
                        document.getElementById('sale-product').value = '';
                        document.getElementById('sale-product-info').style.display = 'none';
                        document.getElementById('sale-product-dropdown').style.display = 'none';
                        document.getElementById('add-sale-modal').style.display = 'block';
                    });
                }

                const addSaleForm = document.getElementById('add-sale-form');
                if (addSaleForm) {
                    addSaleForm.addEventListener('submit', (e) => this.handleAddSale(e));
                    
                    // Real-time total calculation
                    ['sale-quantity', 'sale-price', 'sale-discount', 'sale-tax'].forEach(id => {
                        const input = document.getElementById(id);
                        if (input) {
                            input.addEventListener('input', () => this.updateSaleTotalPreview());
                        }
                    });
                }

                const editSaleForm = document.getElementById('edit-sale-form');
                if (editSaleForm) {
                    editSaleForm.addEventListener('submit', (e) => this.handleEditSale(e));
                    
                    // Real-time total calculation for edit form
                    ['edit-sale-quantity', 'edit-sale-price', 'edit-sale-discount', 'edit-sale-tax'].forEach(id => {
                        const input = document.getElementById(id);
                        if (input) {
                            input.addEventListener('input', () => this.updateEditSaleTotalPreview());
                        }
                    });
                }

                // Expense buttons
                const addExpenseBtn = document.getElementById('add-expense-btn');
                if (addExpenseBtn) {
                    addExpenseBtn.addEventListener('click', () => {
                        document.getElementById('expense-date').valueAsDate = new Date();
                        
                        // Show/hide outlet selector based on role
                        const outletSelector = document.getElementById('expense-outlet-selector');
                        if (outletSelector) {
                            if (state.userRole === 'admin') {
                                outletSelector.style.display = 'block';
                                this.populateExpenseOutletSelector();
                            } else {
                                outletSelector.style.display = 'none';
                            }
                        }
                        
                        document.getElementById('add-expense-modal').style.display = 'block';
                    });
                }

                const addExpenseForm = document.getElementById('add-expense-form');
                if (addExpenseForm) {
                    addExpenseForm.addEventListener('submit', (e) => this.handleAddExpense(e));
                }

                // Expense filters
                const expenseDateFilter = document.getElementById('expense-date-filter');
                const expenseSearch = document.getElementById('expense-search');
                if (expenseDateFilter) {
                    const debouncedRender = Utils.debounce(() => {
                        const table = document.getElementById('expenses-table');
                        if (table) table.dataset.expensesPage = '0';
                        this.renderExpenses(false);
                    }, 300);
                    expenseDateFilter.addEventListener('change', debouncedRender);
                    if (expenseSearch) expenseSearch.addEventListener('input', debouncedRender);
                }

                // Liability buttons
                const addLiabilityBtn = document.getElementById('add-liability-btn');
                if (addLiabilityBtn) {
                    addLiabilityBtn.addEventListener('click', () => {
                        document.getElementById('liability-due-date').valueAsDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days from now
                        document.getElementById('add-liability-modal').style.display = 'block';
                    });
                }

                const addLiabilityForm = document.getElementById('add-liability-form');
                if (addLiabilityForm) {
                    addLiabilityForm.addEventListener('submit', (e) => this.handleAddLiability(e));
                }

                const recordLiabilityPaymentForm = document.getElementById('record-liability-payment-form');
                if (recordLiabilityPaymentForm) {
                    recordLiabilityPaymentForm.addEventListener('submit', (e) => this.handleRecordLiabilityPayment(e));
                }

                // Liability filters
                const liabilityTypeFilter = document.getElementById('liability-type-filter');
                const liabilityStatusFilter = document.getElementById('liability-status-filter');
                const liabilitySearch = document.getElementById('liability-search');
                if (liabilityTypeFilter || liabilityStatusFilter || liabilitySearch) {
                    const debouncedRender = Utils.debounce(() => this.renderLiabilities(), 300);
                    if (liabilityTypeFilter) liabilityTypeFilter.addEventListener('change', debouncedRender);
                    if (liabilityStatusFilter) liabilityStatusFilter.addEventListener('change', debouncedRender);
                    if (liabilitySearch) liabilitySearch.addEventListener('input', debouncedRender);
                }

                // Customer buttons
                const addCustomerBtn = document.getElementById('add-customer-btn');
                if (addCustomerBtn) {
                    addCustomerBtn.addEventListener('click', () => {
                        document.getElementById('add-customer-modal').style.display = 'block';
                    });
                }

                const addCustomerForm = document.getElementById('add-customer-form');
                if (addCustomerForm) {
                    addCustomerForm.addEventListener('submit', (e) => this.handleAddCustomer(e));
                }

                const editCustomerForm = document.getElementById('edit-customer-form');
                if (editCustomerForm) {
                    editCustomerForm.addEventListener('submit', (e) => this.handleEditCustomer(e));
                }

                const customerSearch = document.getElementById('customer-search');
                if (customerSearch) {
                    const debouncedRender = Utils.debounce(() => {
                        const section = document.getElementById('customers');
                        if (section) section.dataset.customersPage = '0';
                        this.renderCustomers();
                    }, 300);
                    customerSearch.addEventListener('input', debouncedRender);
                }

                // Outlet management buttons
                const addOutletBtn = document.getElementById('add-outlet-btn');
                if (addOutletBtn) {
                    addOutletBtn.addEventListener('click', () => {
                        document.getElementById('add-outlet-modal').style.display = 'block';
                    });
                }

                const addOutletForm = document.getElementById('add-outlet-form');
                if (addOutletForm) {
                    addOutletForm.addEventListener('submit', (e) => this.handleAddOutlet(e));
                }

                const editOutletForm = document.getElementById('edit-outlet-form');
                if (editOutletForm) {
                    editOutletForm.addEventListener('submit', (e) => this.handleEditOutlet(e));
                }

                // Consignment management
                const sendConsignmentBtn = document.getElementById('send-consignment-btn');
                if (sendConsignmentBtn) {
                    sendConsignmentBtn.addEventListener('click', () => {
                        this.openSendConsignmentModal();
                    });
                }

                const addConsignmentProductRowBtn = document.getElementById('add-consignment-product-row');
                if (addConsignmentProductRowBtn) {
                    addConsignmentProductRowBtn.addEventListener('click', () => {
                        this.addConsignmentProductRow();
                    });
                }

                const sendConsignmentForm = document.getElementById('send-consignment-form');
                if (sendConsignmentForm) {
                    sendConsignmentForm.addEventListener('submit', (e) => this.handleSendConsignment(e));
                }

                // User Management
                const createOutletManagerBtn = document.getElementById('create-outlet-manager-btn');
                if (createOutletManagerBtn) {
                    createOutletManagerBtn.addEventListener('click', () => {
                        this.openCreateOutletManagerModal();
                    });
                }

                const refreshUsersBtn = document.getElementById('refresh-users-btn');
                if (refreshUsersBtn) {
                    refreshUsersBtn.addEventListener('click', () => this.loadManagedUsers());
                }

                const createOutletManagerForm = document.getElementById('create-outlet-manager-form');
                if (createOutletManagerForm) {
                    createOutletManagerForm.addEventListener('submit', (e) => this.handleCreateOutletManager(e));
                }

                const editUserRoleForm = document.getElementById('edit-user-role-form');
                if (editUserRoleForm) {
                    editUserRoleForm.addEventListener('submit', (e) => this.handleEditUserRole(e));
                }

                const editUserRoleSelect = document.getElementById('edit-user-role');
                if (editUserRoleSelect) {
                    editUserRoleSelect.addEventListener('change', (e) => {
                        const outletContainer = document.getElementById('edit-user-outlet-container');
                        if (outletContainer) {
                            outletContainer.style.display = e.target.value === 'outlet_manager' ? 'block' : 'none';
                        }
                    });
                }

                // Consignment filters
                const consignmentOutletFilter = document.getElementById('consignment-outlet-filter');
                const consignmentStatusFilter = document.getElementById('consignment-status-filter');
                if (consignmentOutletFilter) {
                    const debouncedRender = Utils.debounce(() => this.renderConsignments(), 300);
                    consignmentOutletFilter.addEventListener('change', debouncedRender);
                    if (consignmentStatusFilter) consignmentStatusFilter.addEventListener('change', debouncedRender);
                }

                // Settlement management
                const generateSettlementBtn = document.getElementById('generate-settlement-btn');
                if (generateSettlementBtn) {
                    generateSettlementBtn.addEventListener('click', () => {
                        this.openGenerateSettlementModal();
                    });
                }

                const recordPaymentBtn = document.getElementById('record-payment-btn');
                if (recordPaymentBtn) {
                    recordPaymentBtn.addEventListener('click', () => {
                        this.openRecordPaymentModal();
                    });
                }

                const generateSettlementForm = document.getElementById('generate-settlement-form');
                if (generateSettlementForm) {
                    generateSettlementForm.addEventListener('submit', (e) => this.handleGenerateSettlement(e));
                }

                const recordPaymentForm = document.getElementById('record-payment-form');
                if (recordPaymentForm) {
                    recordPaymentForm.addEventListener('submit', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.handleRecordPayment(e);
                    });
                }

                // Payment settlement selector
                const paymentSettlement = document.getElementById('payment-settlement');
                if (paymentSettlement) {
                    paymentSettlement.addEventListener('change', (e) => {
                        this.showPaymentSettlementInfo(e.target.value);
                    });
                }

                // Settlement filters
                const settlementOutletFilter = document.getElementById('settlement-outlet-filter');
                const settlementPeriodFilter = document.getElementById('settlement-period-filter');
                const settlementStatusFilter = document.getElementById('settlement-status-filter');
                if (settlementOutletFilter) {
                    const debouncedRender = Utils.debounce(() => this.renderSettlements(), 300);
                    settlementOutletFilter.addEventListener('change', debouncedRender);
                    if (settlementPeriodFilter) settlementPeriodFilter.addEventListener('change', debouncedRender);
                    if (settlementStatusFilter) settlementStatusFilter.addEventListener('change', debouncedRender);
                }

                // Settings form
                const settingsForm = document.getElementById('settings-form');
                if (settingsForm) {
                    settingsForm.addEventListener('submit', (e) => this.handleSaveSettings(e));
                }

                // Backup and restore
                const backupBtn = document.getElementById('backup-data-btn');
                if (backupBtn) {
                    backupBtn.addEventListener('click', () => this.backupAllData());
                }

                const restoreBtn = document.getElementById('restore-data-btn');
                const restoreInput = document.getElementById('restore-file-input');
                if (restoreBtn && restoreInput) {
                    restoreBtn.addEventListener('click', () => {
                        restoreInput.click();
                    });
                    
                    restoreInput.addEventListener('change', (e) => {
                        if (e.target.files.length > 0) {
                            this.restoreFromBackup(e.target.files[0]);
                        }
                    });
                }

                // Loan calculator
                const calculateLoanBtn = document.getElementById('calculate-loan');
                if (calculateLoanBtn) {
                    calculateLoanBtn.addEventListener('click', () => this.calculateLoan());
                }

                // Pricing calculator
                const calculatePriceBtn = document.getElementById('calculate-price');
                if (calculatePriceBtn) {
                    calculatePriceBtn.addEventListener('click', () => this.calculatePrice());
                }

                // Accounting reports
                const incomeStatementBtn = document.getElementById('generate-income-statement');
                if (incomeStatementBtn) {
                    incomeStatementBtn.addEventListener('click', () => this.generateIncomeStatement());
                }

                const balanceSheetBtn = document.getElementById('generate-balance-sheet');
                if (balanceSheetBtn) {
                    balanceSheetBtn.addEventListener('click', () => this.generateBalanceSheet());
                }

                const cashflowBtn = document.getElementById('generate-cashflow-statement');
                if (cashflowBtn) {
                    cashflowBtn.addEventListener('click', () => this.generateCashflowStatement());
                }

                // Global search
                const globalSearch = document.getElementById('global-search');
                const globalSearchResults = document.getElementById('global-search-results');

                if (globalSearch && globalSearchResults) {
                    const debouncedSearch = Utils.debounce((query) => {
                        this.performGlobalSearch(query);
                    }, 300);
                    
                    globalSearch.addEventListener('input', (e) => {
                        const query = e.target.value.trim().toLowerCase();
                        if (query.length >= 2) {
                            debouncedSearch(query);
                        } else {
                            globalSearchResults.style.display = 'none';
                        }
                    });
                    
                    // Close search results when clicking outside
                    document.addEventListener('click', (e) => {
                        if (!globalSearch.contains(e.target) && !globalSearchResults.contains(e.target)) {
                            globalSearchResults.style.display = 'none';
                        }
                    });
                }
            }

            setupAuthObserver() {
                onAuthStateChanged(auth, async (user) => {
                    if (user) {
                        const prevUid = state.currentUser?.uid || null;
                        state.currentUser = user;
                        state.authInitialized = true;

                        // Always reset section render flags on login so the UI re-renders
                        // for the currently authenticated user (prevents stale dashboard after user switch).
                        this._sectionRendered = {};
                        this._sectionDirty = {};
                        this._currentSection = null;

                        // If switching users, clear old in-memory data so UI can't show previous user's view.
                        if (prevUid && prevUid !== user.uid) {
                            state.reset();
                        }
                        // Force dashboard + core sections to re-render on login.
                        this.markSectionsDirty(['dashboard', 'sales', 'inventory', 'expenses', 'analytics', 'customers']);
                        
                        document.getElementById('login-modal').style.display = 'none';
                        document.getElementById('user-email').textContent = `Signed in as: ${user.email}`;
                        document.getElementById('user-email').style.display = 'inline';
                        document.getElementById('logout-btn').style.display = 'inline';
                        document.getElementById('connection-status').textContent = 'Connected';
                        
                        await firebaseService.ensureUserData();
                        
                        
                        //this.renderDashboard();
                        this.setupRealtimeListeners();

                        // Load user role
                        const roleData = await firebaseService.getUserRole();
                        state.userRole = roleData.role;
                        state.assignedOutlet = roleData.assignedOutlet;

                       

                        if (state.userRole === 'admin') {
                            await this.loadManagedUsers();
                        }

                        console.log('Role:', state.userRole);
                        
                        // Show appropriate UI based on role
                        this.showAppUI();
                        if (window.enhancedDashboard) window.enhancedDashboard.state = state;
                        await dataLoader.loadAll();
                        await this.loadSettings();
                        // Apply role-based restrictions
                        this.applyRoleBasedUI();
                        
                        this.showSection('dashboard');
                        
                        if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                            const outlet = state.allOutlets.find(o => o.id === state.assignedOutlet);
                            Utils.showToast(`Welcome! You're viewing ${outlet?.name || 'your outlet'}.`, 'info');
                        }
                        
                        Utils.hideSpinner();
                    } else {
                        // Unsubscribe realtime listeners so old user data can't keep streaming in.
                        if (Array.isArray(this._realtimeUnsubs) && this._realtimeUnsubs.length > 0) {
                            this._realtimeUnsubs.forEach((fn) => {
                                try { fn?.(); } catch (e) { /* noop */ }
                            });
                            this._realtimeUnsubs = [];
                        }
                        state.currentUser = null;
                        state.authInitialized = true;

                        state.userRole = null;
                        state.assignedOutlet = null;
                        state.authInitialized = true;
                        this.showLoginUI();
                        state.reset();

                        // Clear rendered/dirty flags so next login can't reuse stale DOM.
                        this._sectionRendered = {};
                        this._sectionDirty = {};
                        this._currentSection = null;
                        
                        document.getElementById('user-email').style.display = 'none';
                        document.getElementById('logout-btn').style.display = 'none';
                        document.getElementById('login-modal').style.display = 'flex';
                        
                        Utils.hideSpinner();
                    }
                });
                

                // Monitor network status
                window.addEventListener('online', () => {
                    document.getElementById('connection-status').textContent = 'Connected';
                    document.getElementById('connection-status').style.color = '#28a745';
                    Utils.showToast('Connection restored', 'success');
                });

                window.addEventListener('offline', () => {
                    document.getElementById('connection-status').textContent = 'Offline (Changes will sync when online)';
                    document.getElementById('connection-status').style.color = '#ffc107';
                    Utils.showToast('You are offline', 'warning');
                });
            }

            navigateToSection(sectionName) {
                if (sectionName === 'pos') {
                    this.openPOSModal();
                    return;
                }
                this.showSection(sectionName);
            }

            cleanupEmbeddedPOS() {
                try {
                    // Stop Quagga camera scanner if it was opened.
                    window.POSScanner?.closeCamera?.();
                } catch (e) {
                    console.warn('POS cleanup: closeCamera failed', e);
                }

                // Hide scanner overlay (fixed-position) in case it is left active.
                document.getElementById('scanner-container')?.classList.remove('active');

                // Hide POS modals (fixed-position overlays) to prevent pointer-blocking after leaving POS.
                ['checkout-modal', 'inventory-modal', 'quantity-modal'].forEach((id) => {
                    document.getElementById(id)?.classList.remove('active');
                });

                // Receipt modal is created dynamically by POSInvoice.
                document.getElementById('receipt-modal')?.classList.remove('active');

                // Hide POS modal overlay (embedded UX).
                const posModal = document.getElementById('pos-modal');
                if (posModal) {
                    posModal.classList.remove('active');
                    posModal.style.display = 'none';
                    posModal.setAttribute('aria-hidden', 'true');
                }
                document.body.classList.remove('pos-modal-open');
            }

            openPOSModal() {
                // Remember where to return.
                this._posPreviousSection = this._currentSection || 'dashboard';

                const posModal = document.getElementById('pos-modal');
                if (!posModal) return;

                posModal.classList.add('active');
                posModal.style.display = 'flex';
                posModal.setAttribute('aria-hidden', 'false');
                document.body.classList.add('pos-modal-open');

                // Prevent lazy-render bookkeeping state from overwriting POS.
                this._currentSection = 'pos';

                // Initialize POS modules if needed.
                this._refreshCurrentSectionIfDirty();
            }

            closePOSModal() {
                const prev = this._posPreviousSection || 'dashboard';
                this._posPreviousSection = null;
                // showSection() will trigger cleanupEmbeddedPOS() because _currentSection === 'pos'.
                this.showSection(prev);
            }

            showSection(sectionName) {
                // Rebuild role-based UI on each navigation in case role/assignment changed
                this.applyRoleBasedUI();

                // If we are leaving POS, ensure overlays (scanner/modals) are closed.
                const from = this._currentSection;
                if (from === 'pos' && sectionName !== 'pos') {
                    this.cleanupEmbeddedPOS();
                }

                // Restrict outlet managers from accessing admin-only sections
                if (state.userRole === 'outlet_manager') {
                    const restricted = this.getOutletManagerRestrictedSections();
                    if (restricted.includes(sectionName)) {
                        metricsService.emit('access_denied', {
                            resource: 'section',
                            resource_name: sectionName,
                            required_role: 'admin',
                            actor_role: state.userRole || 'unknown'
                        });
                        Utils.showToast('Access restricted to administrators', 'warning');
                        sectionName = 'dashboard';
                    }
                }
                
                document.querySelectorAll('section').forEach(s => s.style.display = 'none');
                document.querySelectorAll('nav li').forEach(li => li.classList.remove('active'));
                
                const section = document.getElementById(sectionName);
                const navItem = document.querySelector(`nav li[data-section="${sectionName}"]`);
                
                if (section) section.style.display = 'block';
                if (navItem) navItem.classList.add('active');
                
                // Scroll main content to top for better UX
                const container = document.getElementById('sections-container');
                if (container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });

                this._currentSection = sectionName;
                const shouldRender = this._shouldRenderSection(sectionName);

                // Render content based on section (lazy: only when first visited or dirty)
                switch(sectionName) {
                    case 'dashboard':
                        if (shouldRender) {
                            if (window.enhancedDashboard) {
                                try {
                                    window.enhancedDashboard.state = state;
                                    window.enhancedDashboard.render();
                                } catch (err) {
                                    console.error('Enhanced dashboard render failed, falling back:', err);
                                    this.renderDashboard();
                                }
                            } else {
                                this.renderDashboard();
                            }
                            if (window.stockAlerts) window.stockAlerts.showStartupAlerts();
                            this._markRendered(sectionName);
                        }
                        break;
                    case 'pos':
                        // POS is an embedded module; initialize it lazily once when the section is first opened.
                        if (shouldRender) this._refreshCurrentSectionIfDirty();
                        break;
                    case 'sales':
                        if (shouldRender) { this.renderSales(); this._markRendered(sectionName); }
                        break;
                    case 'inventory':
                        if (shouldRender) { this.renderInventoryTable(); this._markRendered(sectionName); }
                        break;
                    case 'suppliers':
                        if (shouldRender) { this.renderSuppliers(); this._markRendered(sectionName); }
                        break;
                    case 'purchase-orders':
                        if (shouldRender) { this.renderPurchaseOrders(); this._markRendered(sectionName); }
                        break;
                    case 'outlets':
                        if (state.userRole === 'admin' && shouldRender) { this.renderOutlets(); this._markRendered(sectionName); }
                        break;
                    case 'forecasting':
                        if (state.userRole === 'admin' && shouldRender) { this.renderForecasting(); this._markRendered(sectionName); }
                        break;
                    case 'accounting':
                        if (state.userRole === 'admin' && shouldRender) { this.renderAccounting(); this._markRendered(sectionName); }
                        break;
                    case 'consignments':
                        if (shouldRender) { this.renderConsignments(); this._markRendered(sectionName); }
                        break;
                    case 'settlements':
                        if (shouldRender) { this.renderSettlements(); this._markRendered(sectionName); }
                        break;
                    case 'expenses':
                        if (shouldRender) { this.renderExpenses(); this._markRendered(sectionName); }
                        break;
                    case 'customers':
                        if (shouldRender) { this.renderCustomers(); this._markRendered(sectionName); }
                        break;
                    case 'analytics':
                        if (shouldRender) { this.renderAnalytics(); this.initializeDateRangeSelector(); this._markRendered(sectionName); }
                        break;
                    case 'liabilities':
                        if (shouldRender) { this.renderLiabilities(); this._markRendered(sectionName); }
                        break;
                    case 'loans':
                        break;
                    case 'user-management':
                        if (shouldRender) { this.loadManagedUsers(); this._markRendered(sectionName); }
                        break;
                    case 'settings':
                        if (shouldRender) { this.loadSettings(); this._markRendered(sectionName); }
                        break;
                    case 'profit-analysis':
                        this.showProfitAnalysis();
                        break;
                    case 'reports':
                        if (shouldRender) { this.renderReports(); this._markRendered(sectionName); }
                        break;
                }
            }

            showAppUI() {
                const authSection = document.getElementById('auth-section');
                const appContainer = document.getElementById('app-container');
                const headerUserInfo = document.getElementById('header-user-info');
                const headerUserEmail = document.getElementById('header-user-email');
                
                if (authSection) authSection.style.display = 'none';
                if (appContainer) appContainer.style.display = 'block';
                if (headerUserInfo) headerUserInfo.style.display = 'flex';
                if (headerUserEmail) headerUserEmail.textContent = state.currentUser.email;
            }
            
            showLoginUI() {
                const authSection = document.getElementById('auth-section');
                const appContainer = document.getElementById('app-container');
                const headerUserInfo = document.getElementById('header-user-info');
                
                if (authSection) authSection.style.display = 'flex';
                if (appContainer) appContainer.style.display = 'none';
                if (headerUserInfo) headerUserInfo.style.display = 'none';
                
                state.reset();
            }

            /** Sections that outlet managers must not access (admin-only). Used for nav hiding and showSection guard. */
            getOutletManagerRestrictedSections() {
                return [
                    'outlets', 'suppliers', 'purchase-orders', 'expenses', 'accounting',
                    'liabilities', 'forecasting', 'reports', 'loans', 'user-management', 'settings'
                ];
            }

            applyRoleBasedUI() {
                const roleDisplay = document.getElementById('user-role-display');
                const outletContextEl = document.getElementById('outlet-context');
                const quickExportItem = document.getElementById('quick-export-menu-item');

                // Reset nav labels and admin controls before applying role-specific changes
                const consignmentsNav = document.querySelector('nav li[data-section="consignments"]');
                if (consignmentsNav) {
                    consignmentsNav.innerHTML = '<i class="fas fa-truck"></i> <span>Consignments</span>';
                }
                const settlementsNav = document.querySelector('nav li[data-section="settlements"]');
                if (settlementsNav) {
                    settlementsNav.innerHTML = '<i class="fas fa-file-invoice-dollar"></i> <span>Settlements</span>';
                }
                const sendConsignmentBtn = document.getElementById('send-consignment-btn');
                const generateSettlementBtn = document.getElementById('generate-settlement-btn');
                const addProductBtn = document.getElementById('add-product-btn');
                const outletSelector = document.getElementById('admin-outlet-selector');

                if (state.userRole === 'outlet_manager') {
                    const outlet = state.allOutlets.find(o => o.id === state.assignedOutlet);
                    if (!state.assignedOutlet || !outlet) {
                        console.warn('Outlet manager has no valid assignedOutlet; applying restrictions with generic context.');
                        Utils.showToast('Outlet assignment is missing; contact your administrator.', 'warning');
                    }

                    // Show outlet manager badge and context
                    if (roleDisplay) {
                        roleDisplay.innerHTML = `
                            <span class="role-badge" style="background: #6f42c1;">Outlet Manager</span> 
                            <span class="location-badge">${outlet?.name || 'Unassigned Outlet'}</span>
                        `;
                    }
                    if (outletContextEl) {
                        outletContextEl.textContent = `Viewing: ${outlet?.name || 'Unassigned outlet'}`;
                        outletContextEl.style.display = 'block';
                    }
                    
                    // Hide admin-only sections from nav for outlet managers
                    const restrictedSections = this.getOutletManagerRestrictedSections();
                    restrictedSections.forEach(section => {
                        document.querySelectorAll(`nav li[data-section="${section}"]`).forEach(navItem => {
                            navItem.style.display = 'none';
                        });
                    });
                    
                    // Update consignments nav text to clarify it's for receiving
                    if (consignmentsNav) {
                        consignmentsNav.innerHTML = '<i class="fas fa-truck"></i> Receive Consignments';
                    }
                    
                    // Rename settlements to "My Settlements"
                    if (settlementsNav) {
                        settlementsNav.innerHTML = '<i class="fas fa-file-invoice-dollar"></i> My Settlements';
                    }
                    
                    // Hide admin-specific buttons and controls
                    if (sendConsignmentBtn) sendConsignmentBtn.style.display = 'none';
                    if (generateSettlementBtn) generateSettlementBtn.style.display = 'none';
                    if (addProductBtn) addProductBtn.style.display = 'none';
                    if (outletSelector) outletSelector.style.display = 'none';
                    if (quickExportItem) quickExportItem.style.display = 'none';
                } else if (state.userRole === 'admin') {
                    // Admin: clear outlet context and show all admin controls
                    if (outletContextEl) outletContextEl.style.display = 'none';
                    if (roleDisplay) {
                        roleDisplay.innerHTML = `<span class="role-badge" style="background: #dc3545;">Admin</span>`;
                    }
                    document.querySelectorAll('nav li').forEach(item => {
                        item.style.display = '';
                    });
                    if (sendConsignmentBtn) sendConsignmentBtn.style.display = '';
                    if (generateSettlementBtn) generateSettlementBtn.style.display = '';
                    if (addProductBtn) addProductBtn.style.display = '';
                    if (outletSelector) outletSelector.style.display = '';
                    if (quickExportItem) quickExportItem.style.display = '';
                } else {
                    // Fallback: unknown role — show restricted UI, do NOT mutate state.userRole
                    console.warn('[applyRoleBasedUI] Unrecognised userRole:', state.userRole, '— showing restricted UI');
                    if (outletContextEl) outletContextEl.style.display = 'none';
                    if (roleDisplay) {
                        roleDisplay.innerHTML = `<span class="role-badge" style="background: #dc3545;">Admin</span>`;
                    }
                    document.querySelectorAll('nav li').forEach(item => { item.style.display = ''; });
                    if (sendConsignmentBtn) sendConsignmentBtn.style.display = '';
                    if (generateSettlementBtn) generateSettlementBtn.style.display = '';
                    if (addProductBtn) addProductBtn.style.display = '';
                    if (outletSelector) outletSelector.style.display = '';
                    if (quickExportItem) quickExportItem.style.display = '';
                }
            }

            // ==================== USER MANAGEMENT METHODS ====================

            openCreateOutletManagerModal() {
                if (state.allOutlets.length === 0) {
                    Utils.showToast('Please create at least one outlet first', 'warning');
                    return;
                }
                
                // Populate outlet dropdown
                const outletSelect = document.getElementById('manager-outlet');
                if (outletSelect) {
                    outletSelect.innerHTML = '<option value="">Select outlet...</option>' +
                        state.allOutlets
                            .filter(o => o.status === 'active')
                            .map(outlet => `<option value="${outlet.id}">${outlet.name} - ${outlet.location}</option>`)
                            .join('');
                }
                
                document.getElementById('create-outlet-manager-modal').style.display = 'block';
            }

            async handleCreateOutletManager(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const email = document.getElementById('manager-email').value.trim();
                    const password = document.getElementById('manager-password').value;
                    const outletId = document.getElementById('manager-outlet').value;
                    
                    if (!email || !password || !outletId) {
                        Utils.showToast('Please fill in all fields', 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const outlet = state.allOutlets.find(o => o.id === outletId);
                    
                    // Create Firebase Auth user
                    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
                    const newUser = userCredential.user;
                    
                    console.log('Created user:', newUser.uid);
                    
                    // Create user document with role
                    await setDoc(doc(db, 'users', newUser.uid), {
                        email: email,
                        role: 'outlet_manager',
                        assignedOutlet: outletId,
                        outletName: outlet.name,
                        createdAt: new Date().toISOString(),
                        createdBy: state.currentUser.uid,
                        status: 'active'
                    });
                    
                    // Add to parent's user registry
                    await setDoc(
                        doc(db, 'users', state.currentUser.uid, 'managed_users', newUser.uid),
                        {
                            email: email,
                            role: 'outlet_manager',
                            assignedOutlet: outletId,
                            outletName: outlet.name,
                            createdAt: new Date().toISOString()
                        }
                    );
                    
                    await ActivityLogger.log('User Created', `Created outlet manager account for ${email} (${outlet.name})`);
                    
                    Utils.showToast(`Outlet manager account created successfully for ${email}`, 'success');
                    
                    // Show credentials to admin
                    alert(`✅ Account Created!\n\nEmail: ${email}\nPassword: ${password}\nOutlet: ${outlet.name}\n\n⚠️ Please share these credentials securely with the outlet manager.`);
                    
                    document.getElementById('create-outlet-manager-modal').style.display = 'none';
                    document.getElementById('create-outlet-manager-form').reset();
                    
                    // Reload users
                    await this.loadManagedUsers();
                    this.renderUsers();
                    
                } catch (error) {
                    console.error('Error creating outlet manager:', error);
                    
                    let errorMessage = 'Failed to create outlet manager account';
                    if (error.code === 'auth/email-already-in-use') {
                        errorMessage = 'This email is already registered';
                    } else if (error.code === 'auth/invalid-email') {
                        errorMessage = 'Invalid email address';
                    } else if (error.code === 'auth/weak-password') {
                        errorMessage = 'Password is too weak (minimum 6 characters)';
                    }
                    
                    Utils.showToast(errorMessage, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async loadManagedUsers() {
                console.log('Loading managed users...');
                
                if (!state.currentUser) {
                    console.log('No current user');
                    return;
                }
                
                Utils.showSpinner();
                
                try {
                    state.managedUsers = [];
                    
                    // 1. Add current user (admin) first
                    try {
                        const currentUserDocRef = doc(db, 'users', state.currentUser.uid);
                        const currentUserDoc = await getDoc(currentUserDocRef);

                        console.log('Existing user:', currentUserDoc);
                        
                        if (currentUserDoc.exists()) {
                            const userData = currentUserDoc.data();
                            console.log('userData:', userData);
                        
                            await setDoc(currentUserDocRef, {
                                id: state.currentUser.uid,
                                email: state.currentUser.email,
                                role: userData.role || 'admin',
                                assignedOutlet: userData.assignedOutlet || null,
                                outletName: userData.assignedOutlet ? 
                                    state.allOutlets.find(o => o.id === userData.assignedOutlet)?.name : 'All Locations',
                                createdAt: userData.createdAt || new Date().toISOString(),
                                status: userData.status || 'active'
                            })
                            console.log('Added current user:', state.currentUser.email);
                        } else {
                            // Create user document if it doesn't exist
                            await setDoc(currentUserDocRef, {
                                email: state.currentUser.email,
                                role: 'admin',
                                assignedOutlet: null,
                                createdAt: new Date().toISOString(),
                                status: 'active'
                            });
                            
                            state.managedUsers.push({
                                id: state.currentUser.uid,
                                email: state.currentUser.email,
                                role: 'admin',
                                assignedOutlet: null,
                                outletName: 'All Locations',
                                createdAt: new Date().toISOString(),
                                status: 'active'
                            });
                            console.log('Created and added current user document');
                        }
                    } catch (userError) {
                        console.error('Error loading current user:', userError);
                    }
                    
                    // 2. Load managed users (outlet managers created by this admin)
                    try {
                        const managedUsersRef = collection(db, 'users', state.currentUser.uid, 'managed_users');
                        const managedSnapshot = await getDocs(managedUsersRef);
                        
                        console.log('Managed users snapshot size:', managedSnapshot.size);
                        
                        managedSnapshot.forEach(doc => {
                            const userData = doc.data();
                            state.managedUsers.push({
                                id: doc.id,
                                email: userData.email,
                                role: userData.role || 'outlet_manager',
                                assignedOutlet: userData.assignedOutlet || null,
                                outletName: userData.outletName || 
                                    (userData.assignedOutlet ? 
                                        state.allOutlets.find(o => o.id === userData.assignedOutlet)?.name : 'N/A'),
                                createdAt: userData.createdAt || 'N/A',
                                status: userData.status || 'active'
                            });
                        });
                        this.renderUsers()
                        console.log('Total managed users loaded:', managedSnapshot.size);
                    } catch (managedError) {
                        console.error('Error loading managed users:', managedError);
                    }
                    
                    console.log('Total users in state:', state.managedUsers.length);
                    console.log('Users:', state.managedUsers);
                    
                } catch (error) {
                    console.error('Error in loadManagedUsers:', error);
                    Utils.showToast('Failed to load users: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            renderUsers() {
                console.log('=== RENDERING USERS ===');
                console.log('Users to render:', state.managedUsers?.length || 0);
                
                const tbody = document.querySelector('#users-table tbody');
                if (!tbody) {
                    console.error('ERROR: Users table tbody not found in DOM');
                    return;
                }
                
                if (!state.managedUsers || state.managedUsers.length === 0) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="6" class="no-data">
                                <i class="fas fa-users" style="font-size: 2rem; color: #ddd; margin-bottom: 0.5rem;"></i>
                                <p>No outlet managers created yet.</p>
                                <small style="color: #888;">Click "Create Outlet Manager Account" above to add users.</small>
                            </td>
                        </tr>
                    `;
                    return;
                }
                
                tbody.innerHTML = state.managedUsers.map(user => {
                    const isCurrentUser = user.id === state.currentUser.uid;
                    
                    return `
                        <tr style="${isCurrentUser ? 'background: #f0f8ff;' : ''}">
                            <td>
                                <strong>${user.email}</strong>
                                ${isCurrentUser ? '<span style="color: #007bff; font-size: 0.8rem; margin-left: 0.5rem;">(You)</span>' : ''}
                            </td>
                            <td>
                                <span class="role-badge" style="background: ${user.role === 'admin' ? '#dc3545' : '#6f42c1'};">
                                    ${user.role === 'admin' ? 'ADMIN' : 'OUTLET MANAGER'}
                                </span>
                            </td>
                            <td>${user.outletName || 'N/A'}</td>
                            <td>${user.createdAt && user.createdAt !== 'N/A' ? 
                                new Date(user.createdAt).toLocaleDateString() : 'N/A'}</td>
                            <td>
                                <span style="padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; background: ${user.status === 'active' ? '#d4edda' : '#f8d7da'}; color: ${user.status === 'active' ? '#155724' : '#721c24'};">
                                    ${user.status ? user.status.toUpperCase() : 'ACTIVE'}
                                </span>
                            </td>
                            <td class="actions">
                                ${!isCurrentUser && user.role !== 'admin' ? `
                                    <button onclick="appController.editUserRole('${user.id}')" title="Edit Role">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="danger" onclick="appController.deleteUser('${user.id}')" title="Deactivate User">
                                        <i class="fas fa-ban"></i>
                                    </button>
                                ` : `
                                    <span style="color: #888; font-size: 0.85rem;">
                                        <i class="fas fa-crown"></i> ${isCurrentUser ? 'Your Account' : 'Admin Account'}
                                    </span>
                                `}
                            </td>
                        </tr>
                    `;
                }).join('');
                
                console.log('✓ Users table rendered successfully');
            }

            async editUserRole(userId) {
                const user = state.managedUsers.find(u => u.id === userId);
                if (!user) return;
                
                document.getElementById('edit-user-id').value = user.id;
                document.getElementById('edit-user-email').value = user.email;
                document.getElementById('edit-user-role').value = user.role;
                
                // Populate outlet dropdown
                const outletSelect = document.getElementById('edit-user-outlet');
                if (outletSelect) {
                    outletSelect.innerHTML = '<option value="">None</option>' +
                        state.allOutlets
                            .filter(o => o.status === 'active')
                            .map(outlet => `<option value="${outlet.id}" ${outlet.id === user.assignedOutlet ? 'selected' : ''}>${outlet.name}</option>`)
                            .join('');
                }
                
                // Show/hide outlet selection based on role
                const outletContainer = document.getElementById('edit-user-outlet-container');
                if (outletContainer) {
                    outletContainer.style.display = user.role === 'outlet_manager' ? 'block' : 'none';
                }
                
                document.getElementById('edit-user-role-modal').style.display = 'block';
            }

            async handleEditUserRole(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const userId = document.getElementById('edit-user-id').value;
                    const role = document.getElementById('edit-user-role').value;
                    const assignedOutlet = role === 'outlet_manager' ? document.getElementById('edit-user-outlet').value : null;
                    
                    const outlet = assignedOutlet ? state.allOutlets.find(o => o.id === assignedOutlet) : null;
                    
                    const updateData = {
                        role: role,
                        assignedOutlet: assignedOutlet,
                        outletName: outlet ? outlet.name : 'All Locations',
                        updatedAt: new Date().toISOString()
                    };
                    
                    // Update user document
                    await updateDoc(doc(db, 'users', userId), updateData);
                    
                    // Update in parent's managed users
                    await updateDoc(
                        doc(db, 'users', state.currentUser.uid, 'managed_users', userId),
                        updateData
                    );
                    
                    await ActivityLogger.log('User Updated', `Updated user role for ${userId}`);
                    
                    Utils.showToast('User role updated successfully', 'success');
                    document.getElementById('edit-user-role-modal').style.display = 'none';
                    
                    await this.loadManagedUsers();
                    this.renderUsers();
                    
                } catch (error) {
                    Utils.showToast('Failed to update user: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async deleteUser(userId) {
                const user = state.managedUsers.find(u => u.id === userId);
                if (!user) return;
                
                if (!confirm(`Delete user account for ${user.email}? This action cannot be undone.`)) {
                    return;
                }
                
                Utils.showSpinner();
                try {
                    // Note: Cannot delete Firebase Auth user from client side
                    // Can only deactivate the account
                    
                    await updateDoc(doc(db, 'users', userId), {
                        status: 'deactivated',
                        deactivatedAt: new Date().toISOString()
                    });
                    
                    await updateDoc(
                        doc(db, 'users', state.currentUser.uid, 'managed_users', userId),
                        {
                            status: 'deactivated',
                            deactivatedAt: new Date().toISOString()
                        }
                    );
                    
                    await ActivityLogger.log('User Deactivated', `Deactivated user: ${user.email}`);
                    
                    Utils.showToast('User account deactivated', 'success');
                    
                    await this.loadManagedUsers();
                    this.renderUsers();
                    
                } catch (error) {
                    Utils.showToast('Failed to delete user: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            setupRealtimeListeners() {
                // Unsubscribe existing listeners (important on logout/login user switch)
                if (Array.isArray(this._realtimeUnsubs) && this._realtimeUnsubs.length > 0) {
                    this._realtimeUnsubs.forEach((fn) => {
                        try { fn?.(); } catch (e) { /* noop */ }
                    });
                    this._realtimeUnsubs = [];
                }

                const isOutletManager = state.userRole === 'outlet_manager' && state.assignedOutlet && state.parentAdminId;

                // Inventory changes
                const inventoryRef = isOutletManager
                    ? collection(db, 'users', state.parentAdminId, 'outlets', state.assignedOutlet, 'outlet_inventory')
                    : firebaseService.getUserCollection('inventory');

                this._realtimeUnsubs.push(onSnapshot(inventoryRef, () => {
                    dataLoader.loadProducts().then(() => {
                        this.markSectionsDirty(['inventory', 'dashboard', 'outlets', 'consignments', 'settlements']);
                        this.checkLowStockAndNotify();
                        this._refreshCurrentSectionIfDirty();
                        if (!isOutletManager) this.markSectionDirty('user-management');
                    });
                }));

                // Sales changes
                const salesRef = isOutletManager
                    ? collection(db, 'users', state.parentAdminId, 'outlets', state.assignedOutlet, 'outlet_sales')
                    : firebaseService.getUserCollection('sales');

                this._realtimeUnsubs.push(onSnapshot(salesRef, () => {
                    dataLoader.loadSales().then(() => {
                        this.markSectionsDirty(['sales', 'dashboard', 'accounting', 'analytics']);
                        this._refreshCurrentSectionIfDirty();
                    });
                }));

                // Expenses changes
                if (isOutletManager) {
                    const outletExpensesRef = collection(
                        db,
                        'users',
                        state.parentAdminId,
                        'outlets',
                        state.assignedOutlet,
                        'outlet_expenses'
                    );
                    this._realtimeUnsubs.push(onSnapshot(outletExpensesRef, () => {
                        dataLoader.loadExpenses().then(() => {
                            this.markSectionsDirty(['expenses', 'dashboard', 'analytics', 'accounting']);
                            this._refreshCurrentSectionIfDirty();
                        });
                    }));
                } else if (state.userRole === 'admin') {
                    this._realtimeUnsubs.push(onSnapshot(firebaseService.getUserCollection('expenses'), () => {
                        dataLoader.loadExpenses().then(() => {
                            this.markSectionsDirty(['expenses', 'dashboard', 'analytics', 'accounting']);
                            this._refreshCurrentSectionIfDirty();
                        });
                    }));
                }

                this._realtimeUnsubs.push(onSnapshot(firebaseService.getUserCollection('customers'), () => {
                    dataLoader.loadCustomers().then(() => {
                        this.markSectionDirty('customers');
                        this._refreshCurrentSectionIfDirty();
                    });
                }));

                this._realtimeUnsubs.push(onSnapshot(firebaseService.getUserCollection('liabilities'), () => {
                    dataLoader.loadLiabilities().then(() => {
                        this.markSectionsDirty(['liabilities', 'dashboard', 'accounting']);
                        this._refreshCurrentSectionIfDirty();
                    });
                }));

                // payment_transactions drives dashboard debtPayments and accounting cash-flow —
                // subscribe so cross-device writes are reflected without a full reload.
                if (state.userRole === 'admin') {
                    this._realtimeUnsubs.push(onSnapshot(
                        query(
                            collection(db, 'payment_transactions'),
                            where('type', '==', 'liability_payment')
                        ),
                        () => {
                            dataLoader.loadLiabilityPayments().then(() => {
                                this.markSectionsDirty(['liabilities', 'dashboard', 'accounting']);
                                this._refreshCurrentSectionIfDirty();
                            });
                        }
                    ));
                }
            }

            async handleLogin(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const email = document.getElementById('login-email').value;
                    const password = document.getElementById('login-password').value;
                    await signInWithEmailAndPassword(auth, email, password);
                    Utils.showToast('Signed in successfully', 'success');
                } catch (error) {
                    Utils.showToast('Login failed: ' + error.message, 'error');
                    Utils.hideSpinner();
                }
            }

            async handleRegister(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const email = document.getElementById('register-email').value;
                    const password = document.getElementById('register-password').value;
                    await createUserWithEmailAndPassword(auth, email, password);
                    Utils.showToast('Account created', 'success');
                } catch (error) {
                    Utils.showToast('Registration failed: ' + error.message, 'error');
                    Utils.hideSpinner();
                }
            }

            async handleLogout() {
                Utils.showSpinner();
                await signOut(auth);
                Utils.showToast('Logged out', 'info');
            }

            updateElement(id, value, isHTML = false) {
                const el = document.getElementById(id);
                if (el) {
                    if (isHTML) el.innerHTML = value;
                    else el.textContent = value;
                }
            }
            async handleAddProduct(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    if (window.formValidator) {
                        const validation = window.formValidator.validateProduct({
                            name: document.getElementById('product-name')?.value,
                            price: document.getElementById('product-price')?.value,
                            cost: document.getElementById('product-cost')?.value,
                            quantity: document.getElementById('product-quantity')?.value,
                            category: document.getElementById('product-category')?.value
                        });
                        if (!validation.isValid) {
                            Utils.showToast(validation.errors[0], 'error');
                            return;
                        }
                    }

                    const barcodeInput = document.getElementById('product-barcode-input');
                    const barcode = barcodeInput?.value || Utils.generateBarcode();

                    const productData = {
                        name: document.getElementById('product-name').value,
                        category: document.getElementById('product-category').value,
                        cost: parseFloat(document.getElementById('product-cost').value),
                        price: parseFloat(document.getElementById('product-price').value),
                        quantity: parseInt(document.getElementById('product-quantity').value),
                        minStock: parseInt(document.getElementById('product-min-stock').value) || 0,
                        barcode: barcode,
                        createdAt: new Date().toISOString()
                    };

                    const guard = validateProductWrite(productData);
                    if (!guard.ok) { Utils.showToast(guard.error, 'error'); return; }

                    await addDoc(firebaseService.getUserCollection('inventory'), productData);
                    await ActivityLogger.log('Product Added', `Added product: ${productData.name}`);
                    
                    Utils.showToast('Product added successfully', 'success');
                    document.getElementById('add-product-modal').style.display = 'none';
                    document.getElementById('add-product-form').reset();
                } catch (error) {
                    Utils.showToast('Failed to add product: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async handleEditProduct(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const productId = document.getElementById('edit-product-id').value;
                    const productData = {
                        name: document.getElementById('edit-product-name').value,
                        category: document.getElementById('edit-product-category').value,
                        cost: parseFloat(document.getElementById('edit-product-cost').value),
                        price: parseFloat(document.getElementById('edit-product-price').value),
                        quantity: parseInt(document.getElementById('edit-product-quantity').value),
                        minStock: parseInt(document.getElementById('edit-product-min-stock').value) || 0,
                        updatedAt: new Date().toISOString()
                    };

                    const guard = validateProductWrite(productData);
                    if (!guard.ok) { Utils.showToast(guard.error, 'error'); return; }

                    await updateDoc(doc(firebaseService.getUserCollection('inventory'), productId), productData);
                    await ActivityLogger.log('Product Updated', `Updated product: ${productData.name}`);
                    
                    Utils.showToast('Product updated successfully', 'success');
                    document.getElementById('edit-product-modal').style.display = 'none';
                } catch (error) {
                    Utils.showToast('Failed to update product: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async deleteProduct(productId) {
                if (state.userRole !== 'admin') {
                    metricsService.emit('access_denied', { resource: 'action', resource_name: 'deleteProduct', actor_role: state.userRole });
                    Utils.showToast('Access restricted to administrators', 'warning');
                    return;
                }
                if (!confirm('Are you sure you want to delete this product?')) return;

                Utils.showSpinner();
                try {
                    const product = state.allProducts.find(p => p.id === productId);
                    await deleteDoc(doc(firebaseService.getUserCollection('inventory'), productId));
                    await ActivityLogger.log('Product Deleted', `Deleted product: ${product?.name || 'Unknown'}`);
                    
                    Utils.showToast('Product deleted successfully', 'success');
                } catch (error) {
                    Utils.showToast('Failed to delete product: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            viewProduct(productId) {
                const product = state.allProducts.find(p => p.id === productId);
                if (!product) return;
                
                const detailsDiv = document.getElementById('product-details');
                detailsDiv.innerHTML = `
                    <p><strong>Name:</strong> ${product.name}</p>
                    <p><strong>Category:</strong> ${product.category}</p>
                    <p><strong>Cost:</strong> ${Utils.formatCurrency(product.cost)}</p>
                    <p><strong>Price:</strong> ${Utils.formatCurrency(product.price)}</p>
                    <p><strong>Quantity:</strong> ${product.quantity}</p>
                    <p><strong>Min Stock:</strong> ${product.minStock || 10}</p>
                    <p><strong>Barcode:</strong> ${product.barcode || 'N/A'}</p>
                `;
                
                if (product.barcode) {
                    JsBarcode("#product-barcode", product.barcode, {
                        format: "CODE128",
                        width: 2,
                        height: 100,
                        displayValue: true
                    });
                }
                
                document.getElementById('view-product-modal').style.display = 'block';
            }

            printAllBarcodes() {
                if (state.allProducts.length === 0) {
                    Utils.showToast('No products to print barcodes for', 'warning');
                    return;
                }
                
                const productsWithBarcodes = state.allProducts.filter(p => p.barcode);
                
                if (productsWithBarcodes.length === 0) {
                    Utils.showToast('No products have barcodes assigned', 'warning');
                    return;
                }
                
                const printWindow = window.open('', '_blank');
                
                printWindow.document.write(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Product Barcodes</title>
                        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
                        <style>
                            body {
                                font-family: Arial, sans-serif;
                                padding: 2rem;
                            }
                            h1 {
                                text-align: center;
                                color: #007bff;
                                margin-bottom: 2rem;
                            }
                            .barcode-item {
                                page-break-inside: avoid;
                                margin-bottom: 2rem;
                                border: 1px solid #ddd;
                                padding: 1rem;
                                border-radius: 4px;
                            }
                            @media print {
                                .no-print { display: none; }
                                .barcode-item { page-break-inside: avoid; }
                            }
                        </style>
                    </head>
                    <body>
                        <h1>Product Barcodes</h1>
                        <button onclick="window.print()" class="no-print" style="padding: 0.75rem 1.5rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 1rem;">
                            <i class="fas fa-print"></i> Print
                        </button>
                        <div id="barcodes-container"></div>
                    </body>
                    </html>
                `);
                
                printWindow.document.close();
                
                // Wait for document to be ready, then add barcodes
                printWindow.addEventListener('load', function() {
                    const container = printWindow.document.getElementById('barcodes-container');
                    
                    productsWithBarcodes.forEach(product => {
                        // Create a safe ID for use in the DOM/CSS selector (no spaces or special chars)
                        const rawId = (product.id || '').toString();
                        const safeId = `barcode-${rawId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                        // Create barcode item
                        const itemDiv = printWindow.document.createElement('div');
                        itemDiv.className = 'barcode-item';
                        itemDiv.innerHTML = `
                            <h3 style="margin: 0 0 0.5rem 0; color: #007bff;">${product.name}</h3>
                            <p style="margin: 0 0 0.5rem 0; color: #666;">
                                <strong>Category:</strong> ${product.category} | 
                                <strong>Price:</strong> ${Utils.formatCurrency(product.price)} | 
                                <strong>Stock:</strong> ${product.quantity}
                            </p>
                            <svg id="${safeId}"></svg>
                        `;
                        container.appendChild(itemDiv);
                        
                        // Generate barcode
                        printWindow.JsBarcode(`#${safeId}`, product.barcode, {
                            format: "CODE128",
                            width: 2,
                            height: 80,
                            displayValue: true,
                            fontSize: 14,
                            margin: 10
                        });
                    });
                });
            }

            generateAndPreviewBarcode() {
                const barcodeInput = document.getElementById('product-barcode-input');
                const previewCanvas = document.getElementById('preview-barcode');
                
                if (!barcodeInput || !previewCanvas) return;
                
                const barcode = Utils.generateBarcode();
                barcodeInput.value = barcode;
                
                try {
                    JsBarcode("#preview-barcode", barcode, {
                        format: "CODE128",
                        width: 2,
                        height: 60,
                        displayValue: true,
                        fontSize: 12
                    });
                    previewCanvas.style.display = 'block';
                    Utils.showToast('Barcode generated', 'success');
                } catch (error) {
                    Utils.showToast('Failed to generate barcode: ' + error.message, 'error');
                }
            }

            editProduct(productId) {
                if (state.userRole !== 'admin') {
                    metricsService.emit('access_denied', { resource: 'action', resource_name: 'editProduct', actor_role: state.userRole });
                    Utils.showToast('Access restricted to administrators', 'warning');
                    return;
                }
                const product = state.allProducts.find(p => p.id === productId);
                if (!product) return;
                
                document.getElementById('edit-product-id').value = product.id;
                document.getElementById('edit-product-name').value = product.name;
                document.getElementById('edit-product-category').value = product.category;
                document.getElementById('edit-product-cost').value = product.cost;
                document.getElementById('edit-product-price').value = product.price;
                document.getElementById('edit-product-quantity').value = product.quantity;
                document.getElementById('edit-product-min-stock').value = product.minStock || 10;
                
                document.getElementById('edit-product-modal').style.display = 'block';
            }

            renderInventoryTable() {
                const tbody = document.querySelector('#inventory-table tbody');
                if (!tbody) return;
                
                tbody.innerHTML = '';
                
                const search = document.getElementById('inventory-search')?.value.toLowerCase() || '';
                const category = document.getElementById('inventory-category-filter')?.value || '';
                const stockFilter = document.getElementById('inventory-stock-filter')?.value || '';
                
                let filtered = [...state.allProducts];
                
                if (search) {
                    filtered = filtered.filter(p => p.name.toLowerCase().includes(search));
                }
                
                if (category) {
                    filtered = filtered.filter(p => p.category === category);
                }
                
                if (stockFilter) {
                    filtered = filtered.filter(p => {
                        if (stockFilter === 'in-stock') return p.quantity > (p.minStock || 10);
                        if (stockFilter === 'low-stock') return p.quantity <= (p.minStock || 10) && p.quantity > 0;
                        if (stockFilter === 'out-of-stock') return p.quantity === 0;
                        return true;
                    });
                }
                
                // Calculate pagination
                const totalItems = filtered.length;
                const totalPages = Math.ceil(totalItems / state.inventoryItemsPerPage);
                
                // Ensure current page is valid
                if (state.inventoryCurrentPage > totalPages && totalPages > 0) {
                    state.inventoryCurrentPage = totalPages;
                }
                
                const startIndex = (state.inventoryCurrentPage - 1) * state.inventoryItemsPerPage;
                const endIndex = startIndex + state.inventoryItemsPerPage;
                const paginatedProducts = filtered.slice(startIndex, endIndex);
                
                if (paginatedProducts.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="no-data">No products found</td></tr>';
                } else {
                    const isAdmin = state.userRole === 'admin';
                    paginatedProducts.forEach(product => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${product.name}</td>
                            <td>${product.category}</td>
                            <td>${Utils.formatCurrency(product.cost)}</td>
                            <td>${Utils.formatCurrency(product.price)}</td>
                            <td>${product.quantity}</td>
                            <td class="actions">
                                <button onclick="appController.viewProduct('${product.id}')" title="View"><i class="fas fa-eye"></i></button>
                                ${isAdmin ? `
                                <button onclick="appController.editProduct('${product.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                <button class="danger" onclick="appController.deleteProduct('${product.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                                ` : ''}
                            </td>
                        `;
                        tbody.appendChild(row);
                    });
                }
                
                // Render pagination controls
                this.renderInventoryPagination(totalItems, totalPages);
            }
            
            renderInventoryPagination(totalItems, totalPages) {
                const paginationDiv = document.getElementById('inventory-pagination');
                if (!paginationDiv) return;
                
                if (totalPages <= 1) {
                    paginationDiv.innerHTML = '';
                    return;
                }
                
                let html = '';
                
                // Previous button
                html += `
                    <button onclick="appController.goToInventoryPage(${state.inventoryCurrentPage - 1})" 
                            ${state.inventoryCurrentPage === 1 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-left"></i> Previous
                    </button>
                `;
                
                // Page numbers
                const maxVisiblePages = 5;
                let startPage = Math.max(1, state.inventoryCurrentPage - Math.floor(maxVisiblePages / 2));
                let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
                
                if (endPage - startPage < maxVisiblePages - 1) {
                    startPage = Math.max(1, endPage - maxVisiblePages + 1);
                }
                
                if (startPage > 1) {
                    html += `<button onclick="appController.goToInventoryPage(1)">1</button>`;
                    if (startPage > 2) {
                        html += `<span class="pagination-info">...</span>`;
                    }
                }
                
                for (let i = startPage; i <= endPage; i++) {
                    html += `
                        <button onclick="appController.goToInventoryPage(${i})" 
                                class="${i === state.inventoryCurrentPage ? 'active' : ''}">
                            ${i}
                        </button>
                    `;
                }
                
                if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                        html += `<span class="pagination-info">...</span>`;
                    }
                    html += `<button onclick="appController.goToInventoryPage(${totalPages})">${totalPages}</button>`;
                }
                
                // Next button
                html += `
                    <button onclick="appController.goToInventoryPage(${state.inventoryCurrentPage + 1})" 
                            ${state.inventoryCurrentPage === totalPages ? 'disabled' : ''}>
                        Next <i class="fas fa-chevron-right"></i>
                    </button>
                `;
                
                // Info
                const startItem = (state.inventoryCurrentPage - 1) * state.inventoryItemsPerPage + 1;
                const endItem = Math.min(state.inventoryCurrentPage * state.inventoryItemsPerPage, totalItems);
                html += `<span class="pagination-info">Showing ${startItem}-${endItem} of ${totalItems}</span>`;
                
                paginationDiv.innerHTML = html;
            }
            
            goToInventoryPage(page) {
                const totalPages = Math.ceil(
                    this.getFilteredProducts().length / state.inventoryItemsPerPage
                );
                
                if (page >= 1 && page <= totalPages) {
                    state.inventoryCurrentPage = page;
                    this.renderInventoryTable();
                }
            }
            
            getFilteredProducts() {
                const search = document.getElementById('inventory-search')?.value.toLowerCase() || '';
                const category = document.getElementById('inventory-category-filter')?.value || '';
                const stockFilter = document.getElementById('inventory-stock-filter')?.value || '';
                
                let filtered = [...state.allProducts];
                
                if (search) {
                    filtered = filtered.filter(p => p.name.toLowerCase().includes(search));
                }
                
                if (category) {
                    filtered = filtered.filter(p => p.category === category);
                }
                
                if (stockFilter) {
                    filtered = filtered.filter(p => {
                        if (stockFilter === 'in-stock') return p.quantity > (p.minStock || 10);
                        if (stockFilter === 'low-stock') return p.quantity <= (p.minStock || 10) && p.quantity > 0;
                        if (stockFilter === 'out-of-stock') return p.quantity === 0;
                        return true;
                    });
                }
                
                return filtered;
            }

            populateSaleProductDropdown() {
                const select = document.getElementById('sale-product');
                const editSelect = document.getElementById('edit-sale-product');
                
                if (select) {
                    select.innerHTML = '<option value="">Select Product</option>';
                    state.allProducts
                        .filter(p => p.quantity > 0)
                        .forEach(product => {
                            select.innerHTML += `
                                <option value="${product.name}" data-price="${product.price}" data-stock="${product.quantity}">
                                    ${product.name} (Stock: ${product.quantity}) - ${Utils.formatCurrency(product.price)}
                                </option>
                            `;
                        });
                }
                
                if (editSelect) {
                    editSelect.innerHTML = '<option value="">Select Product</option>';
                    state.allProducts.forEach(product => {
                        editSelect.innerHTML += `
                            <option value="${product.name}" data-price="${product.price}" data-stock="${product.quantity}">
                                ${product.name} (Stock: ${product.quantity}) - ${Utils.formatCurrency(product.price)}
                            </option>
                        `;
                    });
                }
            }

            searchProductsForSale(query) {
                const dropdown = document.getElementById('sale-product-dropdown');
                if (!dropdown) return;
                
                const searchQuery = String(query || '').toLowerCase().trim();
                
                const availableProducts = state.allProducts.filter(p => p.quantity > 0);
                
                let filtered = availableProducts;
                if (searchQuery) {
                    filtered = availableProducts.filter(p => {
                        const name = String(p.name || '').toLowerCase();
                        const category = String(p.category || '').toLowerCase();
                        const barcode = String(p.barcode || '').toLowerCase();
                        return (
                            name.includes(searchQuery) ||
                            category.includes(searchQuery) ||
                            barcode.includes(searchQuery)
                        );
                    });
                }
                
                if (filtered.length === 0) {
                    dropdown.innerHTML = '<div style="padding: 0.75rem; color: #666; text-align: center;">No products found</div>';
                    dropdown.style.display = 'block';
                    return;
                }
                
                dropdown.innerHTML = filtered.map(product => `
                    <div class="product-dropdown-item" 
                         onclick="appController.selectProductForSale('${product.id}', '${product.name}', ${product.price}, ${product.quantity})"
                         style="padding: 0.75rem; cursor: pointer; border-bottom: 1px solid #eee; transition: background 0.2s;"
                         onmouseover="this.style.background='#f8f9fa'"
                         onmouseout="this.style.background='white'">
                        <div><strong>${product.name}</strong> <span style="color: #666;">(${product.category})</span></div>
                        <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">
                            Stock: ${product.quantity} | Price: ${Utils.formatCurrency(product.price)}
                        </div>
                    </div>
                `).join('');
                
                dropdown.style.display = 'block';
            }
            
            selectProductForSale(productId, productName, price, stock) {
                const product = state.allProducts.find(p => p.id === productId);
                if (!product) return;
                
                // Set hidden input
                document.getElementById('sale-product').value = productName;
                
                // Update search input
                document.getElementById('sale-product-search').value = productName;
                
                // Update price
                document.getElementById('sale-price').value = price;
                
                // Show product info
                document.getElementById('selected-product-name').textContent = productName;
                document.getElementById('selected-product-stock').textContent = stock;
                document.getElementById('selected-product-price').textContent = Utils.formatCurrency(price);
                document.getElementById('sale-product-info').style.display = 'block';
                
                // Hide dropdown
                document.getElementById('sale-product-dropdown').style.display = 'none';
                
                // Update total preview
                this.updateSaleTotalPreview();
            }

            openBulkPurchaseModal() {
                document.getElementById('bulk-sale-date').valueAsDate = new Date();
                document.getElementById('bulk-sale-customer').value = '';
                document.getElementById('bulk-sale-discount').value = '0';
                document.getElementById('bulk-sale-tax').value = '0';
                document.getElementById('bulk-products-container').innerHTML = '';
                
                // Add first product row
                this.addBulkProductRow();
                
                document.getElementById('bulk-sale-modal').style.display = 'block';
            }
            
            addBulkProductRow() {
                const container = document.getElementById('bulk-products-container');
                if (!container) return;
                
                const rowIndex = container.children.length;
                
                const row = document.createElement('div');
                row.className = 'bulk-product-row';
                row.dataset.rowIndex = rowIndex;
                
                row.innerHTML = `
                    <div style="position: relative;">
                        <input type="text" 
                               id="bulk-product-search-${rowIndex}" 
                               placeholder="🔍 Search product..." 
                               autocomplete="off"
                               class="bulk-product-search">
                        <div id="bulk-product-dropdown-${rowIndex}" class="bulk-product-search-dropdown" style="display: none;"></div>
                        <input type="hidden" id="bulk-product-id-${rowIndex}" required>
                    </div>
                    <input type="number" 
                           id="bulk-product-quantity-${rowIndex}" 
                           placeholder="Quantity" 
                           min="1" 
                           required>
                    <input type="number" 
                           id="bulk-product-price-${rowIndex}" 
                           placeholder="Price" 
                           step="0.01" 
                           required 
                           readonly>
                    <input type="text" 
                           id="bulk-product-total-${rowIndex}" 
                           placeholder="Total" 
                           readonly 
                           style="background: #e9ecef;">
                    <button type="button" class="danger" onclick="appController.removeBulkProductRow(${rowIndex})">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
                
                container.appendChild(row);
                
                // Add event listeners for this row
                const searchInput = document.getElementById(`bulk-product-search-${rowIndex}`);
                const quantityInput = document.getElementById(`bulk-product-quantity-${rowIndex}`);
                
                if (searchInput) {
                    searchInput.addEventListener('input', Utils.debounce((e) => {
                        this.searchBulkProducts(e.target.value, rowIndex);
                    }, 300));
                    
                    searchInput.addEventListener('focus', (e) => {
                        this.searchBulkProducts(e.target.value, rowIndex);
                    });
                    
                    // Close dropdown when clicking outside
                    document.addEventListener('click', (e) => {
                        const dropdown = document.getElementById(`bulk-product-dropdown-${rowIndex}`);
                        if (dropdown && !searchInput.contains(e.target) && !dropdown.contains(e.target)) {
                            dropdown.style.display = 'none';
                        }
                    });
                }
                
                if (quantityInput) {
                    quantityInput.addEventListener('input', () => {
                        this.updateBulkProductRowTotal(rowIndex);
                    });
                }
            }
            
            removeBulkProductRow(rowIndex) {
                const row = document.querySelector(`[data-row-index="${rowIndex}"]`);
                if (row) {
                    row.remove();
                    this.updateBulkSaleTotal();
                }
            }
            
            searchBulkProducts(query, rowIndex) {
                const dropdown = document.getElementById(`bulk-product-dropdown-${rowIndex}`);
                if (!dropdown) return;
                
                const searchQuery = String(query || '').toLowerCase().trim();
                const availableProducts = state.allProducts.filter(p => p.quantity > 0);
                
                let filtered = availableProducts;
                if (searchQuery) {
                    filtered = availableProducts.filter(p => {
                        const name = String(p.name || '').toLowerCase();
                        const category = String(p.category || '').toLowerCase();
                        const barcode = String(p.barcode || '').toLowerCase();
                        return (
                            name.includes(searchQuery) ||
                            category.includes(searchQuery) ||
                            barcode.includes(searchQuery)
                        );
                    });
                }
                
                if (filtered.length === 0) {
                    dropdown.innerHTML = '<div style="padding: 0.75rem; color: #666; text-align: center;">No products found</div>';
                    dropdown.style.display = 'block';
                    return;
                }
                
                dropdown.innerHTML = filtered.map(product => `
                    <div class="bulk-product-search-item" 
                         onclick="appController.selectBulkProduct('${product.id}', '${product.name}', ${product.price}, ${product.quantity}, ${rowIndex})">
                        <div><strong>${product.name}</strong> <span style="color: #666;">(${product.category})</span></div>
                        <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">
                            Stock: ${product.quantity} | Price: ${Utils.formatCurrency(product.price)}
                        </div>
                    </div>
                `).join('');
                
                dropdown.style.display = 'block';
            }
            
            selectBulkProduct(productId, productName, price, stock, rowIndex) {
                const product = state.allProducts.find(p => p.id === productId);
                if (!product) return;
                
                // Set values
                document.getElementById(`bulk-product-id-${rowIndex}`).value = productId;
                document.getElementById(`bulk-product-search-${rowIndex}`).value = productName;
                document.getElementById(`bulk-product-price-${rowIndex}`).value = price;
                
                // Set default quantity to 1
                const quantityInput = document.getElementById(`bulk-product-quantity-${rowIndex}`);
                if (quantityInput && !quantityInput.value) {
                    quantityInput.value = '1';
                }
                
                // Hide dropdown
                document.getElementById(`bulk-product-dropdown-${rowIndex}`).style.display = 'none';
                
                // Update totals
                this.updateBulkProductRowTotal(rowIndex);
            }
            
            updateBulkProductRowTotal(rowIndex) {
                const quantity = parseFloat(document.getElementById(`bulk-product-quantity-${rowIndex}`)?.value) || 0;
                const price = parseFloat(document.getElementById(`bulk-product-price-${rowIndex}`)?.value) || 0;
                const total = quantity * price;
                
                const totalInput = document.getElementById(`bulk-product-total-${rowIndex}`);
                if (totalInput) {
                    totalInput.value = Utils.formatCurrency(total);
                }
                
                this.updateBulkSaleTotal();
            }
            
            updateBulkSaleTotal() {
                const container = document.getElementById('bulk-products-container');
                if (!container) return;
                
                let subtotal = 0;
                
                // Calculate subtotal from all rows
                Array.from(container.children).forEach(row => {
                    const rowIndex = row.dataset.rowIndex;
                    const quantity = parseFloat(document.getElementById(`bulk-product-quantity-${rowIndex}`)?.value) || 0;
                    const price = parseFloat(document.getElementById(`bulk-product-price-${rowIndex}`)?.value) || 0;
                    subtotal += quantity * price;
                });
                
                const discount = parseFloat(document.getElementById('bulk-sale-discount')?.value) || 0;
                const tax = parseFloat(document.getElementById('bulk-sale-tax')?.value) || 0;
                
                const discountAmount = subtotal * (discount / 100);
                const subtotalAfterDiscount = subtotal - discountAmount;
                const taxAmount = subtotalAfterDiscount * (tax / 100);
                const total = subtotalAfterDiscount + taxAmount;
                
                // Update display
                document.getElementById('bulk-subtotal').textContent = Utils.formatCurrency(subtotal);
                document.getElementById('bulk-discount-amount').textContent = Utils.formatCurrency(discountAmount);
                document.getElementById('bulk-tax-amount').textContent = Utils.formatCurrency(taxAmount);
                document.getElementById('bulk-total').textContent = Utils.formatCurrency(total);
            }

            // ============================================
            // METHOD: getDataPaths
            // Location: Add after getParentAdminId method
            // Purpose: Get correct Firestore paths for current user role
            // ============================================
            getDataPaths() {
                if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                    const outlet = state.allOutlets[0];
                    
                    if (!outlet || !outlet.createdBy) {
                        console.error('❌ Cannot get paths: outlet not loaded or missing parentAdminId');
                        return null;
                    }
                    
                    const parentAdminId = outlet.createdBy;
                    const outletId = state.assignedOutlet;
                    
                    return {
                        userId: parentAdminId,
                        outletId: outletId,
                        inventory: collection(db, 'users', parentAdminId, 'outlets', outletId, 'outlet_inventory'),
                        sales: collection(db, 'users', parentAdminId, 'outlets', outletId, 'outlet_sales'),
                        isOutletManager: true
                    };
                } else {
                    // Admin
                    return {
                        userId: state.currentUser.uid,
                        outletId: null,
                        inventory: collection(db, 'inventory'),
                        sales: collection(db, 'sales'),
                        isOutletManager: false
                    };
                }
            }
            
            async handleBulkSale(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const container = document.getElementById('bulk-products-container');
                    if (!container || container.children.length === 0) {
                        Utils.showToast('Please add at least one product', 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const customer = document.getElementById('bulk-sale-customer').value;
                    const date = document.getElementById('bulk-sale-date').value;
                    const discount = parseFloat(document.getElementById('bulk-sale-discount').value) || 0;
                    const tax = parseFloat(document.getElementById('bulk-sale-tax').value) || 0;
                    
                    const products = [];
                    let hasError = false;
                    
                    // Collect all products
                    Array.from(container.children).forEach(row => {
                        const rowIndex = row.dataset.rowIndex;
                        const productId = document.getElementById(`bulk-product-id-${rowIndex}`)?.value;
                        const quantity = parseInt(document.getElementById(`bulk-product-quantity-${rowIndex}`)?.value) || 0;
                        const price = parseFloat(document.getElementById(`bulk-product-price-${rowIndex}`)?.value) || 0;
                        
                        if (!productId || quantity <= 0) {
                            hasError = true;
                            return;
                        }
                        
                        const product = state.allProducts.find(p => p.id === productId);
                        if (!product) {
                            Utils.showToast(`Product not found in row ${parseInt(rowIndex) + 1}`, 'error');
                            hasError = true;
                            return;
                        }
                        
                        if (product.quantity < quantity) {
                            Utils.showToast(`Insufficient stock for ${product.name}. Available: ${product.quantity}`, 'warning');
                            hasError = true;
                            return;
                        }
                        
                        products.push({
                            id: productId,
                            name: product.name,
                            quantity: quantity,
                            price: price,
                            cost: product.cost
                        });
                    });
                    
                    if (hasError) {
                        Utils.hideSpinner();
                        return;
                    }
                    
                    // ⭐ Get correct paths based on user role
                    const paths = this.getDataPaths();
                    if (!paths) {
                        Utils.showToast('Configuration error: Cannot determine data paths', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    console.log('Creating bulk sale with paths:', paths);
                    
                    // Create individual sales for each product
                    const batch = writeBatch(db);
                    
                    for (const product of products) {
                        const saleData = {
                            date: date,
                            customer: customer,
                            product: product.name,
                            quantity: product.quantity,
                            price: product.price,
                            cost: product.cost,
                            discount: discount,
                            tax: tax,
                            isBulkPurchase: true,
                            createdAt: new Date().toISOString(),
                            createdBy: state.currentUser.email
                        };
                        
                        // ⭐ Add sale to correct location
                        const saleRef = doc(paths.sales);
                        batch.set(saleRef, saleData);
                        
                        // ⭐ Update product quantity in correct location
                        const productRef = doc(paths.inventory, product.id);
                        const productDoc = state.allProducts.find(p => p.id === product.id);
                        batch.update(productRef, {
                            quantity: productDoc.quantity - product.quantity,
                            lastSold: new Date().toISOString()
                        });
                    }
                    
                    await batch.commit();
                    
                    await ActivityLogger.log('Bulk Purchase', `Bulk purchase for ${customer}: ${products.length} products`);
                    
                    Utils.showToast(`Bulk purchase recorded successfully (${products.length} products)`, 'success');
                    document.getElementById('bulk-sale-modal').style.display = 'none';
                    document.getElementById('bulk-sale-form').reset();
                    
                    await dataLoader.loadAll();
                    this.markSectionsDirty(['sales', 'inventory', 'dashboard']);
                    this._refreshCurrentSectionIfDirty();
                } catch (error) {
                    console.error('❌ Error in bulk sale:', error);
                    Utils.showToast('Failed to record bulk purchase: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            updateSaleTotalPreview() {
                const quantity = parseFloat(document.getElementById('sale-quantity')?.value) || 0;
                const price = parseFloat(document.getElementById('sale-price')?.value) || 0;
                const discount = parseFloat(document.getElementById('sale-discount')?.value) || 0;
                const tax = parseFloat(document.getElementById('sale-tax')?.value) || 0;
                
                const subtotal = quantity * price;
                const discounted = subtotal * (1 - discount / 100);
                const total = discounted * (1 + tax / 100);
                
                const preview = document.getElementById('sale-total-preview');
                if (preview) {
                    preview.textContent = Utils.formatCurrency(total);
                }
            }

            // Backwards-compatible alias used by barcode scanner and older code
            updateSaleTotal() {
                this.updateSaleTotalPreview();
            }

            updateEditSaleTotalPreview() {
                const quantity = parseFloat(document.getElementById('edit-sale-quantity')?.value) || 0;
                const price = parseFloat(document.getElementById('edit-sale-price')?.value) || 0;
                const discount = parseFloat(document.getElementById('edit-sale-discount')?.value) || 0;
                const tax = parseFloat(document.getElementById('edit-sale-tax')?.value) || 0;
                
                const subtotal = quantity * price;
                const discounted = subtotal * (1 - discount / 100);
                const total = discounted * (1 + tax / 100);
                
                const preview = document.getElementById('edit-sale-total-preview');
                if (preview) {
                    preview.textContent = Utils.formatCurrency(total);
                }
            }


            async handleAddSale(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const productName = document.getElementById('sale-product').value;
                    const quantity = parseInt(document.getElementById('sale-quantity').value);
                    const price = parseFloat(document.getElementById('sale-price').value);
                    const customer = document.getElementById('sale-customer').value;
                    const date = document.getElementById('sale-date').value;
                    const discount = parseFloat(document.getElementById('sale-discount').value) || 0;
                    const tax = parseFloat(document.getElementById('sale-tax').value) || 0;
                    
                    // Get location (main or outlet)
                    let location = 'main';
                    const locationSelect = document.getElementById('sale-location');
                    if (locationSelect && locationSelect.style.display !== 'none') {
                        location = locationSelect.value;
                    }
                    
                    // For outlet managers, use their assigned outlet
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        location = state.assignedOutlet;
                        console.log("Outlet Sale Location: ", location)
                    }
                    
                    console.log('Recording sale at location:', location);
                    
                    if (!productName || !quantity || !price) {
                        Utils.showToast('Please fill in all required fields', 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    

                    // Find product and determine inventory/sales collection
                    let product;
                    let inventoryRef;
                    let salesCollection;
                    
                    if (location === 'main') {
                        // Main shop sale
                        product = state.allProducts.find(p => p.name === productName);
                        if (!product) {
                            Utils.showToast('Product not found', 'error');
                            Utils.hideSpinner();
                            return;
                        }
                        inventoryRef = doc(db, 'inventory', product.id);
                        salesCollection = collection(db, 'sales');
                    } else {
                        const outlet = state.allOutlets.find(o => o.id === location);
                        const parentAdminId = outlet.createdBy;
                        // Outlet sale
                        const outletInventoryRef = collection(db, 'users', parentAdminId, 'outlets', location, 'outlet_inventory');
                        const outletInventorySnap = await getDocs(outletInventoryRef);
                        //console.log("Outlet Inventory: ", outletInventorySnap)
                        console.log("Current User: ", outletInventorySnap)
                        console.log("Parent Admin: ", outlet.createdBy)
                        // Find product in outlet inventory
                        let foundProduct = null;
                        outletInventorySnap.forEach(doc => {
                            const data = doc.data();
                            if (data.name === productName) {
                                foundProduct = { id: doc.id, ...data };
                            }
                        });

                        console.log("Found Products: ", foundProduct)
                        
                        if (!foundProduct) {
                            Utils.showToast('Product not found in outlet inventory', 'error');
                            Utils.hideSpinner();
                            return;
                        }
                        
                        product = foundProduct;
                        inventoryRef = doc(db, 'users', parentAdminId, 'outlets', location, 'outlet_inventory', product.id);
                        salesCollection = collection(db, 'users', parentAdminId, 'outlets', location, 'outlet_sales');
                    }
                    
                    if (product.quantity < quantity) {
                        Utils.showToast(`Insufficient stock. Available: ${product.quantity}`, 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const saleData = {
                        date: date,
                        product: productName,
                        quantity: quantity,
                        price: price,
                        customer: customer,
                        discount: discount,
                        tax: tax,
                        location: location,
                        locationName: location === 'main' ? 'Main Shop' : state.allOutlets.find(o => o.id === location)?.name,
                        createdAt: new Date().toISOString(),
                        createdBy: state.currentUser.email
                    };
                    
                    console.log('Sale data:', saleData);
                    
                    const batch = writeBatch(db);
                    
                    // Add sale
                    const saleRef = doc(salesCollection);
                    batch.set(saleRef, saleData);
                    
                    // Update inventory
                    batch.update(inventoryRef, {
                        quantity: product.quantity - quantity,
                        lastSold: new Date().toISOString()
                    });
                    
                    await batch.commit();
                    
                    await ActivityLogger.log('Sale Recorded', `Sale: ${quantity} x ${productName} to ${customer} at ${saleData.locationName}`);
                    
                    Utils.showToast('Sale recorded successfully', 'success');
                    document.getElementById('add-sale-modal').style.display = 'none';
                    document.getElementById('add-sale-form').reset();
                    
                    await dataLoader.loadProducts();
                    await dataLoader.loadSales();
                    await dataLoader.loadOutlets();
                    this.markSectionsDirty(['sales', 'inventory', 'dashboard']);
                    this._refreshCurrentSectionIfDirty();
                    
                } catch (error) {
                    console.error('Error recording sale:', error);
                    Utils.showToast('Failed to record sale: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async handleEditSale(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const saleId = document.getElementById('edit-sale-id').value;
                    const oldSale = state.allSales.find(s => s.id === saleId);
                    
                    if (!oldSale) {
                        Utils.showToast('Sale not found', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const productName = document.getElementById('edit-sale-product').value;
                    const newQuantity = parseInt(document.getElementById('edit-sale-quantity').value);
                    
                    const product = state.allProducts.find(p => p.name === productName);
                    if (!product) {
                        Utils.showToast('Product not found', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const quantityDifference = newQuantity - oldSale.quantity;
                    
                    if (quantityDifference > 0 && product.quantity < quantityDifference) {
                        Utils.showToast(`Insufficient stock. Available: ${product.quantity}`, 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    // ⭐ Get correct paths based on user role
                    const paths = this.getDataPaths();
                    if (!paths) {
                        Utils.showToast('Configuration error: Cannot determine data paths', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    console.log('Editing sale with paths:', paths);
                    
                    const saleData = {
                        date: document.getElementById('edit-sale-date').value,
                        customer: document.getElementById('edit-sale-customer').value,
                        product: productName,
                        quantity: newQuantity,
                        price: parseFloat(document.getElementById('edit-sale-price').value),
                        discount: parseFloat(document.getElementById('edit-sale-discount').value) || 0,
                        tax: parseFloat(document.getElementById('edit-sale-tax').value) || 0,
                        updatedAt: new Date().toISOString(),
                        updatedBy: state.currentUser.email
                    };
                    
                    // ⭐ Update sale in correct location
                    await updateDoc(doc(paths.sales, saleId), saleData);
                    
                    // ⭐ Update product quantity in correct location
                    const productDoc = doc(paths.inventory, product.id);
                    await updateDoc(productDoc, {
                        quantity: product.quantity - quantityDifference,
                        lastUpdated: new Date().toISOString()
                    });
                    
                    await ActivityLogger.log('Sale Updated', `Updated sale: ${saleData.customer} - ${productName}`);
                    
                    Utils.showToast('Sale updated successfully', 'success');
                    document.getElementById('edit-sale-modal').style.display = 'none';
                    
                    // Reload data
                    await dataLoader.loadAll();
                    this.markSectionsDirty(['sales', 'inventory', 'dashboard']);
                    this._refreshCurrentSectionIfDirty();
                    
                } catch (error) {
                    console.error('❌ Error editing sale:', error);
                    Utils.showToast('Failed to update sale: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            editSale(saleId) {
                if (state.userRole !== 'admin') {
                    metricsService.emit('access_denied', { resource: 'action', resource_name: 'editSale', actor_role: state.userRole });
                    Utils.showToast('Access restricted to administrators', 'warning');
                    return;
                }
                const sale = state.allSales.find(s => s.id === saleId);
                if (!sale) return;
                
                this.populateSaleProductDropdown();
                
                document.getElementById('edit-sale-id').value = sale.id;
                document.getElementById('edit-sale-date').value = sale.date;
                document.getElementById('edit-sale-customer').value = sale.customer;
                document.getElementById('edit-sale-product').value = sale.product;
                document.getElementById('edit-sale-quantity').value = sale.quantity;
                document.getElementById('edit-sale-price').value = sale.price;
                document.getElementById('edit-sale-discount').value = sale.discount || 0;
                document.getElementById('edit-sale-tax').value = sale.tax || 0;
                
                this.updateEditSaleTotalPreview();
                document.getElementById('edit-sale-modal').style.display = 'block';
            }

            async deleteSale(saleId) {
                if (state.userRole !== 'admin') {
                    metricsService.emit('access_denied', { resource: 'action', resource_name: 'deleteSale', actor_role: state.userRole });
                    Utils.showToast('Access restricted to administrators', 'warning');
                    return;
                }
                if (!confirm('Delete this sale? This will restore the product quantity.')) return;

                Utils.showSpinner();
                
                try {
                    const sale = state.allSales.find(s => s.id === saleId);
                    if (!sale) {
                        Utils.showToast('Sale not found', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    // ⭐ Get correct paths based on user role
                    const paths = this.getDataPaths();
                    if (!paths) {
                        Utils.showToast('Configuration error: Cannot determine data paths', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const product = state.allProducts.find(p => p.name === sale.product);
                    
                    if (product) {
                        // ⭐ Restore quantity in correct location
                        const productDoc = doc(paths.inventory, product.id);
                        await updateDoc(productDoc, {
                            quantity: product.quantity + sale.quantity,
                            lastUpdated: new Date().toISOString()
                        });
                    }
                    
                    // ⭐ Delete sale from correct location
                    await deleteDoc(doc(paths.sales, saleId));
                    
                    await ActivityLogger.log('Sale Deleted', `Deleted sale: ${sale.customer} - ${sale.product}`);
                    
                    Utils.showToast('Sale deleted and stock restored', 'success');
                    
                    // Reload data
                    await dataLoader.loadAll();
                    this.markSectionsDirty(['sales', 'inventory', 'dashboard']);
                    this._refreshCurrentSectionIfDirty();
                    
                } catch (error) {
                    console.error('❌ Error deleting sale:', error);
                    Utils.showToast('Failed to delete sale: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }
            renderAnalytics() {
                console.log('=== RENDERING ANALYTICS ===');
                console.log('User role:', state.userRole);
                
                const period = document.getElementById('analytics-period-filter')?.value || 'all';
                const { start, end } = Utils.getDateRange(period);
                
                const filteredSales = state.allSales.filter(s => s.date >= start && s.date <= end);
                const filteredExpenses = state.allExpenses.filter(e => e.date >= start && e.date <= end);
                
                // ═══════════════════════════════════════════════════════════
                // RENDER ROLE-SPECIFIC CHARTS
                // ═══════════════════════════════════════════════════════════
                
                if (state.userRole === 'outlet_manager') {
                    // ═══════════════════════════════════════════════════════════
                    // OUTLET MANAGER: Show outlet-specific analytics
                    // ═══════════════════════════════════════════════════════════
                    // Hide expense-related charts
                    const expenseChartContainer = document.getElementById('expenses-breakdown-chart');
                    if (expenseChartContainer) {
                        expenseChartContainer.closest('.analytics-card')?.style.setProperty('display', 'none', 'important');
                    }

                    this.renderDailyRevenueChart();
                    this.renderProfitAnalysisChart();
                    this.renderTopCategoriesChart();
                    this.renderMonthlyComparisonChart();
                    
                } else {
                    // ═══════════════════════════════════════════════════════════
                    // ADMIN: Show all analytics including expenses
                    // ═══════════════════════════════════════════════════════════
                    console.log('Rendering admin analytics');
                    
                    // Show all charts
                    const expenseChartContainer = document.getElementById('expenses-breakdown-chart');
                    if (expenseChartContainer) {
                        expenseChartContainer.closest('.analytics-card')?.style.removeProperty('display');
                    }

                    this.renderDailyRevenueChart();
                    this.renderProfitAnalysisChart();
                    this.renderTopCategoriesChart();
                    this.renderMonthlyComparisonChart();
                    this.renderExpensesBreakdownChart();
                    
                }
                
                console.log('✅ Analytics rendered successfully');
            }

            renderSales(keepPage = false) {
                const container = document.getElementById('sales-list');
                if (!container) return;
                
                if (!keepPage) container.dataset.salesPage = '0';
                
                const dateFilter = document.getElementById('sales-date-filter')?.value || 'all';
                const customerSearch = (document.getElementById('sales-customer-search')?.value || '').toString().toLowerCase();
                const productSearch = (document.getElementById('sales-product-search-table')?.value || '').toString().toLowerCase();
                
                let filteredSales = Array.isArray(state.allSales) ? [...state.allSales] : [];
                
                if (dateFilter !== 'all') {
                    const { start, end } = Utils.getDateRange(dateFilter === 'today' ? 'day' : dateFilter);
                    filteredSales = filteredSales.filter(s => {
                        const d = this.getDatePeriod(s, 'date', 10);
                        return d && d >= start && d <= end;
                    });
                }
                
                if (customerSearch) {
                    filteredSales = filteredSales.filter(s => {
                        const customer = (s.customer || '').toString().toLowerCase();
                        return customer.includes(customerSearch);
                    });
                }
                
                if (productSearch) {
                    filteredSales = filteredSales.filter(s => {
                        const product = (s.product || '').toString().toLowerCase();
                        return product.includes(productSearch);
                    });
                }
                
                const grouped = {};
                filteredSales.forEach(sale => {
                    const dateKey = this.getDatePeriod(sale, 'date', 10) || (sale.date || 'Unknown date');
                    if (!grouped[dateKey]) grouped[dateKey] = [];
                    grouped[dateKey].push(sale);
                });
                
                const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
                const totalGroups = sortedDates.length;
                
                if (totalGroups === 0) {
                    container.innerHTML = '<div class="no-data">No sales found</div>';
                    return;
                }
                
                const GROUPS_PER_PAGE = window.innerWidth <= 767 ? 8 : 15;
                const page = parseInt(container.dataset.salesPage || '0', 10);
                const endIdx = Math.min((page + 1) * GROUPS_PER_PAGE, totalGroups);
                const datesToRender = sortedDates.slice(0, endIdx);
                
                const productMap = new Map((state.allProducts || []).map(p => [p.name, p]));
                
                const fragment = document.createDocumentFragment();
                
                datesToRender.forEach((date, idx) => {
                    const sales = grouped[date];
                    let dailyRevenue = 0;
                    let dailyCost = 0;
                    
                    sales.forEach(sale => {
                        const qty = parseFloat(sale.quantity) || 0;
                        const price = parseFloat(sale.price) || 0;
                        const discount = parseFloat(sale.discount) || 0;
                        const tax = parseFloat(sale.tax) || 0;
                        const subtotal = qty * price;
                        const discounted = subtotal * (1 - discount / 100);
                        dailyRevenue += discounted * (1 + tax / 100);

                        // Prefer sale-time cost snapshot; fall back to current product cost
                        const saleCostPerUnit = parseFloat(sale.cost);
                        if (!Number.isNaN(saleCostPerUnit) && saleCostPerUnit > 0) {
                            dailyCost += qty * saleCostPerUnit;
                        } else {
                            const product = productMap.get(sale.product);
                            if (product) {
                                const productCost = parseFloat(product.cost) || 0;
                                dailyCost += qty * productCost;
                            }
                        }
                    });
                    
                    const dailyProfit = dailyRevenue - dailyCost;
                    const safeId = (id) => (id || '').toString().replace(/'/g, "\\'");
                    
                    const safeDate = (date || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const group = document.createElement('div');
                    group.className = 'sales-group';
                    group.innerHTML = `
                        <div class="sales-group-header" onclick="this.classList.toggle('collapsed'); this.nextElementSibling.classList.toggle('collapsed');">
                            <div>
                                <strong>${date}</strong> 
                                <span style="color:#666;">(${sales.length} sale${sales.length !== 1 ? 's' : ''})</span>
                                <br>
                                <small>
                                    Revenue: <strong>${Utils.formatCurrency(dailyRevenue)}</strong> | 
                                    Profit: <strong style="color:${dailyProfit >= 0 ? 'green' : 'red'};">
                                        ${Utils.formatCurrency(dailyProfit)}
                                    </strong>
                                </small>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <button type="button" class="btn-sm" onclick="event.stopPropagation(); appController.printSalesForDate('${safeDate}')" title="Print receipts for this date">
                                    <i class="fas fa-print"></i> Print receipts
                                </button>
                                <i class="fas fa-chevron-down toggle-icon"></i>
                            </div>
                        </div>
                        <div class="sales-group-content${idx === 0 ? '' : ' collapsed'}">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Customer</th>
                                        <th>Product</th>
                                        <th>Qty</th>
                                        <th>Price</th>
                                        <th>Total</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${sales.map(sale => {
                                        const total = getSaleTotal(sale);
                                        const sid = safeId(sale.id);
                                        const adminActions = state.userRole === 'admin' ? `
                                                    <button onclick="appController.editSale('${sid}')" title="Edit"><i class="fas fa-edit"></i></button>
                                                    <button class="danger" onclick="appController.deleteSale('${sid}')" title="Delete"><i class="fas fa-trash"></i></button>
                                        ` : '';
                                        return `
                                            <tr>
                                                <td>${(sale.customer || '').toString().replace(/</g, '&lt;')}</td>
                                                <td>${(sale.product || '').toString().replace(/</g, '&lt;')}</td>
                                                <td>${parseFloat(sale.quantity) || 0}</td>
                                                <td>${Utils.formatCurrency(parseFloat(sale.price) || 0)}</td>
                                                <td>${Utils.formatCurrency(total)}</td>
                                                <td class="actions">
                                                    <button onclick="appController.showReturnModal('${sid}')" title="Return"><i class="fas fa-undo"></i></button>
                                                    ${adminActions}
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                    fragment.appendChild(group);
                });
                
                container.innerHTML = '';
                container.appendChild(fragment);
                
                if (endIdx < totalGroups) {
                    const loadMore = document.createElement('button');
                    loadMore.className = 'btn load-more-sales';
                    loadMore.textContent = `Load more (${totalGroups - endIdx} dates remaining)`;
                    loadMore.style.marginTop = '1rem';
                    loadMore.style.width = '100%';
                    loadMore.onclick = () => {
                        container.dataset.salesPage = String(parseInt(container.dataset.salesPage || '0', 10) + 1);
                        this.renderSales(true);
                    };
                    container.appendChild(loadMore);
                }
            }
            async handleAddExpense(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    if (window.formValidator) {
                        const validation = window.formValidator.validateExpenseForm({
                            description: document.getElementById('expense-description')?.value,
                            amount: document.getElementById('expense-amount')?.value,
                            category: document.getElementById('expense-category')?.value,
                            date: document.getElementById('expense-date')?.value
                        });
                        if (!validation.isValid) {
                            Utils.showToast(validation.errors[0], 'error');
                            return;
                        }
                    }

                    const expenseData = {
                        date: document.getElementById('expense-date').value,
                        description: document.getElementById('expense-description').value,
                        category: document.getElementById('expense-category').value,
                        amount: parseFloat(document.getElementById('expense-amount').value),
                        createdAt: new Date().toISOString()
                    };

                    const guard = validateExpenseWrite(expenseData);
                    if (!guard.ok) { Utils.showToast(guard.error, 'warning'); Utils.hideSpinner(); return; }

                    // Determine where to save based on user role and selection
                    if (state.userRole === 'outlet_manager') {
                        // Outlet manager - save to outlet_expenses
                        expenseData.outletId = state.assignedOutlet;
                        const outlet = state.allOutlets.find(o => o.id === state.assignedOutlet);
                        expenseData.outletName = outlet?.name || 'Unknown Outlet';
                        expenseData.expenseType = 'outlet';
                        
                        await addDoc(
                            firebaseService.getOutletSubCollection(state.assignedOutlet, 'outlet_expenses'),
                            expenseData
                        );
                        await ActivityLogger.log('Expense Added', `Added outlet expense: ${expenseData.description}`);
                    } else if (state.userRole === 'admin') {
                        // Admin - check if outlet-specific or main
                        const selectedOutlet = document.getElementById('expense-outlet')?.value;
                        
                        if (selectedOutlet && selectedOutlet !== 'main') {
                            // Save to outlet_expenses
                            expenseData.outletId = selectedOutlet;
                            const outlet = state.allOutlets.find(o => o.id === selectedOutlet);
                            expenseData.outletName = outlet?.name || 'Unknown Outlet';
                            expenseData.expenseType = 'outlet';
                            
                            await addDoc(
                                firebaseService.getOutletSubCollection(selectedOutlet, 'outlet_expenses'),
                                expenseData
                            );
                            await ActivityLogger.log('Expense Added', `Added outlet expense for ${expenseData.outletName}: ${expenseData.description}`);
                        } else {
                            // Save to main expenses
                            expenseData.expenseType = 'main';
                            await addDoc(firebaseService.getUserCollection('expenses'), expenseData);
                            await ActivityLogger.log('Expense Added', `Added main expense: ${expenseData.description}`);
                        }
                    }
                    
                    Utils.showToast('Expense added successfully', 'success');
                    document.getElementById('add-expense-modal').style.display = 'none';
                    document.getElementById('add-expense-form').reset();
                } catch (error) {
                    console.error('Error adding expense:', error);
                    Utils.showToast('Failed to add expense: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async deleteExpense(expenseId) {
                if (!confirm('Are you sure you want to delete this expense?')) return;
                
                Utils.showSpinner();
                try {
                    const expense = state.allExpenses.find(e => e.id === expenseId);
                    
                    // Delete from correct collection based on expense type
                    if (expense && expense.outletId) {
                        // Outlet expense
                        await deleteDoc(doc(firebaseService.getOutletSubCollection(expense.outletId, 'outlet_expenses'), expenseId));
                        await ActivityLogger.log('Expense Deleted', `Deleted outlet expense: ${expense.description || 'Unknown'}`);
                    } else {
                        // Main expense
                        await deleteDoc(doc(firebaseService.getUserCollection('expenses'), expenseId));
                        await ActivityLogger.log('Expense Deleted', `Deleted expense: ${expense?.description || 'Unknown'}`);
                    }
                    
                    Utils.showToast('Expense deleted successfully', 'success');
                } catch (error) {
                    console.error('Delete expense error:', error);
                    Utils.showToast('Failed to delete expense: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            /** Render expenses with basic pagination; table is vertically scrollable via CSS. */
            renderExpenses(append = false) {
                const table = document.getElementById('expenses-table');
                const tbody = table?.querySelector('tbody');
                if (!table || !tbody) return;
                
                const card = table.closest('.card');
                // Remove existing "load more" button
                const existingLoadMore = card?.querySelector('.load-more-expenses');
                if (existingLoadMore) existingLoadMore.remove();
                
                const EXPENSES_PER_PAGE = 25;
                let currentPage = parseInt(table.dataset.expensesPage || '0', 10);
                if (!append) currentPage = 0;
                
                const dateFilter = document.getElementById('expense-date-filter')?.value || 'all';
                const search = document.getElementById('expense-search')?.value.toLowerCase() || '';
                
                let filtered = [...state.allExpenses];
                
                if (dateFilter !== 'all') {
                    const { start, end } = Utils.getDateRange(dateFilter === 'today' ? 'day' : dateFilter);
                    filtered = filtered.filter(e => e.date >= start && e.date <= end);
                }
                
                if (search) {
                    filtered = filtered.filter(e => 
                        e.description.toLowerCase().includes(search) ||
                        e.category.toLowerCase().includes(search)
                    );
                }
                
                if (filtered.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" class="no-data">No expenses found</td></tr>';
                    table.dataset.expensesPage = '0';
                    return;
                }
                
                const endIdx = Math.min((currentPage + 1) * EXPENSES_PER_PAGE, filtered.length);
                const toRender = filtered.slice(0, endIdx);
                
                // Re-render current slice for simplicity
                tbody.innerHTML = '';
                toRender.forEach(expense => {
                    const row = document.createElement('tr');
                    
                    // Show outlet name if applicable
                    const location = expense.outletName ? 
                        `<span style="font-size: 0.85em; color: #6c757d;">(${expense.outletName})</span>` : 
                        expense.expenseType === 'main' ? 
                        `<span style="font-size: 0.85em; color: #6c757d;">(Main Office)</span>` : '';
                    
                    row.innerHTML = `
                        <td>${expense.date}</td>
                        <td>${expense.description} ${location}</td>
                        <td>${expense.category}</td>
                        <td>${Utils.formatCurrency(expense.amount)}</td>
                        <td class="actions">
                            <button class="danger" onclick="appController.deleteExpense('${expense.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
                
                table.dataset.expensesPage = String(currentPage);
                
                // Add "Load more" button if there are more expenses to show
                if (endIdx < filtered.length && card) {
                    const loadMore = document.createElement('button');
                    loadMore.className = 'btn load-more-expenses';
                    loadMore.textContent = `Load more expenses (${filtered.length - endIdx} remaining)`;
                    loadMore.style.marginTop = '1rem';
                    loadMore.style.width = '100%';
                    loadMore.onclick = () => {
                        table.dataset.expensesPage = String(currentPage + 1);
                        this.renderExpenses(true);
                    };
                    card.appendChild(loadMore);
                }
            }

            // ==================== OUTLET MANAGEMENT FUNCTIONS ====================
            
            populateExpenseOutletSelector() {
                const select = document.getElementById('expense-outlet');
                if (!select) return;
                
                // Keep main office option
                let options = '<option value="main">Main Office</option>';
                
                // Add outlet options
                state.allOutlets.forEach(outlet => {
                    options += `<option value="${outlet.id}">${outlet.name}${outlet.location ? ' - ' + outlet.location : ''}</option>`;
                });
                
                select.innerHTML = options;
            }
            
            populateAdminOutletSelector() {
                const select = document.getElementById('outlet-filter-select');
                if (!select) return;
                
                // Keep default options
                let options = `
                    <option value="all">All Outlets (Consolidated)</option>
                    <option value="main">Main Office</option>
                `;
                
                // Add outlet options
                state.allOutlets.forEach(outlet => {
                    options += `<option value="${outlet.id}">${outlet.name}${outlet.location ? ' - ' + outlet.location : ''}</option>`;
                });
                
                select.innerHTML = options;
                
                // Restore saved selection
                const saved = localStorage.getItem('adminOutletFilter');
                if (saved) {
                    select.value = saved;
                    state.selectedOutletFilter = saved;
                }
            }
            
            async handleOutletFilterChange() {
                const select = document.getElementById('outlet-filter-select');
                if (!select) return;
                
                const selectedOutlet = select.value;
                
                // Save selection
                localStorage.setItem('adminOutletFilter', selectedOutlet);
                state.selectedOutletFilter = selectedOutlet;
                
                console.log('Outlet filter changed to:', selectedOutlet);
                
                // Reload data for selected outlet
                await this.loadDataForSelectedOutlet(selectedOutlet);
            }
            
            async loadDataForSelectedOutlet(outletId) {
                Utils.showSpinner();
                
                try {
                    console.log('Loading data for outlet:', outletId);
                    
                    // Update the selected filter in state
                    state.selectedOutletFilter = outletId;
                    
                    // Reload ALL data based on selection
                    await dataLoader.loadExpenses();
                    
                    await dataLoader.loadSales();
                    await dataLoader.loadProducts();
                    
                    this.markSectionsDirty(['dashboard', 'expenses', 'analytics', 'sales', 'inventory']);
                    this._refreshCurrentSectionIfDirty();
                    Utils.showToast(`Viewing data for: ${this.getOutletDisplayName(outletId)}`, 'success');
                } catch (error) {
                    console.error('Error loading outlet data:', error);
                    Utils.showToast('Failed to load outlet data: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }
            
            getOutletDisplayName(outletId) {
                if (outletId === 'all') return 'All Outlets (Consolidated)';
                if (outletId === 'main') return 'Main Office';
                
                const outlet = state.allOutlets.find(o => o.id === outletId);
                return outlet ? outlet.name : 'Unknown Outlet';
            }

            // ==================== LIABILITIES MANAGEMENT ====================

            async handleAddLiability(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const liabilityData = {
                        type: document.getElementById('liability-type').value,
                        creditor: document.getElementById('liability-creditor').value,
                        description: document.getElementById('liability-description').value,
                        amount: parseFloat(document.getElementById('liability-amount').value),
                        balance: parseFloat(document.getElementById('liability-balance').value),
                        dueDate: document.getElementById('liability-due-date').value,
                        interestRate: parseFloat(document.getElementById('liability-interest').value) || 0,
                        notes: document.getElementById('liability-notes').value,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    liabilityData.status = liabilityData.balance === 0 ? 'paid' : 'active';

                    const guard = validateLiabilityWrite(liabilityData);
                    if (!guard.ok) { Utils.showToast(guard.error, 'error'); Utils.hideSpinner(); return; }

                    await addDoc(firebaseService.getUserCollection('liabilities'), liabilityData);
                    await ActivityLogger.log('Liability Added', `Added liability: ${liabilityData.creditor} - ${Utils.formatCurrency(liabilityData.amount)}`);
                    
                    Utils.showToast('Liability added successfully', 'success');
                    document.getElementById('add-liability-modal').style.display = 'none';
                    document.getElementById('add-liability-form').reset();
                } catch (error) {
                    console.error('Add liability error:', error);
                    Utils.showToast('Failed to add liability: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            openRecordLiabilityPaymentModal(liabilityId) {
                const liability = state.allLiabilities.find(l => l.id === liabilityId);
                if (!liability) {
                    Utils.showToast('Liability not found', 'error');
                    return;
                }
                
                document.getElementById('liability-payment-id').value = liabilityId;
                document.getElementById('liability-payment-creditor').textContent = liability.creditor;
                document.getElementById('liability-payment-balance').textContent = Utils.formatCurrency(liability.balance);
                document.getElementById('liability-payment-date').valueAsDate = new Date();
                document.getElementById('liability-payment-amount').value = '';
                document.getElementById('liability-payment-amount').max = liability.balance;
                
                document.getElementById('record-liability-payment-modal').style.display = 'block';
            }

            async handleRecordLiabilityPayment(e) {
                e.preventDefault();
                Utils.showSpinner();
                const flowStartedAt = Date.now();
                const flowCorrelationId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : `flow_${Date.now()}`;
                
                try {
                    metricsService.emit('flow_started', {
                        flow_name: 'record_liability_payment'
                    }, { correlationId: flowCorrelationId });

                    const liabilityId = document.getElementById('liability-payment-id').value;
                    const paymentAmount = parseFloat(document.getElementById('liability-payment-amount').value);
                    const paymentDate = document.getElementById('liability-payment-date').value;
                    const paymentMethod = document.getElementById('liability-payment-method')?.value || 'Cash';
                    const paymentNotes = document.getElementById('liability-payment-notes')?.value || '';

                    const liability = state.allLiabilities.find(l => l.id === liabilityId);
                    if (!liability) throw new Error('Liability not found');

                    if (paymentAmount <= 0) {
                        throw new Error('Payment amount must be greater than 0');
                    }

                    if (paymentAmount > liability.balance) {
                        throw new Error('Payment amount exceeds balance');
                    }
                    
                    const newBalance = liability.balance - paymentAmount;
                    
                    const batch = writeBatch(db);
                    
                    // 1. Update liability balance
                    const liabilityRef = doc(db, 'liabilities', liabilityId);
                    batch.update(liabilityRef, {
                        balance: newBalance,
                        status: newBalance === 0 ? 'paid' : 'unpaid',
                        lastPaymentDate: paymentDate,
                        lastPaymentAmount: paymentAmount,
                        updatedAt: serverTimestamp()
                    });

                    // Update supplier outstanding balance (if this is A/P)
                    if (liability.type === 'accounts_payable' && liability.supplierId) {
                        const supplierRef = doc(db, 'suppliers', liability.supplierId);
                        const supplierDoc = await getDoc(supplierRef);

                        if (supplierDoc.exists()) {
                            const currentBalance = supplierDoc.data().outstandingBalance || 0;
                            batch.update(supplierRef, {
                                outstandingBalance: Math.max(0, currentBalance - paymentAmount),
                                lastPaymentDate: paymentDate,
                                lastPaymentAmount: paymentAmount,
                                updatedAt: serverTimestamp()
                            });
                        }
                    }

                    // Create payment transaction record
                    const paymentRef = doc(collection(db, 'payment_transactions'));
                    batch.set(paymentRef, {
                        type: 'liability_payment',
                        liabilityId: liabilityId,
                        liabilityType: liability.type,
                        supplierId: liability.supplierId || null,
                        supplierName: liability.supplierName || liability.creditor,
                        creditor: liability.creditor || liability.supplierName || 'Unknown',
                        poId: liability.poId || null,
                        poNumber: liability.poNumber || null,
                        paymentDate: paymentDate,
                        amount: paymentAmount,
                        paymentMethod: paymentMethod,
                        notes: paymentNotes,
                        previousBalance: liability.balance,
                        newBalance: newBalance,
                        createdBy: state.currentUser.uid,
                        createdAt: serverTimestamp()
                    });
                    console.log('✅ Payment transaction record queued');
                    
                    // Debt/liability principal repayments are balance-sheet / financing — not operating expenses.
                    // Cash impact is tracked via payment_transactions (type: liability_payment) only.
                    
                    await batch.commit();
                    
                    await ActivityLogger.log('Payment Recorded', 
                        `Paid ${Utils.formatCurrency(paymentAmount)} to ${liability.creditor || liability.supplierName}`);
                    
                    metricsService.emit('flow_completed', {
                        flow_name: 'record_liability_payment',
                        duration_ms: Date.now() - flowStartedAt,
                        result: 'success'
                    }, { correlationId: flowCorrelationId });

                    Utils.showToast(`Payment of ${Utils.formatCurrency(paymentAmount)} recorded successfully`, 'success');
                    document.getElementById('record-liability-payment-modal').style.display = 'none';
                    document.getElementById('record-liability-payment-form').reset();

                    await Promise.all([
                        dataLoader.loadLiabilities(),
                        dataLoader.loadSuppliers(),
                        dataLoader.loadLiabilityPayments(),
                        dataLoader.loadExpenses()
                    ]);

                    this.markSectionsDirty(['liabilities', 'dashboard', 'accounting']);
                    this.renderLiabilities();
                    this._refreshCurrentSectionIfDirty();
                    
                } catch (error) {
                    console.error('[AppController] handleRecordLiabilityPayment error:', error);
                    metricsService.emit('write_failed', {
                        entity: 'liability_payment',
                        target_collection: 'payment_transactions',
                        duration_ms: Date.now() - flowStartedAt,
                        error_code: error?.code || 'unknown',
                        error_message: error?.message || String(error)
                    }, { correlationId: flowCorrelationId });
                    metricsService.emit('flow_completed', {
                        flow_name: 'record_liability_payment',
                        duration_ms: Date.now() - flowStartedAt,
                        result: 'blocked'
                    }, { correlationId: flowCorrelationId });
                    Utils.showToast('Failed to record payment: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async viewLiabilityDetails(liabilityId) {
                try {
                    const liability = state.allLiabilities.find(l => l.id === liabilityId);
                    if (!liability) {
                        Utils.showToast('Liability not found', 'error');
                        return;
                    }
                    
                    // Fetch payment transactions for this liability (no orderBy to avoid composite index)
                    const paymentsSnapshot = await getDocs(
                        query(
                            collection(db, 'payment_transactions'),
                            where('liabilityId', '==', liabilityId)
                        )
                    );
                    
                    const payments = [];
                    paymentsSnapshot.forEach(doc => {
                        payments.push({id: doc.id, ...doc.data()});
                    });
                    // Sort by payment date descending (newest first)
                    payments.sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));
                    
                    // Build details HTML
                    const creditor = liability.creditor || liability.supplierName || 'Unknown';
                    const detailsHTML = `
                        <div style="background: #f8f9fa; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
                            <h4 style="margin: 0 0 1rem 0;">Liability Details</h4>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                                <div><strong>Creditor:</strong> ${creditor}</div>
                                <div><strong>Type:</strong> ${liability.type}</div>
                                <div><strong>Description:</strong> ${liability.description}</div>
                                <div><strong>Due Date:</strong> ${liability.dueDate}</div>
                                <div><strong>Original Amount:</strong> ${Utils.formatCurrency(liability.amount)}</div>
                                <div><strong>Current Balance:</strong> ${Utils.formatCurrency(liability.balance)}</div>
                                <div><strong>Amount Paid:</strong> ${Utils.formatCurrency(liability.amount - liability.balance)}</div>
                                <div><strong>Status:</strong> ${liability.calculatedStatus}</div>
                            </div>
                            ${liability.poNumber ? `
                                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #dee2e6;">
                                    <strong>Related Purchase Order:</strong> ${liability.poNumber}
                                </div>
                            ` : ''}
                        </div>
                        
                        <h4 style="margin-bottom: 1rem;">Payment History</h4>
                        ${payments.length > 0 ? `
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                                        <th style="padding: 0.75rem; text-align: left;">Date</th>
                                        <th style="padding: 0.75rem; text-align: left;">Amount</th>
                                        <th style="padding: 0.75rem; text-align: left;">Method</th>
                                        <th style="padding: 0.75rem; text-align: left;">Previous Balance</th>
                                        <th style="padding: 0.75rem; text-align: left;">New Balance</th>
                                        <th style="padding: 0.75rem; text-align: left;">Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${payments.map(p => `
                                        <tr style="border-bottom: 1px solid #dee2e6;">
                                            <td style="padding: 0.75rem;">${p.paymentDate}</td>
                                            <td style="padding: 0.75rem;"><strong>${Utils.formatCurrency(p.amount)}</strong></td>
                                            <td style="padding: 0.75rem;">${p.paymentMethod || 'Cash'}</td>
                                            <td style="padding: 0.75rem;">${Utils.formatCurrency(p.previousBalance)}</td>
                                            <td style="padding: 0.75rem;">${Utils.formatCurrency(p.newBalance)}</td>
                                            <td style="padding: 0.75rem;">${p.notes || '-'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                                <tfoot>
                                    <tr style="background: #f8f9fa; font-weight: bold;">
                                        <td style="padding: 0.75rem;">Total Paid:</td>
                                        <td style="padding: 0.75rem;">${Utils.formatCurrency(payments.reduce((sum, p) => sum + p.amount, 0))}</td>
                                        <td colspan="4"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        ` : `
                            <p style="text-align: center; padding: 2rem; color: #6c757d;">
                                No payments recorded yet
                            </p>
                        `}
                    `;
                    
                    // Create modal
                    const modal = document.createElement('div');
                    modal.className = 'modal';
                    modal.style.display = 'block';
                    modal.innerHTML = `
                        <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
                            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                            <h3><i class="fas fa-file-invoice-dollar"></i> Liability & Payment History</h3>
                            ${detailsHTML}
                            <div style="margin-top: 1.5rem;">
                                <button onclick="this.closest('.modal').remove()" style="width: 100%;">Close</button>
                            </div>
                        </div>
                    `;
                    
                    document.body.appendChild(modal);
                    
                } catch (error) {
                    console.error('View liability details error:', error);
                    Utils.showToast('Failed to load liability details: ' + error.message, 'error');
                }
            }

            async deleteLiability(liabilityId) {
                if (!confirm('Are you sure you want to delete this liability?')) return;
                
                Utils.showSpinner();
                try {
                    const liability = state.allLiabilities.find(l => l.id === liabilityId);
                    await deleteDoc(doc(firebaseService.getUserCollection('liabilities'), liabilityId));
                    await ActivityLogger.log('Liability Deleted', `Deleted liability: ${liability?.creditor || 'Unknown'}`);
                    
                    Utils.showToast('Liability deleted successfully', 'success');
                } catch (error) {
                    console.error('Delete liability error:', error);
                    Utils.showToast('Failed to delete liability: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            renderLiabilities() {
                const tbody = document.querySelector('#liabilities-table tbody');
                if (!tbody) return;
                
                tbody.innerHTML = '';
                
                // Apply filters
                const typeFilter = document.getElementById('liability-type-filter')?.value || '';
                const statusFilter = document.getElementById('liability-status-filter')?.value || '';
                const search = document.getElementById('liability-search')?.value.toLowerCase() || '';
                
                let filtered = [...state.allLiabilities];
                
                if (typeFilter) {
                    filtered = filtered.filter(l => l.type === typeFilter);
                }
                
                if (statusFilter) {
                    filtered = filtered.filter(l => l.calculatedStatus === statusFilter || l.status === statusFilter);
                }
                
                if (search) {
                    filtered = filtered.filter(l =>
                        l.creditor.toLowerCase().includes(search) ||
                        l.description.toLowerCase().includes(search)
                    );
                }
                
                // Update summary
                this.updateLiabilitiesSummary(filtered);
                
                if (filtered.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" class="no-data">No liabilities found</td></tr>';
                    return;
                }
                
                filtered.forEach(liability => {
                    const row = document.createElement('tr');
                    
                    const statusClass = liability.calculatedStatus === 'overdue' ? 'text-danger' :
                                      liability.calculatedStatus === 'paid' ? 'text-success' :
                                      liability.calculatedStatus === 'due_soon' ? 'text-warning' : 
                                      liability.calculatedStatus === 'unpaid' ? 'text-info' : '';
                    
                    const typeDisplay = {
                        'accounts_payable': 'A/P',
                        'loan': 'Loan',
                        'credit_card': 'Credit Card',
                        'other': 'Other'
                    }[liability.type] || liability.type;
                    
                    const statusDisplay = {
                        'paid': 'Paid',
                        'overdue': 'Overdue',
                        'due_soon': 'Due Soon',
                        'unpaid': 'Unpaid',
                        'active': 'Active'
                    }[liability.calculatedStatus] || liability.calculatedStatus;
                    
                    // Handle undefined creditor (for old records or A/P)
                    const creditorDisplay = liability.creditor || liability.supplierName || 'Unknown Creditor';
                    
                    row.innerHTML = `
                        <td>${creditorDisplay}</td>
                        <td>${typeDisplay}</td>
                        <td>${liability.description}</td>
                        <td>${Utils.formatCurrency(liability.balance)}</td>
                        <td>${liability.dueDate}</td>
                        <td class="${statusClass}">${statusDisplay}</td>
                        <td class="actions">
                            ${liability.balance > 0 ? `
                                <button onclick="appController.openRecordLiabilityPaymentModal('${liability.id}')" title="Record Payment">
                                    <i class="fas fa-money-bill-wave"></i>
                                </button>
                            ` : ''}
                            <button onclick="appController.viewLiabilityDetails('${liability.id}')" title="View Details" class="info">
                                <i class="fas fa-info-circle"></i>
                            </button>
                            <button class="danger" onclick="appController.deleteLiability('${liability.id}')" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    `;
                    
                    tbody.appendChild(row);
                });
            }

            updateLiabilitiesSummary(liabilities) {
                const total = liabilities.reduce((sum, l) => sum + (l.balance || 0), 0);
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const thirtyDaysFromNow = new Date(today);
                thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                
                const current = liabilities.filter(l => {
                    const dueDate = new Date(l.dueDate);
                    return l.balance > 0 && dueDate >= today && dueDate <= thirtyDaysFromNow;
                }).reduce((sum, l) => sum + l.balance, 0);
                
                const overdue = liabilities.filter(l => l.calculatedStatus === 'overdue')
                                         .reduce((sum, l) => sum + l.balance, 0);
                
                const totalEl = document.getElementById('total-liabilities-amount');
                const currentEl = document.getElementById('current-liabilities');
                const overdueEl = document.getElementById('overdue-liabilities');
                
                if (totalEl) totalEl.textContent = Utils.formatCurrency(total);
                if (currentEl) currentEl.textContent = Utils.formatCurrency(current);
                if (overdueEl) overdueEl.textContent = Utils.formatCurrency(overdue);
            }

            // ==================== PURCHASE ORDER ITEM MANAGEMENT ====================

            /** Setup and show Create PO modal. Pass product IDs to pre-fill with out-of-stock products. */
            setupCreatePOModal(prefillProductIds = []) {
                document.getElementById('add-po-form').reset();
                document.getElementById('po-date').valueAsDate = new Date();
                
                const supplierSelect = document.getElementById('po-supplier');
                if (supplierSelect) {
                    if (state.allSuppliers.length === 0) {
                        supplierSelect.innerHTML = '<option value="">No suppliers yet - Add a supplier first</option>';
                    } else {
                        supplierSelect.innerHTML = '<option value="">Select Supplier</option>' +
                            state.allSuppliers
                                .filter(s => s.status === 'active')
                                .map(supplier => `<option value="${supplier.id}">${supplier.name}</option>`)
                                .join('');
                    }
                }
                
                if (supplierSelect) {
                    supplierSelect.onchange = (e) => {
                        const supplier = state.allSuppliers.find(s => s.id === e.target.value);
                        const termsInput = document.getElementById('po-payment-terms');
                        if (supplier && termsInput) {
                            termsInput.value = this.formatPaymentTerms(supplier.paymentTerms);
                        } else if (termsInput) {
                            termsInput.value = '';
                        }
                    };
                }
                
                document.getElementById('po-items-list').innerHTML = '';
                
                if (prefillProductIds.length > 0) {
                    prefillProductIds.forEach(id => {
                        const product = state.allProducts.find(p => p.id === id);
                        if (product) this.addPOItemRow(product);
                    });
                } else {
                    this.addPOItemRow();
                }
                
                const addItemBtn = document.getElementById('add-po-item-btn');
                if (addItemBtn) {
                    const newHandler = () => this.addPOItemRow();
                    addItemBtn.replaceWith(addItemBtn.cloneNode(true));
                    document.getElementById('add-po-item-btn').addEventListener('click', newHandler);
                }
                
                const taxInput = document.getElementById('po-tax-percent');
                if (taxInput) {
                    taxInput.oninput = () => this.calculatePOTotals();
                }
                const shippingInput = document.getElementById('po-shipping');
                if (shippingInput) {
                    shippingInput.oninput = () => this.calculatePOTotals();
                }
                
                document.getElementById('add-po-modal').style.display = 'block';
            }

            addPOItemRow(prefillProduct = null) {
                const container = document.getElementById('po-items-list');
                if (!container) return;
                
                const rowIndex = container.children.length;
                const suggestedQty = prefillProduct ? Math.max(1, parseInt(prefillProduct.minStock) || 10) : 1;
                const prefillCost = prefillProduct ? (parseFloat(prefillProduct.cost) || 0) : '';
                const prefillName = prefillProduct ? (prefillProduct.name || '') : '';
                const prefillId = prefillProduct ? (prefillProduct.id || '') : '';
                
                const row = document.createElement('div');
                row.className = 'po-item-row';
                row.dataset.rowIndex = rowIndex;
                row.style.cssText = 'display: grid; grid-template-columns: 3fr 1fr 1fr 1fr 60px; gap: 0.5rem; align-items: start; margin-bottom: 1rem; padding: 1rem; background: white; border: 1px solid #ddd; border-radius: 8px;';
                
                row.innerHTML = `
                    <div style="position: relative;">
                        <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; font-weight: 500;">
                            Product ${rowIndex + 1} *
                        </label>
                        <input type="text" 
                               id="po-product-search-${rowIndex}" 
                               placeholder="🔍 Search product or enter new name..." 
                               autocomplete="off"
                               class="po-product-search"
                               style="width: 100%;"
                               value="${(prefillName || '').replace(/"/g, '&quot;')}"
                               required>
                        <div id="po-product-dropdown-${rowIndex}" 
                             class="bulk-product-search-dropdown" 
                             style="display: none; position: absolute; z-index: 1000; width: 100%;"></div>
                        <input type="hidden" id="po-product-id-${rowIndex}" value="${prefillId || ''}">
                        <input type="hidden" id="po-product-is-new-${rowIndex}" value="false">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; font-weight: 500;">Quantity *</label>
                        <input type="number" 
                               id="po-quantity-${rowIndex}" 
                               placeholder="Qty" 
                               min="1" 
                               value="${suggestedQty}"
                               style="width: 100%;"
                               required>
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; font-weight: 500;">Unit Cost *</label>
                        <input type="number" 
                               id="po-cost-${rowIndex}" 
                               placeholder="Cost" 
                               step="0.01" 
                               min="0"
                               value="${prefillCost}"
                               style="width: 100%;"
                               required>
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.25rem; font-size: 0.9rem; font-weight: 500;">Total</label>
                        <input type="text" 
                               id="po-total-${rowIndex}" 
                               placeholder="0.00" 
                               readonly 
                               style="width: 100%; background: #e9ecef; font-weight: bold;">
                    </div>
                    <div style="padding-top: 1.75rem;">
                        ${rowIndex > 0 ? `
                            <button type="button" 
                                    class="danger" 
                                    onclick="appController.removePOItemRow(${rowIndex})"
                                    style="width: 100%; padding: 0.5rem;">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : '<div style="height: 38px;"></div>'}
                    </div>
                `;
                
                container.appendChild(row);
                this.attachPOItemListeners(rowIndex);
                if (prefillProduct) this.updatePORowTotal(rowIndex);
            }

            attachPOItemListeners(rowIndex) {
                const searchInput = document.getElementById(`po-product-search-${rowIndex}`);
                const quantityInput = document.getElementById(`po-quantity-${rowIndex}`);
                const costInput = document.getElementById(`po-cost-${rowIndex}`);
                
                // Searchable product dropdown
                if (searchInput) {
                    searchInput.addEventListener('input', Utils.debounce((e) => {
                        this.searchPOProducts(e.target.value, rowIndex);
                    }, 300));
                    
                    searchInput.addEventListener('focus', (e) => {
                        if (e.target.value) {
                            this.searchPOProducts(e.target.value, rowIndex);
                        }
                    });
                    
                    // Close dropdown on outside click
                    document.addEventListener('click', (e) => {
                        const dropdown = document.getElementById(`po-product-dropdown-${rowIndex}`);
                        if (dropdown && !searchInput.contains(e.target) && !dropdown.contains(e.target)) {
                            dropdown.style.display = 'none';
                        }
                    });
                }
                
                // Quantity and cost change
                if (quantityInput) {
                    quantityInput.addEventListener('input', () => this.updatePORowTotal(rowIndex));
                }
                if (costInput) {
                    costInput.addEventListener('input', () => this.updatePORowTotal(rowIndex));
                }
            }

            searchPOProducts(query, rowIndex) {
                const dropdown = document.getElementById(`po-product-dropdown-${rowIndex}`);
                if (!dropdown) return;
                
                const searchQuery = query.toLowerCase().trim();
                
                if (!searchQuery) {
                    dropdown.style.display = 'none';
                    return;
                }
                
                const filtered = state.allProducts.filter(p => 
                    p.name.toLowerCase().includes(searchQuery) ||
                    p.category.toLowerCase().includes(searchQuery)
                );
                
                if (filtered.length === 0) {
                    dropdown.innerHTML = `
                        <div style="padding: 1rem; text-align: center;">
                            <div style="color: #666; margin-bottom: 0.5rem;">No existing products found</div>
                            <button type="button" 
                                    onclick="appController.selectNewPOProduct('${query.replace(/'/g, "\\'")}', ${rowIndex})"
                                    style="background: #28a745; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                                <i class="fas fa-plus"></i> Add "${query}" as new product
                            </button>
                        </div>
                    `;
                    dropdown.style.display = 'block';
                    return;
                }
                
                dropdown.innerHTML = filtered.map(product => `
                    <div class="bulk-product-search-item" 
                         onclick="appController.selectPOProduct('${product.id}', '${product.name.replace(/'/g, "\\'")}', ${product.cost || 0}, ${rowIndex})">
                        <div><strong>${product.name}</strong> <span style="color: #666;">(${product.category})</span></div>
                        <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">
                            Current Cost: ${Utils.formatCurrency(product.cost || 0)}
                        </div>
                    </div>
                `).join('') + `
                    <div style="padding: 0.75rem; background: #f8f9fa; border-top: 1px solid #ddd;">
                        <button type="button" 
                                onclick="appController.selectNewPOProduct('${query.replace(/'/g, "\\'")}', ${rowIndex})"
                                style="background: #28a745; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; width: 100%;">
                            <i class="fas fa-plus"></i> Add as new product
                        </button>
                    </div>
                `;
                
                dropdown.style.display = 'block';
            }

            selectPOProduct(productId, productName, cost, rowIndex) {
                document.getElementById(`po-product-id-${rowIndex}`).value = productId;
                document.getElementById(`po-product-search-${rowIndex}`).value = productName;
                document.getElementById(`po-cost-${rowIndex}`).value = cost;
                document.getElementById(`po-product-is-new-${rowIndex}`).value = 'false';
                
                const dropdown = document.getElementById(`po-product-dropdown-${rowIndex}`);
                if (dropdown) dropdown.style.display = 'none';
                
                this.updatePORowTotal(rowIndex);
            }

            selectNewPOProduct(productName, rowIndex) {
                document.getElementById(`po-product-id-${rowIndex}`).value = '';
                document.getElementById(`po-product-search-${rowIndex}`).value = productName;
                document.getElementById(`po-product-is-new-${rowIndex}`).value = 'true';
                
                const dropdown = document.getElementById(`po-product-dropdown-${rowIndex}`);
                if (dropdown) dropdown.style.display = 'none';
                
                // Clear cost to require user input for new product
                document.getElementById(`po-cost-${rowIndex}`).value = '';
            }

            removePOItemRow(rowIndex) {
                const row = document.querySelector(`.po-item-row[data-row-index="${rowIndex}"]`);
                if (row) {
                    row.remove();
                    this.renumberPOItems();
                    this.calculatePOTotals();
                }
            }

            renumberPOItems() {
                const rows = document.querySelectorAll('.po-item-row');
                rows.forEach((row, index) => {
                    row.dataset.rowIndex = index;
                    const label = row.querySelector('label');
                    if (label) label.textContent = `Product ${index + 1} *`;
                });
            }

            updatePORowTotal(rowIndex) {
                const qty = parseFloat(document.getElementById(`po-quantity-${rowIndex}`)?.value) || 0;
                const cost = parseFloat(document.getElementById(`po-cost-${rowIndex}`)?.value) || 0;
                const total = qty * cost;
                
                const totalInput = document.getElementById(`po-total-${rowIndex}`);
                if (totalInput) {
                    totalInput.value = total.toFixed(2);
                }
                
                this.calculatePOTotals();
            }

            calculatePOTotals() {
                let subtotal = 0;
                const rows = document.querySelectorAll('.po-item-row');
                
                rows.forEach(row => {
                    const index = row.dataset.rowIndex;
                    const qty = parseFloat(document.getElementById(`po-quantity-${index}`)?.value) || 0;
                    const cost = parseFloat(document.getElementById(`po-cost-${index}`)?.value) || 0;
                    subtotal += (qty * cost);
                });
                
                const taxPercent = parseFloat(document.getElementById('po-tax-percent')?.value) || 0;
                const shipping = parseFloat(document.getElementById('po-shipping')?.value) || 0;
                
                const tax = (subtotal * taxPercent) / 100;
                const grandTotal = subtotal + tax + shipping;
                
                document.getElementById('po-subtotal').value = subtotal.toFixed(2);
                document.getElementById('po-tax-amount').value = tax.toFixed(2);
                document.getElementById('po-grand-total').value = grandTotal.toFixed(2);
            }

            // ==================== SUPPLIERS MANAGEMENT ====================

            renderSuppliers() {
                const tbody = document.querySelector('#suppliers-table tbody');
                if (!tbody) return;
                
                // Apply filters
                const statusFilter = document.getElementById('supplier-status-filter')?.value || '';
                const searchQuery = document.getElementById('supplier-search')?.value.toLowerCase() || '';
                
                let filtered = state.allSuppliers.filter(supplier => {
                    const matchesStatus = !statusFilter || supplier.status === statusFilter;
                    const matchesSearch = !searchQuery || 
                        supplier.name.toLowerCase().includes(searchQuery) ||
                        supplier.phone?.toLowerCase().includes(searchQuery) ||
                        supplier.email?.toLowerCase().includes(searchQuery);
                    
                    return matchesStatus && matchesSearch;
                });

                // Outstanding balance from liabilities (source of truth) so it reflects what is actually owed
                const outstandingBySupplierId = {};
                (state.allLiabilities || []).forEach(l => {
                    const id = l.supplierId || '';
                    if (!outstandingBySupplierId[id]) outstandingBySupplierId[id] = 0;
                    outstandingBySupplierId[id] += ((parseFloat(l.balance) ?? parseFloat(l.amount)) || 0);
                });
                const totalOutstandingFromLiabilities = Object.values(outstandingBySupplierId).reduce((a, b) => a + b, 0);

                // Update summary metrics (use liability-derived total so displayed balance is correct)
                const totalSuppliers = state.allSuppliers.length;
                const activeSuppliers = state.allSuppliers.filter(s => s.status === 'active').length;
                this.updateElement('total-suppliers-count', totalSuppliers);
                this.updateElement('active-suppliers-count', activeSuppliers);
                this.updateElement('suppliers-outstanding-balance', Utils.formatCurrency(totalOutstandingFromLiabilities));

                // Render table (per-row outstanding from liabilities; fallback to stored supplier.outstandingBalance)
                if (filtered.length === 0) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="7" style="text-align:center; padding: 3rem;">
                                <i class="fas fa-truck-loading" style="font-size: 3rem; color: #ccc; display: block; margin-bottom: 1rem;"></i>
                                <h3 style="color: #666;">${state.allSuppliers.length === 0 ? 'No suppliers yet' : 'No suppliers match your filters'}</h3>
                                <p style="color: #999;">${state.allSuppliers.length === 0 ? 'Click "Add Supplier" to create your first supplier' : 'Try adjusting your search or filters'}</p>
                            </td>
                        </tr>
                    `;
                    return;
                }
                
                tbody.innerHTML = filtered.map(supplier => {
                    const owed = outstandingBySupplierId[supplier.id] ?? (parseFloat(supplier.outstandingBalance) || 0);
                    return `
                    <tr>
                        <td><strong>${supplier.name}</strong></td>
                        <td>${supplier.phone || '-'}</td>
                        <td>${supplier.email || '-'}</td>
                        <td>${this.formatPaymentTerms(supplier.paymentTerms)}</td>
                        <td>${Utils.formatCurrency(owed)}</td>
                        <td><span class="badge badge-${supplier.status}">${supplier.status}</span></td>
                        <td>
                            <button onclick="appController.editSupplier('${supplier.id}')" class="btn-sm" style="padding: 0.25rem 0.5rem; font-size: 0.85rem;">✏️ Edit</button>
                        </td>
                    </tr>
                `;
                }).join('');
            }

            editSupplier(supplierId) {
                const supplier = state.allSuppliers.find(s => s.id === supplierId);
                if (!supplier) return Utils.showToast('Supplier not found', 'error');

                let modal = document.getElementById('edit-supplier-modal');
                if (!modal) {
                    modal = document.createElement('div');
                    modal.id = 'edit-supplier-modal';
                    modal.className = 'modal';
                    document.body.appendChild(modal);
                }

                modal.innerHTML = `
                    <div class="modal-content" style="max-width: 500px;">
                        <span class="close" onclick="document.getElementById('edit-supplier-modal').style.display='none'">&times;</span>
                        <h3><i class="fas fa-edit"></i> Edit Supplier</h3>
                        <form id="edit-supplier-form">
                            <label>Name *</label>
                            <input type="text" id="edit-supplier-name" value="${supplier.name || ''}" required>
                            <label>Phone</label>
                            <input type="text" id="edit-supplier-phone" value="${supplier.phone || ''}">
                            <label>Email</label>
                            <input type="email" id="edit-supplier-email" value="${supplier.email || ''}">
                            <label>Payment Terms</label>
                            <select id="edit-supplier-terms">
                                <option value="cash" ${supplier.paymentTerms === 'cash' ? 'selected' : ''}>Cash</option>
                                <option value="net_7" ${supplier.paymentTerms === 'net_7' ? 'selected' : ''}>Net 7 Days</option>
                                <option value="net_15" ${supplier.paymentTerms === 'net_15' ? 'selected' : ''}>Net 15 Days</option>
                                <option value="net_30" ${supplier.paymentTerms === 'net_30' ? 'selected' : ''}>Net 30 Days</option>
                                <option value="net_60" ${supplier.paymentTerms === 'net_60' ? 'selected' : ''}>Net 60 Days</option>
                            </select>
                            <label>Status</label>
                            <select id="edit-supplier-status">
                                <option value="active" ${supplier.status === 'active' ? 'selected' : ''}>Active</option>
                                <option value="inactive" ${supplier.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                            </select>
                            <button type="submit" style="margin-top: 1rem; width: 100%;">Save Changes</button>
                        </form>
                    </div>
                `;

                modal.style.display = 'block';

                document.getElementById('edit-supplier-form').onsubmit = async (e) => {
                    e.preventDefault();
                    try {
                        const updatedData = {
                            name: document.getElementById('edit-supplier-name').value,
                            phone: document.getElementById('edit-supplier-phone').value,
                            email: document.getElementById('edit-supplier-email').value,
                            paymentTerms: document.getElementById('edit-supplier-terms').value,
                            status: document.getElementById('edit-supplier-status').value,
                            updatedAt: new Date().toISOString()
                        };
                        await updateDoc(doc(collection(db, 'suppliers'), supplierId), updatedData);
                        Object.assign(supplier, updatedData);
                        Utils.showToast('Supplier updated successfully', 'success');
                        modal.style.display = 'none';
                        this.renderSuppliers();
                    } catch (error) {
                        Utils.showToast('Failed to update supplier: ' + error.message, 'error');
                    }
                };
            }

            formatPaymentTerms(terms) {
                const termNames = {
                    cash: 'Cash',
                    net_7: 'Net 7 Days',
                    net_15: 'Net 15 Days',
                    net_30: 'Net 30 Days',
                    net_60: 'Net 60 Days'
                };
                return termNames[terms] || terms;
            }

            // ==================== PURCHASE ORDERS MANAGEMENT ====================

            renderPurchaseOrders() {
                const tbody = document.querySelector('#purchase-orders-table tbody');
                if (!tbody) return;
                
                // Apply filters
                const statusFilter = document.getElementById('po-status-filter')?.value || '';
                const searchQuery = document.getElementById('po-search')?.value.toLowerCase() || '';
                
                let filtered = state.allPurchaseOrders.filter(po => {
                    const matchesStatus = !statusFilter || po.status === statusFilter;
                    const matchesSearch = !searchQuery || 
                        po.poNumber.toLowerCase().includes(searchQuery) ||
                        po.supplierName.toLowerCase().includes(searchQuery);
                    
                    return matchesStatus && matchesSearch;
                });
                
                // Update summary metrics
                const totalPOs = state.allPurchaseOrders.length;
                const pendingPOs = state.allPurchaseOrders.filter(po => po.status === 'pending').length;
                const pendingValue = state.allPurchaseOrders
                    .filter(po => po.status === 'pending')
                    .reduce((sum, po) => sum + (po.totalAmount || 0), 0);
                
                this.updateElement('total-pos-count', totalPOs);
                this.updateElement('pending-pos-count', pendingPOs);
                this.updateElement('pending-pos-value', Utils.formatCurrency(pendingValue));
                
                // Render table
                if (filtered.length === 0) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="6" style="text-align:center; padding: 3rem;">
                                <i class="fas fa-file-invoice" style="font-size: 3rem; color: #ccc; display: block; margin-bottom: 1rem;"></i>
                                <h3 style="color: #666;">${state.allPurchaseOrders.length === 0 ? 'No purchase orders yet' : 'No purchase orders match your filters'}</h3>
                                <p style="color: #999;">${state.allPurchaseOrders.length === 0 ? 'Click "Create Purchase Order" to get started' : 'Try adjusting your search or filters'}</p>
                            </td>
                        </tr>
                    `;
                    return;
                }
                
                tbody.innerHTML = filtered.map(po => {
                    const statusClass = po.status === 'pending' ? 'status-pending' : 
                                      po.status === 'received' ? 'status-received' : 'status-cancelled';
                    return `
                        <tr>
                            <td><strong>${po.poNumber}</strong></td>
                            <td>${po.supplierName}</td>
                            <td>${new Date(po.orderDate).toLocaleDateString()}</td>
                            <td><strong>${Utils.formatCurrency(po.totalAmount)}</strong></td>
                            <td><span class="status-badge ${statusClass}">${po.status}</span></td>
                            <td>
                                ${po.status === 'pending' ? 
                                    `<button onclick="appController.openReceivePOModal('${po.id}')" class="btn-sm" style="padding: 0.25rem 0.5rem; font-size: 0.85rem; background: #28a745;">📦 Receive</button>` :
                                    `<button onclick="appController.viewPODetails('${po.id}')" class="btn-sm" style="padding: 0.25rem 0.5rem; font-size: 0.85rem;">👁️ View</button>`
                                }
                                <button onclick="window.appController?.exportPOPdf('${po.id}')" class="btn-sm" style="padding: 0.25rem 0.5rem; font-size: 0.85rem; background: #dc3545; color: white;" title="Export PDF">
                                    <i class="fas fa-file-pdf"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }

            openReceivePOModal(poId) {
                const po = state.allPurchaseOrders.find(p => p.id === poId);
                            
                console.log("📦 PO to receive:", po);
                console.log("📦 Items count:", po.items.length);
                console.log("📦 Items:", JSON.stringify(po.items, null, 2));
                
                if (!po) {
                    Utils.showToast('Purchase order not found', 'error');
                    return;
                }
                
                // Populate PO details (escaped)
                const detailsDiv = document.getElementById('receive-po-details');
                const safePoNumber = this.escapeHtml(po.poNumber || '');
                const safeSupplier = this.escapeHtml(po.supplierName || '');
                const safeOrderDate = po.orderDate ? new Date(po.orderDate).toLocaleDateString() : '';
                detailsDiv.innerHTML = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div><strong>PO Number:</strong> ${safePoNumber}</div>
                        <div><strong>Supplier:</strong> ${safeSupplier}</div>
                        <div><strong>Order Date:</strong> ${safeOrderDate}</div>
                        <div><strong>Total Amount:</strong> ${Utils.formatCurrency(po.totalAmount)}</div>
                    </div>
                `;
                
                // Set form values
                document.getElementById('receive-po-id').value = poId;
                document.getElementById('receive-date').valueAsDate = new Date();
                document.getElementById('received-by').value = state.currentUser?.email || 'Current User';
                
                // Populate items list with editable quantities and remove button (escaped)
                const itemsList = document.getElementById('receive-items-list');
                itemsList.innerHTML = po.items.map((item, index) => {
                    const safeProductName = this.escapeHtml(item.productName || '');
                    const safeCategory = this.escapeHtml(item.category || 'Other');
                    const safeProductId = this.escapeHtml(item.productId || '');
                    const safeSellingPrice = this.escapeHtml(item.sellingPrice || item.unitCost * 1.5 || '');
                    const safeUnitCost = this.escapeHtml(item.unitCost || '');
                    const qty = this.escapeHtml(item.quantity ?? '');
                    const maxQty = this.escapeHtml(item.quantity * 2 ?? '');
                    const isNew = !!item.isNewProduct;
                    return `
                    <div class="receive-item-row" data-index="${index}" style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem;">
                        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr 60px; gap: 1rem; align-items: center;">
                            <div>
                                <strong>${safeProductName}</strong>
                                ${isNew ? '<span style="background: #28a745; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem;">NEW</span>' : ''}
                                <input type="hidden" class="item-product-id" value="${safeProductId}">
                                <input type="hidden" class="item-product-name" value="${safeProductName}">
                                <input type="hidden" class="item-is-new" value="${isNew}">
                                <input type="hidden" class="item-category" value="${safeCategory}">
                                <input type="hidden" class="item-selling-price" value="${safeSellingPrice}">
                                <input type="hidden" class="item-unit-cost" value="${safeUnitCost}">
                            </div>
                            <div>
                                <label style="font-size: 0.85rem; color: #666; display: block;">Ordered</label>
                                <div><strong>${qty}</strong></div>
                                <input type="hidden" class="item-ordered-qty" value="${qty}">
                            </div>
                            <div>
                                <label style="font-size: 0.85rem; color: #666; display: block; margin-bottom: 0.25rem;">Received *</label>
                                <input type="number" 
                                       class="item-received-qty" 
                                       value="${qty}" 
                                       min="0" 
                                       max="${maxQty}"
                                       style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;"
                                       required>
                            </div>
                            <div>
                                <label style="font-size: 0.85rem; color: #666; display: block;">Unit Cost</label>
                                <div>${Utils.formatCurrency(item.unitCost)}</div>
                            </div>
                            <div>
                                <label style="font-size: 0.85rem; color: #666; display: block;">Total</label>
                                <div class="item-total-display"><strong>${Utils.formatCurrency(item.totalCost)}</strong></div>
                            </div>
                            <div style="padding-top: 1.5rem;">
                                <button type="button" 
                                        class="remove-receive-item" 
                                        onclick="appController.removeReceiveItem(${index})"
                                        style="background: #dc3545; color: white; border: none; padding: 0.5rem; border-radius: 4px; cursor: pointer; width: 100%;"
                                        title="Remove unfulfilled item">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                        ${item.isNewProduct ? `
                            <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #eee; font-size: 0.85rem; color: #666;">
                                <i class="fas fa-info-circle"></i> This product will be added to inventory with the received quantity
                            </div>
                        ` : ''}
                        <div style="margin-top: 0.5rem; font-size: 0.85rem; color: #999;">
                            <i class="fas fa-lightbulb"></i> Adjust "Received" quantity or click <i class="fas fa-times"></i> to remove unfulfilled items
                        </div>
                    </div>
                `;
                }).join('');
                
                // Add event listeners for quantity changes
                document.querySelectorAll('.item-received-qty').forEach(input => {
                    input.addEventListener('input', (e) => {
                        const row = e.target.closest('.receive-item-row');
                        const receivedQty = parseFloat(e.target.value) || 0;
                        const unitCost = parseFloat(row.querySelector('.item-unit-cost').value) || 0;
                        const total = receivedQty * unitCost;
                        row.querySelector('.item-total-display').innerHTML = `<strong>${Utils.formatCurrency(total)}</strong>`;
                    });
                });
                
                // Show modal
                document.getElementById('receive-po-modal').style.display = 'block';
            }

            removeReceiveItem(index) {
                const row = document.querySelector(`.receive-item-row[data-index="${index}"]`);
                if (row) {
                    const productName = row.querySelector('.item-product-name').value;
                    if (confirm(`Remove "${productName}" from this receipt? This item was not fulfilled by the supplier.`)) {
                        row.remove();
                        Utils.showToast('Item removed from receipt', 'info');
                    }
                }
            }

            async exportPOPdf(poId) {
                const po = state.allPurchaseOrders.find(p => p.id === poId);
                if (!po) {
                    Utils.showToast('Purchase order not found', 'error');
                    return;
                }
                try {
                    await window.pdfExport?.generatePurchaseOrderPDF(po);
                } catch (err) {
                    console.error('PO PDF export failed:', err);
                    Utils.showToast('PDF export failed: ' + err.message, 'error');
                }
            }

            viewPODetails(poId) {
                const po = state.allPurchaseOrders.find(p => p.id === poId);
                if (!po) {
                    Utils.showToast('Purchase order not found', 'error');
                    return;
                }

                const items = po.items || [];
                const orderDateStr = po.orderDate ? new Date(po.orderDate).toLocaleDateString() : '—';
                const paymentTerms = po.paymentTerms ? (po.paymentTerms.replace('_', ' ').toUpperCase()) : '—';
                const dueDateStr = po.dueDate ? new Date(po.dueDate).toLocaleDateString() : '—';

                const detailsHTML = `
                    <div style="background: #f8f9fa; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
                        <h4 style="margin: 0 0 1rem 0;">Purchase Order Details</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div><strong>PO Number:</strong> ${po.poNumber || '—'}</div>
                            <div><strong>Supplier:</strong> ${po.supplierName || '—'}</div>
                            <div><strong>Order Date:</strong> ${orderDateStr}</div>
                            <div><strong>Status:</strong> <span style="text-transform: capitalize;">${(po.status || '—')}</span></div>
                            <div><strong>Payment Terms:</strong> ${paymentTerms}</div>
                            <div><strong>Due Date:</strong> ${dueDateStr}</div>
                            <div><strong>Total Amount:</strong> ${Utils.formatCurrency(po.totalAmount)}</div>
                            <div><strong>Items:</strong> ${items.length}</div>
                        </div>
                    </div>

                    <h4 style="margin-bottom: 1rem;">Line Items</h4>
                    ${items.length > 0 ? `
                        <div class="table-container" style="margin-bottom: 1rem;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                                        <th style="padding: 0.75rem; text-align: left;">Product</th>
                                        <th style="padding: 0.75rem; text-align: right;">Qty</th>
                                        <th style="padding: 0.75rem; text-align: right;">Unit Cost</th>
                                        <th style="padding: 0.75rem; text-align: right;">Total</th>
                                        <th style="padding: 0.75rem; text-align: center;">Type</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${items.map((item, i) => `
                                        <tr style="border-bottom: 1px solid #dee2e6;">
                                            <td style="padding: 0.75rem;">${item.productName || '—'}</td>
                                            <td style="padding: 0.75rem; text-align: right;">${item.quantity ?? '—'}</td>
                                            <td style="padding: 0.75rem; text-align: right;">${Utils.formatCurrency(item.unitCost)}</td>
                                            <td style="padding: 0.75rem; text-align: right;"><strong>${Utils.formatCurrency(item.totalCost)}</strong></td>
                                            <td style="padding: 0.75rem; text-align: center;">${item.isNewProduct ? '<span style="background: #28a745; color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">New</span>' : '—'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                                <tfoot>
                                    <tr style="background: #f8f9fa; font-weight: bold;">
                                        <td colspan="3" style="padding: 0.75rem; text-align: right;">Total</td>
                                        <td style="padding: 0.75rem; text-align: right;">${Utils.formatCurrency(po.totalAmount)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    ` : `
                        <p style="text-align: center; padding: 2rem; color: #6c757d;">No line items on this purchase order.</p>
                    `}
                `;

                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.style.display = 'block';
                modal.innerHTML = `
                    <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
                        <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                        <h3><i class="fas fa-file-invoice"></i> Purchase Order: ${po.poNumber || poId}</h3>
                        ${detailsHTML}
                        <div style="margin-top: 1.5rem; display: flex; gap: 0.75rem;">
                            <button type="button" onclick="window.appController?.exportPOPdf('${poId}')" style="flex: 1; background: #dc3545;">
                                <i class="fas fa-file-pdf"></i> Export PDF
                            </button>
                            <button type="button" onclick="this.closest('.modal').remove()" style="flex: 1;">Close</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            calculateDueDate(receiveDate, paymentTerms) {
                const date = new Date(receiveDate);
                
                switch(paymentTerms) {
                    case 'cash':
                        return receiveDate; // Due immediately
                    case 'net_7':
                        date.setDate(date.getDate() + 7);
                        break;
                    case 'net_15':
                        date.setDate(date.getDate() + 15);
                        break;
                    case 'net_30':
                        date.setDate(date.getDate() + 30);
                        break;
                    case 'net_60':
                        date.setDate(date.getDate() + 60);
                        break;
                    default:
                        date.setDate(date.getDate() + 30); // Default 30 days
                }
                
                return date.toISOString().split('T')[0];
            }

            // ==================== DATE RANGE SELECTOR ====================

            initializeDateRangeSelector() {
                // Skip if already initialized
                if (this._dateRangeInitialized) return;
                this._dateRangeInitialized = true;

                // Preset buttons
                document.querySelectorAll('.preset-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const range = btn.dataset.range;
                        
                        // Update active state
                        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        
                        if (range === 'custom') {
                            document.querySelector('.custom-date-range').style.display = 'flex';
                        } else {
                            document.querySelector('.custom-date-range').style.display = 'none';
                            this.applyPresetRange(range);
                        }
                    });
                });
                
                // Custom range apply
                const applyBtn = document.getElementById('apply-custom-range');
                if (applyBtn) {
                    applyBtn.addEventListener('click', () => {
                        this.applyCustomRange();
                    });
                }
                
                // Comparison toggle
                const compareCheckbox = document.getElementById('compare-previous');
                if (compareCheckbox) {
                    compareCheckbox.addEventListener('change', (e) => {
                        state.compareMode = e.target.checked;
                        this.refreshAnalytics();
                    });
                }

                // Load saved date range
                const saved = localStorage.getItem('analyticsDateRange');
                if (saved) {
                    try {
                        state.dateRange = JSON.parse(saved);
                        this.updateDateRangeDisplay();
                    } catch (e) {
                        console.error('Failed to load saved date range:', e);
                    }
                }
            }

            applyPresetRange(range) {
                const today = new Date();
                const end = new Date(today);
                let start = new Date(today);
                
                switch(range) {
                    case 'today':
                        start = new Date(today);
                        break;
                    case '7days':
                        start.setDate(start.getDate() - 7);
                        break;
                    case '30days':
                        start.setDate(start.getDate() - 30);
                        break;
                    case '90days':
                        start.setDate(start.getDate() - 90);
                        break;
                    case '6months':
                        start.setMonth(start.getMonth() - 6);
                        break;
                    case '1year':
                        start.setFullYear(start.getFullYear() - 1);
                        break;
                }
                
                state.dateRange = {
                    start: start.toISOString().split('T')[0],
                    end: end.toISOString().split('T')[0],
                    preset: range
                };
                
                localStorage.setItem('analyticsDateRange', JSON.stringify(state.dateRange));
                this.updateDateRangeDisplay();
                this.refreshAnalytics();
            }

            applyCustomRange() {
                const start = document.getElementById('date-range-start').value;
                const end = document.getElementById('date-range-end').value;
                
                if (!start || !end) {
                    Utils.showToast('Please select both start and end dates', 'warning');
                    return;
                }
                
                if (new Date(start) > new Date(end)) {
                    Utils.showToast('Start date must be before end date', 'error');
                    return;
                }
                
                state.dateRange = {
                    start,
                    end,
                    preset: 'custom'
                };
                
                localStorage.setItem('analyticsDateRange', JSON.stringify(state.dateRange));
                this.updateDateRangeDisplay();
                this.refreshAnalytics();
            }

            updateDateRangeDisplay() {
                const display = document.getElementById('current-range-display');
                if (!display) return;
                
                const range = state.dateRange;
                
                if (range.preset === 'custom') {
                    display.textContent = `${range.start} to ${range.end}`;
                } else {
                    const presetNames = {
                        'today': 'Today',
                        '7days': 'Last 7 Days',
                        '30days': 'Last 30 Days',
                        '90days': 'Last 90 Days',
                        '6months': 'Last 6 Months',
                        '1year': 'Last Year'
                    };
                    display.textContent = presetNames[range.preset] || 'Last 30 Days';
                }
            }

            filterDataByDateRange(data, dateField = 'date') {
                if (!state.dateRange) return data;
                
                const start = new Date(state.dateRange.start);
                const end = new Date(state.dateRange.end);
                end.setHours(23, 59, 59, 999); // Include entire end day
                
                return data.filter(item => {
                    const itemDate = new Date(item[dateField]);
                    return itemDate >= start && itemDate <= end;
                });
            }

            getComparisonData(data, dateField = 'date') {
                if (!state.compareMode || !state.dateRange) return null;
                
                const start = new Date(state.dateRange.start);
                const end = new Date(state.dateRange.end);
                const duration = end - start;
                
                const comparisonStart = new Date(start.getTime() - duration);
                const comparisonEnd = new Date(start);
                
                return data.filter(item => {
                    const itemDate = new Date(item[dateField]);
                    return itemDate >= comparisonStart && itemDate < comparisonEnd;
                });
            }

            refreshAnalytics() {
                this.renderAnalytics();
            }

            async handleAddCustomer(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const customerData = {
                        name: document.getElementById('customer-name').value,
                        email: document.getElementById('customer-email').value || '',
                        phone: document.getElementById('customer-phone').value || '',
                        address: document.getElementById('customer-address').value || '',
                        notes: document.getElementById('customer-notes').value || '',
                        createdAt: new Date().toISOString()
                    };
                    
                    await addDoc(firebaseService.getUserCollection('customers'), customerData);
                    await ActivityLogger.log('Customer Added', `Added customer: ${customerData.name}`);
                    
                    Utils.showToast('Customer added successfully', 'success');
                    document.getElementById('add-customer-modal').style.display = 'none';
                    document.getElementById('add-customer-form').reset();
                } catch (error) {
                    Utils.showToast('Failed to add customer: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async handleEditCustomer(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const customerId = document.getElementById('edit-customer-id').value;
                    const customerData = {
                        name: document.getElementById('edit-customer-name').value,
                        email: document.getElementById('edit-customer-email').value || '',
                        phone: document.getElementById('edit-customer-phone').value || '',
                        address: document.getElementById('edit-customer-address').value || '',
                        notes: document.getElementById('edit-customer-notes').value || '',
                        updatedAt: new Date().toISOString()
                    };
                    
                    await updateDoc(doc(firebaseService.getUserCollection('customers'), customerId), customerData);
                    await ActivityLogger.log('Customer Updated', `Updated customer: ${customerData.name}`);
                    
                    Utils.showToast('Customer updated successfully', 'success');
                    document.getElementById('edit-customer-modal').style.display = 'none';
                } catch (error) {
                    Utils.showToast('Failed to update customer: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            editCustomer(customerId) {
                const customer = state.allCustomers.find(c => c.id === customerId);
                if (!customer) return;
                
                document.getElementById('edit-customer-id').value = customer.id;
                document.getElementById('edit-customer-name').value = customer.name;
                document.getElementById('edit-customer-email').value = customer.email || '';
                document.getElementById('edit-customer-phone').value = customer.phone || '';
                document.getElementById('edit-customer-address').value = customer.address || '';
                document.getElementById('edit-customer-notes').value = customer.notes || '';
                
                document.getElementById('edit-customer-modal').style.display = 'block';
            }

            async deleteCustomer(customerId) {
                if (!confirm('Delete this customer? This will not delete their purchase history.')) return;
                
                Utils.showSpinner();
                try {
                    const customer = state.allCustomers.find(c => c.id === customerId);
                    await deleteDoc(doc(firebaseService.getUserCollection('customers'), customerId));
                    await ActivityLogger.log('Customer Deleted', `Deleted customer: ${customer?.name || 'Unknown'}`);
                    
                    Utils.showToast('Customer deleted successfully', 'success');
                } catch (error) {
                    Utils.showToast('Failed to delete customer: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            renderCustomers() {
                const section = document.getElementById('customers');
                const tbody = document.querySelector('#customers-table tbody');
                if (!tbody) return;

                const CUSTOMERS_PAGE_SIZE = 50;
                const page = parseInt(section?.dataset.customersPage || '0', 10);
                const search = document.getElementById('customer-search')?.value.toLowerCase() || '';
                let filtered = [...state.allCustomers];
                if (search) {
                    filtered = filtered.filter(c =>
                        c.name.toLowerCase().includes(search) ||
                        (c.email && c.email.toLowerCase().includes(search)) ||
                        (c.phone && c.phone.includes(search))
                    );
                }

                if (filtered.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="no-data">No customers found</td></tr>';
                    return;
                }

                const endIdx = Math.min((page + 1) * CUSTOMERS_PAGE_SIZE, filtered.length);
                const toShow = filtered.slice(0, endIdx);
                tbody.innerHTML = '';

                toShow.forEach(customer => {
                    const customerSales = state.allSales.filter(s => s.customer === customer.name);
                    const totalPurchases = customerSales.reduce((sum, s) => {
                        const subtotal = s.quantity * s.price;
                        const discounted = subtotal * (1 - (s.discount || 0) / 100);
                        return sum + discounted * (1 + (s.tax || 0) / 100);
                    }, 0);
                    
                    const lastPurchase = customerSales.length > 0
                        ? customerSales.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date
                        : 'Never';
                    
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${customer.name}</td>
                        <td>${customer.email || '-'}</td>
                        <td>${customer.phone || '-'}</td>
                        <td>${Utils.formatCurrency(totalPurchases)}</td>
                        <td>${lastPurchase}</td>
                        <td class="actions">
                            <button onclick="appController.viewCustomerSales('${customer.id}')" title="View Sales History"><i class="fas fa-list"></i></button>
                            <button onclick="appController.editCustomer('${customer.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                            <button class="danger" onclick="appController.deleteCustomer('${customer.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });

                if (endIdx < filtered.length && section) {
                    const loadRow = document.createElement('tr');
                    loadRow.innerHTML = `<td colspan="6" class="no-data" style="padding:1rem;">
                        <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('customers').dataset.customersPage = '${page + 1}'; appController.renderCustomers();">
                            <i class="fas fa-chevron-down"></i> Load more (${filtered.length - endIdx} remaining)
                        </button>
                    </td>`;
                    tbody.appendChild(loadRow);
                }
                if (section) section.dataset.customersPage = String(page);

                const creditSummaryEl = document.getElementById('customer-credit-summary');
                if (creditSummaryEl && window.customerCredit) {
                    creditSummaryEl.innerHTML = window.customerCredit.renderCreditWidget();
                }
            }

            /** Navigate to Sales section filtered by a specific customer, to highlight customer–sales relationship */
            viewCustomerSales(customerId) {
                const customer = state.allCustomers.find(c => c.id === customerId);
                if (!customer) {
                    Utils.showToast('Customer not found', 'error');
                    return;
                }
                const searchInput = document.getElementById('sales-customer-search');
                if (searchInput) {
                    searchInput.value = customer.name;
                }
                this.navigateToSection('sales');
                Utils.showToast(`Showing sales for ${customer.name}`, 'info');
            }

            renderDashboard() {
                // Use enhanced dashboard if available
                if (window.enhancedDashboard) {
                    window.enhancedDashboard.state = state;
                    window.enhancedDashboard.render();
                    return;
                }
                
                const period = document.getElementById('date-filter')?.value || 'all';
                const { start, end } = Utils.getDateRange(period);
                
                const filteredSales = state.allSales.filter(s => s.date >= start && s.date <= end);
                
                // ═══════════════════════════════════════════════════════════
                // CALCULATE METRICS BASED ON USER ROLE
                // ═══════════════════════════════════════════════════════════
                
                let salesTotal = 0;
                let expensesTotal = 0;
                let profit = 0;
                let totalCOGS = 0;
                
                // Calculate sales total
                salesTotal = filteredSales.reduce((sum, s) => {
                    const subtotal = s.quantity * s.price;
                    const discounted = subtotal * (1 - (s.discount || 0) / 100);
                    return sum + discounted * (1 + (s.tax || 0) / 100);
                }, 0);
                
                // Calculate COGS (Cost of Goods Sold)
                totalCOGS = filteredSales.reduce((sum, s) => {
                    const product = state.allProducts.find(p => p.name === s.product);
                    const cost = product ? product.cost : (s.cost || 0);
                    return sum + (s.quantity * cost);
                }, 0);
                
                if (state.userRole === 'outlet_manager') {
                    // ═══════════════════════════════════════════════════════════
                    // OUTLET MANAGER: Show outlet-specific metrics
                    // ═══════════════════════════════════════════════════════════
                    // Outlet managers typically don't manage expenses centrally
                    // Expenses are handled by main shop
                    expensesTotal = 0;
                    
                    // Profit for outlet = Sales Revenue - COGS
                    // (Commission is paid to main shop, not an expense for the outlet)
                    const grossProfit = salesTotal - totalCOGS;
                    profit = grossProfit;
                    
                    // Update metrics with outlet-specific labels
                    this.updateElement('total-sales', Utils.formatCurrency(salesTotal));
                    this.updateElement('label-id', 'Cost of Goods');
                    this.updateElement('total-expenses', Utils.formatCurrency(totalCOGS), 'Cost of Goods'); // Relabel as COGS
                    this.updateElement('net-profit', Utils.formatCurrency(profit));
                    
                    // Optional: Show commission info if available
                    const outlet = state.allOutlets[0];
                    if (outlet && outlet.commissionRate) {
                        const outletCommission = grossProfit * (outlet.commissionRate / 100);
                        const mainShopShare = grossProfit - outletCommission;
                        
                        // You could add additional metrics here:
                        this.updateElement('outlet-commission', Utils.formatCurrency(outletCommission));
                        this.updateElement('main-shop-share', Utils.formatCurrency(mainShopShare));
                    }
                    
                } else {
                    // ═══════════════════════════════════════════════════════════
                    // ADMIN: Show all metrics including expenses
                    // ═══════════════════════════════════════════════════════════
                    const filteredExpenses = state.allExpenses.filter(e => e.date >= start && e.date <= end);
                    expensesTotal = filteredExpenses
                        .filter(e => !this.isDebtPayment(e))
                        .reduce((sum, e) => sum + e.amount, 0);
                    
                    // Profit = Revenue - COGS - Operating Expenses (debt payments are balance sheet, not P&L)
                    profit = salesTotal - totalCOGS - expensesTotal;
                    
                    this.updateElement('total-sales', Utils.formatCurrency(salesTotal));
                    this.updateElement('total-expenses', Utils.formatCurrency(expensesTotal));
                    this.updateElement('net-profit', Utils.formatCurrency(profit));
                }
                
                // ═══════════════════════════════════════════════════════════
                // PERIOD-BASED PROFIT CALCULATIONS
                // ═══════════════════════════════════════════════════════════
                ['day', 'week', 'month', 'quarter', 'year'].forEach(p => {
                    this.updateElement(`${p}ly-profit`, Utils.formatCurrency(this.getProfitForPeriod(p)));
                });
                
                // ═══════════════════════════════════════════════════════════
                // GROSS MARGIN
                // ═══════════════════════════════════════════════════════════
                const totalRevenue = salesTotal;
                const grossMargin = totalRevenue > 0 
                    ? ((totalRevenue - totalCOGS) / totalRevenue * 100).toFixed(1) 
                    : 0;
                this.updateElement('gross-margin', `${grossMargin}%`);
                
                // ═══════════════════════════════════════════════════════════
                // INVENTORY METRICS
                // ═══════════════════════════════════════════════════════════
                const inventoryValue = state.allProducts.reduce((sum, p) => 
                    sum + p.quantity * p.cost, 0);
                this.updateElement('inventory-value', Utils.formatCurrency(inventoryValue));
                
                const totalQtySold = filteredSales.reduce((sum, s) => sum + s.quantity, 0);
                const avgInventory = state.allProducts.reduce((sum, p) => sum + p.quantity, 0);
                const turnover = avgInventory > 0 ? (totalQtySold / avgInventory).toFixed(1) : 0;
                this.updateElement('turnover', `${turnover}x`);
                
                // ═══════════════════════════════════════════════════════════
                // CUSTOMER METRICS
                // ═══════════════════════════════════════════════════════════
                const customerPurchases = {};
                filteredSales.forEach(s => {
                    customerPurchases[s.customer] = (customerPurchases[s.customer] || 0) + 1;
                });
                const repeatCustomers = Object.values(customerPurchases).filter(c => c > 1).length;
                const totalCustomers = Object.keys(customerPurchases).length;
                const repeatRate = totalCustomers > 0 ? ((repeatCustomers / totalCustomers) * 100).toFixed(1) : 0;
                this.updateElement('repeat-rate', `${repeatRate}%`);
                
                // ═══════════════════════════════════════════════════════════
                // RENDER WIDGETS
                // ═══════════════════════════════════════════════════════════
                this.renderBestProducts(filteredSales);
                this.renderTopCustomers(filteredSales);
                this.renderRecentActivity();
                this.renderRecentSalesWidget();
                this.renderProductPerformanceChart();
                
                // ═══════════════════════════════════════════════════════════
                // RENDER ENHANCED WIDGETS (Priority 1, 2, 3)
                // ═══════════════════════════════════════════════════════════
                this.renderStockAlertsWidget();
                this.renderCustomerCreditWidget();
                this.renderProfitQuickView();
                
                if (window.stockAlerts) {
                    window.stockAlerts.checkAndNotify();
                }

                if (window.emailService) {
                    (async () => {
                        try {
                            const settingsDoc = await getDoc(firebaseService.settingsRef());
                            if (settingsDoc.exists()) {
                                const settings = settingsDoc.data();
                                if (settings.emailNotifications && settings.notificationEmail) {
                                    const lowStock = (window.stockAlerts?.getLowStockProducts() || []);
                                    const outOfStock = (window.stockAlerts?.getOutOfStockProducts() || []);
                                    if (lowStock.length > 0 || outOfStock.length > 0) {
                                        window.emailService.sendLowStockAlert(
                                            [...outOfStock, ...lowStock],
                                            settings.notificationEmail
                                        ).catch(err => console.log('Email notification skipped:', err.message));
                                    }
                                }
                            }
                        } catch (err) { console.log('Email service check skipped:', err.message); }
                    })();
                }
                
                // Auto-prompt to create PO when out-of-stock products exist
                this.showOutOfStockPOPrompt();
                
                console.log('✅ Dashboard rendered successfully');
            }

            getProfitForPeriod(period) {
                const { start, end } = Utils.getDateRange(period);
                const filteredSales = state.allSales.filter(s => s.date >= start && s.date <= end);
                
                const salesTotal = filteredSales.reduce((sum, s) => {
                    const subtotal = s.quantity * s.price;
                    const discounted = subtotal * (1 - (s.discount || 0) / 100);
                    return sum + discounted * (1 + (s.tax || 0) / 100);
                }, 0);
                
                const totalCOGS = filteredSales.reduce((sum, s) => {
                    const product = state.allProducts.find(p => p.name === s.product);
                    const cost = product ? product.cost : (s.cost || 0);
                    return sum + (s.quantity * cost);
                }, 0);
                
                let profit = 0;
                
                if (state.userRole === 'outlet_manager') {
                    // OUTLET MANAGER: Profit = Revenue - COGS (no expenses)
                    profit = salesTotal - totalCOGS;
                } else {
                    // ADMIN: Profit = Revenue - COGS - Operating Expenses (excludes debt payments)
                    const filteredExpenses = state.allExpenses.filter(e => e.date >= start && e.date <= end && !this.isDebtPayment(e));
                    const expensesTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
                    profit = salesTotal - totalCOGS - expensesTotal;
                }
                
                return profit;
            }

            renderBestProducts(sales) {
                const productStats = {};
                
                sales.forEach(sale => {
                    const product = state.allProducts.find(p => p.name === sale.product);
                    const cost = product ? product.cost : 0;
                    
                    if (!productStats[sale.product]) {
                        productStats[sale.product] = { quantity: 0, revenue: 0, cost: 0 };
                    }
                    
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const total = discounted * (1 + (sale.tax || 0) / 100);
                    
                    productStats[sale.product].quantity += sale.quantity;
                    productStats[sale.product].revenue += total;
                    productStats[sale.product].cost += sale.quantity * cost;
                });
                
                const sorted = Object.entries(productStats)
                    .sort((a, b) => b[1].quantity - a[1].quantity)
                    .slice(0, 5);
                
                const html = sorted.map(([name, data]) => {
                    const profit = data.revenue - data.cost;
                    return `
                        <li>
                            <strong>${name}</strong><br>
                            <small>
                                Qty: ${data.quantity} | 
                                Revenue: ${Utils.formatCurrency(data.revenue)} | 
                                Profit: <span style="color:${profit >= 0 ? 'green' : 'red'}">
                                    ${Utils.formatCurrency(profit)}
                                </span>
                            </small>
                        </li>
                    `;
                }).join('');
                
                this.updateElement('best-products', html || '<li>No data</li>', true);
            }

            renderTopCustomers(sales) {
                const customerSpend = {};
                
                sales.forEach(s => {
                    const subtotal = s.quantity * s.price;
                    const discounted = subtotal * (1 - (s.discount || 0) / 100);
                    const total = discounted * (1 + (s.tax || 0) / 100);
                    customerSpend[s.customer] = (customerSpend[s.customer] || 0) + total;
                });
                
                const sorted = Object.entries(customerSpend)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5);
                
                const html = sorted.map(([name, spend]) => 
                    `<li>${name}: ${Utils.formatCurrency(spend)}</li>`
                ).join('');
                
                this.updateElement('top-customers', html || '<li>No data</li>', true);
            }

            renderRecentActivity() {
                const activities = [];
                
                state.allSales.slice(0, 20).forEach(sale => {
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const total = discounted * (1 + (sale.tax || 0) / 100);
                    activities.push({
                        date: sale.date,
                        type: 'Sale',
                        description: `${sale.quantity}x ${sale.product} to ${sale.customer}`,
                        amount: total
                    });
                });
                
                state.allExpenses.slice(0, 20).forEach(exp => {
                    activities.push({
                        date: exp.date,
                        type: 'Expense',
                        description: exp.description,
                        amount: -exp.amount
                    });
                });
                
                activities.sort((a, b) => new Date(b.date) - new Date(a.date));
                
                const tbody = document.querySelector('#recent-activity tbody');
                if (tbody) {
                    tbody.innerHTML = activities.slice(0, 10).map(act => `
                        <tr>
                            <td>${act.date}</td>
                            <td>${act.type}</td>
                            <td>${act.description}</td>
                            <td style="color: ${act.amount >= 0 ? 'green' : 'red'}">
                                ${Utils.formatCurrency(act.amount)}
                            </td>
                        </tr>
                    `).join('');
                }
            }

            renderRecentSalesWidget() {
                const container = document.getElementById('recent-sales-widget');
                if (!container) return;
                
                const recentSales = [...state.allSales]
                    .sort((a, b) => new Date(b.date) - new Date(a.date))
                    .slice(0, 10);
                
                if (recentSales.length === 0) {
                    container.innerHTML = '<div class="no-data">No recent sales</div>';
                    return;
                }
                
                container.innerHTML = recentSales.map(sale => {
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const total = discounted * (1 + (sale.tax || 0) / 100);
                    
                    return `
                        <div class="widget-item" onclick="appController.navigateToSection('sales');" style="cursor: pointer;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong>${sale.customer}</strong>
                                    <br>
                                    <small style="color: #666;">${sale.product} (${sale.quantity}x) - ${sale.date}</small>
                                </div>
                                <div style="text-align: right;">
                                    <strong style="color: #28a745;">${Utils.formatCurrency(total)}</strong>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            renderProductPerformanceChart() {
                const canvas = document.getElementById('product-performance-chart');
                if (!canvas) return;
                
                if (state.charts.productPerformance) {
                    state.charts.productPerformance.destroy();
                }
                
                const productSales = {};
                
                state.allSales.forEach(sale => {
                    if (!productSales[sale.product]) {
                        productSales[sale.product] = 0;
                    }
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    productSales[sale.product] += discounted * (1 + (sale.tax || 0) / 100);
                });
                
                const sorted = Object.entries(productSales)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5);
                
                if (sorted.length === 0) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.font = '14px Roboto';
                    ctx.fillStyle = '#888';
                    ctx.textAlign = 'center';
                    ctx.fillText('No sales data available', canvas.width / 2, canvas.height / 2);
                    return;
                }
                
                const ctx = canvas.getContext('2d');
                state.charts.productPerformance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: sorted.map(([name]) => name),
                        datasets: [{
                            label: 'Revenue',
                            data: sorted.map(([, revenue]) => revenue),
                            backgroundColor: [
                                '#007bff',
                                '#28a745',
                                '#ffc107',
                                '#17a2b8',
                                '#6f42c1'
                            ]
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        indexAxis: 'y',
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => Utils.formatCurrency(context.parsed.x)
                                }
                            }
                        },
                        scales: {
                            x: {
                                beginAtZero: true,
                                ticks: {
                                    callback: (value) => Utils.formatCurrency(value)
                                }
                            }
                        }
                    }
                });
            }

            // ═══════════════════════════════════════════════════════════
            // ENHANCED DASHBOARD WIDGETS (Priority 1, 2, 3)
            // ═══════════════════════════════════════════════════════════
            
            renderStockAlertsWidget() {
                const container = document.getElementById('stock-alerts-widget');
                if (!container || !window.stockAlerts) return;
                
                container.innerHTML = window.stockAlerts.renderAlertsWidget();
            }
            
            renderCustomerCreditWidget() {
                const container = document.getElementById('customer-credit-widget');
                if (!container || !window.customerCredit) return;
                
                container.innerHTML = window.customerCredit.renderCreditWidget();
            }
            
            renderProfitQuickView() {
                const container = document.getElementById('profit-quick-view');
                if (!container || !window.profitAnalysis) return;
                
                const period = document.getElementById('date-filter')?.value || 'all';
                const { start, end } = Utils.getDateRange(period);
                const dateRange = { start, end };
                const summary = window.profitAnalysis.getOverallSummary(dateRange);
                
                container.innerHTML = `
                    <div class="profit-quick-grid">
                        <div class="pq-item" onclick="appController.showProfitAnalysis()">
                            <span class="label">Gross Margin</span>
                            <span class="value">${summary.grossMargin}%</span>
                        </div>
                        <div class="pq-item ${summary.netProfit >= 0 ? 'positive' : 'negative'}" onclick="appController.showProfitAnalysis()">
                            <span class="label">Net Profit</span>
                            <span class="value">${Utils.formatCurrency(summary.netProfit)}</span>
                        </div>
                    </div>
                `;
            }
            
            // Open sale modal with pre-selected product (for barcode scanner)
            openSaleModalWithProduct(product) {
                // Set today's date
                const saleDate = document.getElementById('sale-date');
                if (saleDate) {
                    saleDate.value = new Date().toISOString().split('T')[0];
                }
                
                // Pre-fill product
                document.getElementById('sale-product').value = product.id;
                document.getElementById('sale-product-search').value = product.name;
                document.getElementById('sale-price').value = product.price;
                document.getElementById('sale-quantity').value = 1;
                
                // Show product info
                const productInfo = document.getElementById('sale-product-info');
                if (productInfo) {
                    productInfo.style.display = 'block';
                    document.getElementById('selected-product-name').textContent = product.name;
                    document.getElementById('selected-product-stock').textContent = product.quantity;
                    document.getElementById('selected-product-price').textContent = Utils.formatCurrency(product.price);
                }
                
                // Show modal
                document.getElementById('add-sale-modal').style.display = 'block';
                
                // Update total
                this.updateSaleTotal();
            }
            
            /** Open Create PO modal with one or more products pre-filled (from stock alerts or out-of-stock prompt) */
            openCreatePOForProduct(productId) {
                this.openCreatePOForProducts([productId]);
            }

            openCreatePOForProducts(productIds) {
                if (state.userRole !== 'admin') {
                    Utils.showToast('Only administrators can create purchase orders from stock alerts', 'warning');
                    return;
                }
                if (!productIds || productIds.length === 0) {
                    this.setupCreatePOModal();
                    return;
                }
                const validIds = productIds.filter(id => state.allProducts.some(p => p.id === id));
                if (validIds.length === 0) {
                    Utils.showToast('Products not found', 'error');
                    return;
                }
                this.setupCreatePOModal(validIds);
                Utils.showToast(`Creating PO for ${validIds.length} product(s)`, 'info');
            }

            /** Show prompt modal when out-of-stock products exist - offers to create PO (admin only, once per stock state) */
            showOutOfStockPOPrompt() {
                if (state.userRole !== 'admin') return;

                const outOfStock = state.allProducts.filter(p => (parseFloat(p.quantity) || 0) <= 0);
                const lowStock = state.allProducts.filter(p => {
                    const qty = parseFloat(p.quantity) || 0;
                    const min = parseFloat(p.minStock) || 10;
                    return qty > 0 && qty <= min;
                });
                const productsToPrompt = [...outOfStock, ...lowStock];
                if (productsToPrompt.length === 0) {
                    this._lastOutOfStockIds = null;
                    return;
                }

                // Only prompt again when the out-of-stock set actually changes
                const currentOutIds = outOfStock.map(p => p.id).sort().join('|');
                if (this._lastOutOfStockIds === currentOutIds) {
                    return;
                }
                this._lastOutOfStockIds = currentOutIds;

                const modalId = 'out-of-stock-po-prompt-modal';
                let modal = document.getElementById(modalId);
                if (modal) {
                    modal.style.display = 'block';
                    return;
                }

                modal = document.createElement('div');
                modal.id = modalId;
                modal.className = 'modal';
                modal.style.display = 'block';
                const productIds = productsToPrompt.map(p => p.id);
                modal.innerHTML = `
                    <div class="modal-content modal-md">
                        <span class="close" onclick="document.getElementById('${modalId}').style.display='none'">&times;</span>
                        <h3><i class="fas fa-exclamation-triangle" style="color: #ffc107;"></i> Stock Alert</h3>
                        <p style="margin: 1rem 0; color: #666;">
                            ${outOfStock.length > 0 
                                ? `<strong>${outOfStock.length}</strong> product(s) out of stock` 
                                : ''}
                            ${outOfStock.length > 0 && lowStock.length > 0 ? ' and ' : ''}
                            ${lowStock.length > 0 
                                ? `<strong>${lowStock.length}</strong> product(s) running low` 
                                : ''}.
                            Create a purchase order to restock?
                        </p>
                        <div style="max-height: 200px; overflow-y: auto; margin: 1rem 0; padding: 0.75rem; background: #f8f9fa; border-radius: 8px;">
                            <table style="width: 100%; font-size: 0.9rem;">
                                <thead><tr><th>Product</th><th>Stock</th><th>Min</th></tr></thead>
                                <tbody>
                                    ${productsToPrompt.map(p => `
                                        <tr>
                                            <td><strong>${p.name}</strong></td>
                                            <td class="${(parseFloat(p.quantity) || 0) <= 0 ? 'text-danger' : 'text-warning'}">${p.quantity || 0}</td>
                                            <td>${p.minStock || 10}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div style="display: flex; gap: 0.75rem; margin-top: 1rem;">
                            <button type="button" onclick="appController.openCreatePOForProducts([${productIds.map(id => `'${id}'`).join(',')}]); document.getElementById('${modalId}').style.display='none';" style="flex: 1; background: #28a745;">
                                <i class="fas fa-shopping-cart"></i> Create Purchase Order
                            </button>
                            <button type="button" onclick="document.getElementById('${modalId}').style.display='none'" style="flex: 1;">
                                Dismiss
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            
            // Show profit analysis section
            showProfitAnalysis() {
                if (!window.profitAnalysis) return;
                
                // Create modal for profit analysis
                let modal = document.getElementById('profit-analysis-modal');
                if (!modal) {
                    modal = document.createElement('div');
                    modal.id = 'profit-analysis-modal';
                    modal.className = 'modal';
                    modal.innerHTML = `
                        <div class="modal-content" style="max-width: 1200px; max-height: 90vh; overflow-y: auto;">
                            <span class="close" onclick="document.getElementById('profit-analysis-modal').style.display='none'">&times;</span>
                            <h3><i class="fas fa-chart-pie"></i> Profit Analysis</h3>
                            <p style="color: #666; font-size: 0.9rem; margin-bottom: 1rem;">Totals for the selected period (matches dashboard date filter).</p>
                            <div id="profit-analysis-content"></div>
                            <div style="margin-top: 1rem; text-align: right;">
                                <button onclick="window.profitAnalysis.exportToCSV()" style="background: #28a745;">
                                    <i class="fas fa-download"></i> Export to CSV
                                </button>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(modal);
                }
                
                const period = document.getElementById('date-filter')?.value || 'all';
                const { start, end } = Utils.getDateRange(period);
                const dateRange = { start, end };
                document.getElementById('profit-analysis-content').innerHTML = window.profitAnalysis.renderProfitDashboard(dateRange);
                modal.style.display = 'block';
            }
            
            // Show returns modal for a sale
            showReturnModal(saleId) {
                if (window.salesReturns) {
                    window.salesReturns.renderReturnModal(saleId);
                }
            }
            
            // Show customer payment modal
            showCustomerPaymentModal(customerId) {
                if (window.customerCredit) {
                    const modalHtml = window.customerCredit.renderPaymentModal(customerId);
                    const container = document.createElement('div');
                    container.innerHTML = modalHtml;
                    document.body.appendChild(container.firstElementChild);
                }
            }
            
            // Show stock transfer modal
            showStockTransferModal() {
                if (window.stockTransfer) {
                    window.stockTransfer.renderTransferModal();
                }
            }
            
            // Show PDF export modal
            showPDFExportModal() {
                if (state.userRole === 'outlet_manager') {
                    Utils.showToast('Quick Export is restricted to administrators', 'warning');
                    return;
                }
                if (window.pdfExport) {
                    window.pdfExport.showExportModal();
                }
            }
            
            renderReports() {
                const quickPeriod = document.getElementById('reports-quick-period');
                if (quickPeriod && !quickPeriod._bound) {
                    quickPeriod._bound = true;
                    quickPeriod.addEventListener('change', () => {
                        const val = quickPeriod.value;
                        if (!val) return;
                        const startInput = document.getElementById('reports-start-date');
                        const endInput = document.getElementById('reports-end-date');
                        const today = new Date();
                        const fmt = d => d.toISOString().split('T')[0];
                        endInput.value = fmt(today);

                        if (val === 'today') { startInput.value = fmt(today); }
                        else if (val === 'week') { const d = new Date(today); d.setDate(d.getDate() - 7); startInput.value = fmt(d); }
                        else if (val === 'month') { const d = new Date(today); d.setMonth(d.getMonth() - 1); startInput.value = fmt(d); }
                        else if (val === 'quarter') { const d = new Date(today); d.setMonth(d.getMonth() - 3); startInput.value = fmt(d); }
                        else if (val === 'year') { const d = new Date(today); d.setFullYear(d.getFullYear() - 1); startInput.value = fmt(d); }
                        else if (val === 'all') { startInput.value = ''; endInput.value = ''; }
                    });
                }
            }

            getReportDateRange() {
                return {
                    start: document.getElementById('reports-start-date')?.value || '',
                    end: document.getElementById('reports-end-date')?.value || ''
                };
            }

            async generateReport(type, format) {
                const dateRange = this.getReportDateRange();

                try {
                    switch (type) {
                        case 'sales':
                            if (format === 'pdf') window.pdfExport?.generateSalesReport(dateRange);
                            else if (format === 'csv') window.exportService?.exportSalesReport(dateRange.start, dateRange.end);
                            else if (format === 'excel') window.exportService?.exportComprehensiveReport(dateRange.start || '2000-01-01', dateRange.end || '2099-12-31');
                            break;
                        case 'inventory':
                            if (format === 'pdf') window.pdfExport?.generateInventoryReport(dateRange);
                            else if (format === 'csv') window.exportService?.exportInventoryReport();
                            break;
                        case 'financial':
                            if (format === 'pdf') window.pdfExport?.generateFinancialStatement(dateRange);
                            else if (format === 'csv') {
                                const fData = this._buildFinancialCSVData(dateRange);
                                window.exportService?.exportToCSV(fData, `financial-statement-${new Date().toISOString().split('T')[0]}.csv`);
                            }
                            break;
                        case 'pnl':
                            if (format === 'pdf') window.pdfExport?.generateProfitLossReport(dateRange);
                            break;
                        case 'expenses':
                            if (format === 'pdf') window.pdfExport?.generateExpensesReport(dateRange);
                            else if (format === 'csv') window.exportService?.exportExpensesReport(dateRange.start, dateRange.end);
                            break;
                        case 'cashflow':
                            if (format === 'pdf') window.pdfExport?.generateCashFlowReport(dateRange);
                            break;
                        case 'tax':
                            if (format === 'pdf') window.pdfExport?.generateTaxReport(dateRange);
                            break;
                        case 'ar-aging':
                            if (format === 'pdf') window.pdfExport?.generateARAgingReport();
                            break;
                        case 'stock-valuation':
                            if (format === 'pdf') window.pdfExport?.generateStockValuationReport();
                            break;
                        case 'customers':
                            if (format === 'csv') window.exportService?.exportCustomersReport();
                            break;
                        case 'comprehensive':
                            if (format === 'excel') window.exportService?.exportComprehensiveReport(dateRange.start || '2000-01-01', dateRange.end || '2099-12-31');
                            break;
                        case 'period-comparison':
                            await this.showPeriodComparison();
                            break;
                        default:
                            Utils.showToast('Unknown report type', 'warning');
                    }
                } catch (err) {
                    console.error('Report generation error:', err);
                    Utils.showToast('Failed to generate report: ' + err.message, 'error');
                }
            }

            _buildFinancialCSVData(dateRange) {
                let sales = [...state.allSales];
                let expenses = [...state.allExpenses];
                if (dateRange.start) { sales = sales.filter(s => s.date >= dateRange.start); expenses = expenses.filter(e => e.date >= dateRange.start); }
                if (dateRange.end) { sales = sales.filter(s => s.date <= dateRange.end); expenses = expenses.filter(e => e.date <= dateRange.end); }

                const revenue = sales.reduce((s, sl) => {
                    const t = parseFloat(sl.total);
                    return s + (isNaN(t) ? (parseFloat(sl.quantity) || 0) * (parseFloat(sl.price) || 0) : t);
                }, 0);
                const cogs = sales.reduce((s, sl) => {
                    const p = state.allProducts.find(pr => pr.id === sl.productId || pr.name === sl.product);
                    return s + ((parseFloat(p?.cost) || 0) * (parseInt(sl.quantity) || 0));
                }, 0);
                const totalExp = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

                return [
                    { Line: 'Revenue', Amount: revenue.toFixed(2) },
                    { Line: 'Cost of Goods Sold', Amount: cogs.toFixed(2) },
                    { Line: 'Gross Profit', Amount: (revenue - cogs).toFixed(2) },
                    { Line: 'Total Expenses', Amount: totalExp.toFixed(2) },
                    { Line: 'Net Profit', Amount: (revenue - cogs - totalExp).toFixed(2) },
                ];
            }

            async showPeriodComparison() {
                const dateRange = this.getReportDateRange();
                if (!dateRange.start || !dateRange.end) {
                    Utils.showToast('Select start and end dates for period comparison', 'warning');
                    return;
                }

                const container = document.getElementById('period-comparison-results');
                const content = document.getElementById('period-comparison-content');
                if (!container || !content) return;

                container.style.display = 'block';
                content.innerHTML = '<p style="color:#8899a6;"><i class="fas fa-spinner fa-spin"></i> Computing comparison...</p>';

                try {
                    const BACKEND_URL = window.BACKEND_URL || '';
                    const resp = await fetch(`${BACKEND_URL}/api/reports/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            report_type: 'period_comparison',
                            sales_data: state.allSales,
                            expenses_data: state.allExpenses,
                            date_start: dateRange.start,
                            date_end: dateRange.end,
                        })
                    });

                    if (!resp.ok) throw new Error('Backend returned ' + resp.status);
                    const result = await resp.json();
                    const d = result.data;

                    if (d.error) { content.innerHTML = `<p style="color:#dc3545;">${d.error}</p>`; return; }

                    const arrow = (pct) => pct > 0 ? `<span style="color:#28a745;">+${pct}% <i class="fas fa-arrow-up"></i></span>` : pct < 0 ? `<span style="color:#dc3545;">${pct}% <i class="fas fa-arrow-down"></i></span>` : `<span style="color:#8899a6;">0%</span>`;

                    content.innerHTML = `
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem;" class="comparison-grid">
                            <div style="padding:1rem;background:rgba(0,123,255,0.08);border-radius:8px;">
                                <h4 style="margin-bottom:0.5rem;">Current Period</h4>
                                <p style="font-size:0.85rem;color:#8899a6;">${d.current_period.start} to ${d.current_period.end}</p>
                                <p>Revenue: <strong>${Utils.formatCurrency(d.current_period.revenue)}</strong></p>
                                <p>Expenses: <strong>${Utils.formatCurrency(d.current_period.expenses)}</strong></p>
                                <p>Profit: <strong style="color:${d.current_period.profit >= 0 ? '#28a745' : '#dc3545'};">${Utils.formatCurrency(d.current_period.profit)}</strong></p>
                                <p>Transactions: <strong>${d.current_period.transaction_count}</strong></p>
                            </div>
                            <div style="padding:1rem;background:rgba(108,117,125,0.08);border-radius:8px;">
                                <h4 style="margin-bottom:0.5rem;">Previous Period</h4>
                                <p style="font-size:0.85rem;color:#8899a6;">${d.previous_period.start} to ${d.previous_period.end}</p>
                                <p>Revenue: <strong>${Utils.formatCurrency(d.previous_period.revenue)}</strong></p>
                                <p>Expenses: <strong>${Utils.formatCurrency(d.previous_period.expenses)}</strong></p>
                                <p>Profit: <strong style="color:${d.previous_period.profit >= 0 ? '#28a745' : '#dc3545'};">${Utils.formatCurrency(d.previous_period.profit)}</strong></p>
                                <p>Transactions: <strong>${d.previous_period.transaction_count}</strong></p>
                            </div>
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem;margin-top:1rem;" class="comparison-changes">
                            <div style="text-align:center;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;">
                                <div style="font-size:0.8rem;color:#8899a6;">Revenue</div>
                                <div style="font-size:1.1rem;font-weight:bold;">${arrow(d.changes.revenue_pct)}</div>
                            </div>
                            <div style="text-align:center;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;">
                                <div style="font-size:0.8rem;color:#8899a6;">Expenses</div>
                                <div style="font-size:1.1rem;font-weight:bold;">${arrow(d.changes.expenses_pct)}</div>
                            </div>
                            <div style="text-align:center;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;">
                                <div style="font-size:0.8rem;color:#8899a6;">Profit</div>
                                <div style="font-size:1.1rem;font-weight:bold;">${arrow(d.changes.profit_pct)}</div>
                            </div>
                            <div style="text-align:center;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;">
                                <div style="font-size:0.8rem;color:#8899a6;">Transactions</div>
                                <div style="font-size:1.1rem;font-weight:bold;">${arrow(d.changes.transactions_pct)}</div>
                            </div>
                        </div>
                    `;
                } catch (err) {
                    console.warn('Backend comparison failed, computing client-side:', err);
                    this._clientSidePeriodComparison(content, dateRange);
                }
            }

            _clientSidePeriodComparison(content, dateRange) {
                const sDate = new Date(dateRange.start);
                const eDate = new Date(dateRange.end);
                const days = Math.floor((eDate - sDate) / (1000 * 60 * 60 * 24));
                const prevEnd = new Date(sDate); prevEnd.setDate(prevEnd.getDate() - 1);
                const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days);

                const fmt = d => d.toISOString().split('T')[0];
                const calc = (s, e) => {
                    const fs = state.allSales.filter(sl => sl.date >= s && sl.date <= e);
                    const fe = state.allExpenses.filter(ex => ex.date >= s && ex.date <= e);
                    const rev = fs.reduce((sum, sl) => { const t = parseFloat(sl.total); return sum + (isNaN(t) ? (parseFloat(sl.quantity) || 0) * (parseFloat(sl.price) || 0) : t); }, 0);
                    const exp = fe.reduce((sum, ex) => sum + (parseFloat(ex.amount) || 0), 0);
                    return { revenue: rev, expenses: exp, profit: rev - exp, transactions: fs.length };
                };

                const cur = calc(dateRange.start, dateRange.end);
                const prev = calc(fmt(prevStart), fmt(prevEnd));
                const pct = (c, p) => p === 0 ? (c > 0 ? 100 : 0) : Math.round((c - p) / Math.abs(p) * 100 * 10) / 10;
                const arrow = (v) => v > 0 ? `<span style="color:#28a745;">+${v}% <i class="fas fa-arrow-up"></i></span>` : v < 0 ? `<span style="color:#dc3545;">${v}% <i class="fas fa-arrow-down"></i></span>` : `<span style="color:#8899a6;">0%</span>`;

                content.innerHTML = `
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem;" class="comparison-grid">
                        <div style="padding:1rem;background:rgba(0,123,255,0.08);border-radius:8px;">
                            <h4>Current Period</h4><p style="font-size:0.85rem;color:#8899a6;">${dateRange.start} to ${dateRange.end}</p>
                            <p>Revenue: <strong>${Utils.formatCurrency(cur.revenue)}</strong></p>
                            <p>Expenses: <strong>${Utils.formatCurrency(cur.expenses)}</strong></p>
                            <p>Profit: <strong style="color:${cur.profit>=0?'#28a745':'#dc3545'};">${Utils.formatCurrency(cur.profit)}</strong></p>
                            <p>Transactions: <strong>${cur.transactions}</strong></p>
                        </div>
                        <div style="padding:1rem;background:rgba(108,117,125,0.08);border-radius:8px;">
                            <h4>Previous Period</h4><p style="font-size:0.85rem;color:#8899a6;">${fmt(prevStart)} to ${fmt(prevEnd)}</p>
                            <p>Revenue: <strong>${Utils.formatCurrency(prev.revenue)}</strong></p>
                            <p>Expenses: <strong>${Utils.formatCurrency(prev.expenses)}</strong></p>
                            <p>Profit: <strong style="color:${prev.profit>=0?'#28a745':'#dc3545'};">${Utils.formatCurrency(prev.profit)}</strong></p>
                            <p>Transactions: <strong>${prev.transactions}</strong></p>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem;margin-top:1rem;" class="comparison-changes">
                        <div style="text-align:center;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;"><div style="font-size:0.8rem;color:#8899a6;">Revenue</div><div style="font-size:1.1rem;font-weight:bold;">${arrow(pct(cur.revenue,prev.revenue))}</div></div>
                        <div style="text-align:center;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;"><div style="font-size:0.8rem;color:#8899a6;">Expenses</div><div style="font-size:1.1rem;font-weight:bold;">${arrow(pct(cur.expenses,prev.expenses))}</div></div>
                        <div style="text-align:center;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;"><div style="font-size:0.8rem;color:#8899a6;">Profit</div><div style="font-size:1.1rem;font-weight:bold;">${arrow(pct(cur.profit,prev.profit))}</div></div>
                        <div style="text-align:center;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;"><div style="font-size:0.8rem;color:#8899a6;">Transactions</div><div style="font-size:1.1rem;font-weight:bold;">${arrow(pct(cur.transactions,prev.transactions))}</div></div>
                    </div>
                `;
            }

            showRecurringExpensesModal() {
                if (window.recurringExpenses) {
                    window.recurringExpenses.renderAddModal();
                }
            }
            
            // Show barcode scanner modal
            showBarcodeScanner() {
                if (window.barcodeScanner) {
                    window.barcodeScanner.showScannerModal();
                }
            }

            renderTopProductsChart(filteredSales) {
                const canvas = document.getElementById('top-products-chart');
                if (!canvas) return;
                
                console.log('Rendering Top Products chart');
                
                // Calculate revenue by product
                const productRevenue = {};
                
                filteredSales.forEach(sale => {
                    if (!productRevenue[sale.product]) {
                        productRevenue[sale.product] = 0;
                    }
                    
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const total = discounted * (1 + (sale.tax || 0) / 100);
                    
                    productRevenue[sale.product] += total;
                });
                
                // Get top 10 products
                const sortedProducts = Object.entries(productRevenue)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10);
                
                const labels = sortedProducts.map(p => p[0]);
                const data = sortedProducts.map(p => p[1]);
                
                if (this.charts['top-products']) {
                    this.charts['top-products'].destroy();
                }
                
                this.charts['top-products'] = new Chart(canvas, {
                    type: 'horizontalBar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Revenue',
                            data: data,
                            backgroundColor: 'rgba(75, 192, 192, 0.6)',
                            borderColor: 'rgba(75, 192, 192, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            title: {
                                display: true,
                                text: 'Top 10 Products by Revenue'
                            },
                            legend: {
                                display: false
                            }
                        },
                        scales: {
                            x: {
                                beginAtZero: true,
                                ticks: {
                                    callback: function(value) {
                                        return 'GH₵' + value.toLocaleString();
                                    }
                                }
                            }
                        }
                    }
                });
            }

            renderDailyRevenueChart() {
                const canvas = document.getElementById('daily-revenue-chart');
                if (!canvas) return;
                
                if (state.charts.dailyRevenue) {
                    state.charts.dailyRevenue.destroy();
                }
                
                // Filter sales by date range
                const filteredSales = this.filterDataByDateRange(state.allSales);
                const comparisonSales = this.getComparisonData(state.allSales);
                
                // Group by date
                const revenueByDate = {};
                filteredSales.forEach(sale => {
                    const date = sale.date;
                    if (!revenueByDate[date]) revenueByDate[date] = 0;
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    revenueByDate[date] += discounted * (1 + (sale.tax || 0) / 100);
                });
                
                const dates = Object.keys(revenueByDate).sort();
                const revenues = dates.map(date => revenueByDate[date]);
                
                const datasets = [{
                    label: 'Current Period',
                    data: revenues,
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    tension: 0.4,
                    fill: true
                }];
                
                // Add comparison dataset if enabled
                if (comparisonSales && state.compareMode) {
                    const comparisonByDate = {};
                    comparisonSales.forEach(sale => {
                        const date = sale.date;
                        if (!comparisonByDate[date]) comparisonByDate[date] = 0;
                        const subtotal = sale.quantity * sale.price;
                        const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                        comparisonByDate[date] += discounted * (1 + (sale.tax || 0) / 100);
                    });
                    
                    const comparisonDates = Object.keys(comparisonByDate).sort();
                    const comparisonRevenues = comparisonDates.map(date => comparisonByDate[date]);
                    
                    datasets.push({
                        label: 'Previous Period',
                        data: comparisonRevenues,
                        borderColor: '#6c757d',
                        backgroundColor: 'rgba(108, 117, 125, 0.1)',
                        borderDash: [5, 5],
                        tension: 0.4,
                        fill: true
                    });
                }
                
                const ctx = canvas.getContext('2d');
                state.charts.dailyRevenue = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: dates.map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
                        datasets: datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            title: {
                                display: true,
                                text: state.compareMode ? 'Revenue Comparison' : 'Daily Revenue Trend'
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => `${context.dataset.label}: ${Utils.formatCurrency(context.parsed.y)}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: (value) => Utils.formatCurrency(value)
                                }
                            }
                        },
                        onClick: () => {
                            this.expandChart('daily-revenue', 'Daily Revenue Trend');
                        }
                    }
                });

                // Make canvas clickable
                canvas.style.cursor = 'pointer';
                canvas.title = 'Click to expand';

                /*state.charts.dailyRevenue = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: last30Days.map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
                        datasets: [{
                            label: 'Daily Revenue',
                            data: revenueData,
                            borderColor: '#007bff',
                            backgroundColor: 'rgba(0, 123, 255, 0.1)',
                            tension: 0.4,
                            fill: true
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: (context) => `Revenue: ${Utils.formatCurrency(context.parsed.y)}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: (value) => Utils.formatCurrency(value)
                                }
                            }
                        }
                    }
                });*/
            }

            renderProfitAnalysisChart() {
                const canvas = document.getElementById('profit-analysis-chart');

                let start, end;
                if (state.dateRange && state.dateRange.start && state.dateRange.end) {
                    start = state.dateRange.start;
                    end = state.dateRange.end;
                } else {
                    const period = document.getElementById('date-filter')?.value || 'all';
                    const range = Utils.getDateRange(period);
                    start = range.start;
                    end = range.end;
                }

                if (!canvas) return;
                
                if (state.charts.profitAnalysis) {
                    state.charts.profitAnalysis.destroy();
                }
                
                const productMap = new Map((state.allProducts || []).map(p => [p.name, p]));
                const filterByDate = (s) => {
                    const d = this.getDatePeriod(s, 'date', 10);
                    return d && d >= start && d <= end;
                };
                const filterByOutlet = (s) => {
                    if (state.userRole === 'outlet_manager') return true;
                    const filter = state.selectedOutletFilter || 'main';
                    if (filter === 'all') return true;
                    return (s.location || 'main') === filter;
                };
                const filteredSales = state.allSales.filter(s => filterByDate(s) && filterByOutlet(s));
                
                const totalRevenue = filteredSales.reduce((sum, s) => {
                    const qty = parseFloat(s.quantity) || 0;
                    const price = parseFloat(s.price) || 0;
                    const discount = parseFloat(s.discount) || 0;
                    const tax = parseFloat(s.tax) || 0;
                    const subtotal = qty * price;
                    const discounted = subtotal * (1 - discount / 100);
                    return sum + discounted * (1 + tax / 100);
                }, 0);
                
                const totalCOGS = filteredSales.reduce((sum, s) => {
                    const product = productMap.get(s.product);
                    const qty = parseFloat(s.quantity) || 0;
                    return sum + (product ? qty * (parseFloat(product.cost) || 0) : 0);
                }, 0);
                
                // Calculate expenses correctly based on user role and filter
                let totalExpenses = 0;
                
                const filterExpenseByDate = (e) => {
                    const d = this.getDatePeriod(e, 'date', 10);
                    return d && d >= start && d <= end;
                };
                const excludeDebt = (e) => !this.isDebtPayment(e);
                if (state.userRole === 'outlet_manager') {
                    totalExpenses = state.allExpenses.filter(filterExpenseByDate).filter(excludeDebt).reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
                } else if (state.userRole === 'admin') {
                    const filter = state.selectedOutletFilter || 'main';
                    const filteredExpenses = state.allExpenses.filter(filterExpenseByDate).filter(excludeDebt);
                    
                    if (filter === 'all') {
                        totalExpenses = filteredExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
                    } else if (filter === 'main') {
                        totalExpenses = filteredExpenses
                            .filter(e => e.expenseType === 'main' || !e.expenseType)
                            .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
                    } else {
                        totalExpenses = filteredExpenses
                            .filter(e => e.outletId === filter || e.expenseType === 'outlet')
                            .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
                    }
                }

                const grossProfit = totalRevenue - totalCOGS;
                const netProfit = grossProfit - totalExpenses;
                
                const ctx = canvas.getContext('2d');
                state.charts.profitAnalysis = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['Revenue', 'COGS', 'Gross Profit', 'Op. Expenses', 'Net Profit'],
                        datasets: [{
                            label: 'Amount',
                            data: [totalRevenue, totalCOGS, grossProfit, totalExpenses, netProfit],
                            backgroundColor: ['#28a745', '#dc3545', '#17a2b8', '#ffc107', '#007bff']
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: (context) => `${context.label}: ${Utils.formatCurrency(context.parsed.y)}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: (value) => Utils.formatCurrency(value)
                                }
                            }
                        },
                        onClick: () => {
                            this.expandChart('profit-analysis', 'Profit Analysis');
                        }
                    }
                });
                // Make canvas clickable
                canvas.style.cursor = 'pointer';
                canvas.title = 'Click to expand';

            }

            renderTopCategoriesChart() {
                const canvas = document.getElementById('top-categories-chart');
                if (!canvas) return;
                
                if (state.charts.topCategories) {
                    state.charts.topCategories.destroy();
                }
                
                const categoryRevenue = {};
                state.allSales.forEach(sale => {
                    const product = state.allProducts.find(p => p.name === sale.product);
                    const category = product ? product.category : 'Unknown';
                    
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const revenue = discounted * (1 + (sale.tax || 0) / 100);
                    
                    categoryRevenue[category] = (categoryRevenue[category] || 0) + revenue;
                });
                
                const ctx = canvas.getContext('2d');
                state.charts.topCategories = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: Object.keys(categoryRevenue),
                        datasets: [{
                            data: Object.values(categoryRevenue),
                            backgroundColor: ['#007bff', '#28a745', '#ffc107', '#dc3545', '#17a2b8']
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: (context) => `${context.label}: ${Utils.formatCurrency(context.parsed)}`
                                }
                            }
                        },
                        onClick: () => {
                            this.expandChart('top-categories', 'Top Categories Analysis');
                        }
                    }
                });
                // Make canvas clickable
                canvas.style.cursor = 'pointer';
                canvas.title = 'Click to expand';
            }

            renderMonthlyComparisonChart() {
                const canvas = document.getElementById('monthly-comparison-chart');
                if (!canvas) return;
                
                if (state.charts.monthlyComparison) {
                    state.charts.monthlyComparison.destroy();
                }
                
                const monthlyData = {};
                state.allSales.forEach(sale => {
                    const month = sale.date.substring(0, 7);
                    if (!monthlyData[month]) {
                        monthlyData[month] = { revenue: 0, expenses: 0 };
                    }
                    
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const revenue = discounted * (1 + (sale.tax || 0) / 100);
                    monthlyData[month].revenue += revenue;
                });
                
                state.allExpenses.filter(e => !this.isDebtPayment(e)).forEach(expense => {
                    const month = expense.date.substring(0, 7);
                    if (!monthlyData[month]) {
                        monthlyData[month] = { revenue: 0, expenses: 0 };
                    }
                    monthlyData[month].expenses += expense.amount;
                });
                
                const months = Object.keys(monthlyData).sort().slice(-6);
                const revenues = months.map(m => monthlyData[m].revenue);
                const expenses = months.map(m => monthlyData[m].expenses);
                
                const ctx = canvas.getContext('2d');
                state.charts.monthlyComparison = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: months.map(m => new Date(m).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })),
                        datasets: [
                            {
                                label: 'Revenue',
                                data: revenues,
                                backgroundColor: '#28a745'
                            },
                            {
                                label: 'Op. Expenses',
                                data: expenses,
                                backgroundColor: '#dc3545'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: (context) => `${context.dataset.label}: ${Utils.formatCurrency(context.parsed.y)}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: (value) => Utils.formatCurrency(value)
                                }
                            }
                        },
                        onClick: () => {
                            this.expandChart('monthly-comparison', 'Monthly Comparison');
                        }
                    }
                });

                // Make canvas clickable
                canvas.style.cursor = 'pointer';
                canvas.title = 'Click to expand';
            }

            renderExpensesBreakdownChart() {
                const canvas = document.getElementById('expenses-breakdown-chart');
                if (!canvas) return;
                
                if (state.charts.expensesBreakdown) {
                    state.charts.expensesBreakdown.destroy();
                }
                
                const filteredExpenses = this.filterDataByDateRange(state.allExpenses)
                    .filter(e => !this.isDebtPayment(e));
                
                const categoryExpenses = {};
                filteredExpenses.forEach(expense => {
                    const category = expense.category || 'Other';
                    categoryExpenses[category] = (categoryExpenses[category] || 0) + expense.amount;
                });
                
                if (Object.keys(categoryExpenses).length === 0) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.font = '14px Roboto';
                    ctx.fillStyle = '#888';
                    ctx.textAlign = 'center';
                    ctx.fillText('No expense data available', canvas.width / 2, canvas.height / 2);
                    return;
                }
                
                const ctx = canvas.getContext('2d');
                state.charts.expensesBreakdown = new Chart(ctx, {
                    type: 'pie',
                    data: {
                        labels: Object.keys(categoryExpenses),
                        datasets: [{
                            data: Object.values(categoryExpenses),
                            backgroundColor: [
                                '#007bff',
                                '#28a745',
                                '#ffc107',
                                '#dc3545',
                                '#17a2b8',
                                '#6f42c1',
                                '#fd7e14'
                            ]
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: {
                                position: 'bottom'
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const label = context.label || '';
                                        const value = Utils.formatCurrency(context.parsed);
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = ((context.parsed / total) * 100).toFixed(1);
                                        return `${label}: ${value} (${percentage}%)`;
                                    }
                                }
                            }
                        },
                        onClick: () => {
                            this.expandChart('expenses-breakdown', 'Expenses Breakdown');
                        }
                    }
                });

                // Make canvas clickable
                canvas.style.cursor = 'pointer';
                canvas.title = 'Click to expand';
            }

            expandChart(chartType, title) {
                this.currentExpandedChart = chartType;
                document.getElementById('expanded-chart-title').innerHTML = `<i class="fas fa-chart-line"></i> ${title}`;
                document.getElementById('expanded-chart-period').value = '365';
                document.getElementById('expanded-chart-modal').style.display = 'block';
                
                // Small delay to ensure modal is visible
                setTimeout(() => {
                    this.renderExpandedChart(chartType, 365);
                }, 100);
            }
            
            renderExpandedChart(chartType, days) {
                const canvas = document.getElementById('expanded-chart-canvas');
                if (!canvas) return;
                
                // Destroy existing chart
                if (state.charts.expanded) {
                    state.charts.expanded.destroy();
                }
                
                switch (chartType) {
                    case 'daily-revenue':
                        this.renderExpandedDailyRevenue(canvas, days);
                        break;
                    case 'profit-analysis':
                        this.renderExpandedProfitAnalysis(canvas, days);
                        break;
                    case 'top-categories':
                        this.renderExpandedTopCategories(canvas, days);
                        break;
                    case 'monthly-comparison':
                        this.renderExpandedMonthlyComparison(canvas, days);
                        break;
                    case 'expenses-breakdown':
                        this.renderExpandedExpensesBreakdown(canvas, days);
                        break;
                }
            }
            
            updateExpandedChart(period) {
                const days = period === 'all' ? null : parseInt(period);
                this.renderExpandedChart(this.currentExpandedChart, days);
            }
            
            renderExpandedDailyRevenue(canvas, days) {
                const today = new Date();
                const daysToShow = days || 365;
                const dateRange = [];
                const revenueData = [];
                
                // Get date range
                let startDate = new Date(today);
                if (days) {
                    startDate.setDate(today.getDate() - daysToShow + 1);
                } else {
                    // All time - get earliest sale date
                    if (state.allSales.length > 0) {
                        const earliestSale = state.allSales.reduce((earliest, sale) => {
                            const saleDate = new Date(sale.date);
                            return saleDate < earliest ? saleDate : earliest;
                        }, new Date());
                        startDate = earliestSale;
                    }
                }
                
                // Calculate data
                let totalRevenue = 0;
                let highestRevenue = 0;
                let daysWithSales = 0;
                
                for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    dateRange.push(dateStr);
                    
                    const daySales = state.allSales.filter(s => s.date === dateStr);
                    const dayRevenue = daySales.reduce((sum, s) => {
                        const subtotal = s.quantity * s.price;
                        const discounted = subtotal * (1 - (s.discount || 0) / 100);
                        return sum + discounted * (1 + (s.tax || 0) / 100);
                    }, 0);
                    
                    revenueData.push(dayRevenue);
                    totalRevenue += dayRevenue;
                    if (dayRevenue > highestRevenue) highestRevenue = dayRevenue;
                    if (dayRevenue > 0) daysWithSales++;
                }
                
                const avgRevenue = daysWithSales > 0 ? totalRevenue / daysWithSales : 0;
                
                // Create chart
                const ctx = canvas.getContext('2d');
                state.charts.expanded = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: dateRange.map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
                        datasets: [{
                            label: 'Daily Revenue',
                            data: revenueData,
                            borderColor: '#007bff',
                            backgroundColor: 'rgba(0, 123, 255, 0.1)',
                            tension: 0.4,
                            fill: true,
                            pointRadius: dateRange.length > 90 ? 0 : 3,
                            pointHoverRadius: 5
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: true
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => `Revenue: ${Utils.formatCurrency(context.parsed.y)}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: (value) => Utils.formatCurrency(value)
                                }
                            }
                        }
                    }
                });
                
                // Update stats
                this.updateExpandedChartStats({
                    'Total Revenue': Utils.formatCurrency(totalRevenue),
                    'Average Daily Revenue': Utils.formatCurrency(avgRevenue),
                    'Highest Daily Revenue': Utils.formatCurrency(highestRevenue),
                    'Days with Sales': daysWithSales,
                    'Total Days': dateRange.length,
                    'Sales Rate': `${((daysWithSales / dateRange.length) * 100).toFixed(1)}%`
                });
            }
            
            renderExpandedProfitAnalysis(canvas, days) {
                const cutoffDate = days ? this.getDateDaysAgo(days) : null;
                
                let filteredSales = state.allSales;
                let filteredExpenses = state.allExpenses.filter(e => !this.isDebtPayment(e));
                
                if (cutoffDate) {
                    filteredSales = state.allSales.filter(s => s.date >= cutoffDate);
                    filteredExpenses = filteredExpenses.filter(e => e.date >= cutoffDate);
                }
                
                const totalRevenue = filteredSales.reduce((sum, s) => {
                    const subtotal = s.quantity * s.price;
                    const discounted = subtotal * (1 - (s.discount || 0) / 100);
                    return sum + discounted * (1 + (s.tax || 0) / 100);
                }, 0);
                
                const totalCOGS = filteredSales.reduce((sum, s) => {
                    const product = state.allProducts.find(p => p.name === s.product);
                    return sum + (product ? s.quantity * product.cost : 0);
                }, 0);
                
                const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
                const grossProfit = totalRevenue - totalCOGS;
                const netProfit = grossProfit - totalExpenses;
                const grossMargin = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : 0;
                const netMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0;
                
                const ctx = canvas.getContext('2d');
                state.charts.expanded = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['Revenue', 'COGS', 'Gross Profit', 'Op. Expenses', 'Net Profit'],
                        datasets: [{
                            label: 'Amount',
                            
                            data: [totalRevenue, totalCOGS, grossProfit, totalExpenses, netProfit],
                            backgroundColor: ['#28a745', '#dc3545', '#17a2b8', '#ffc107', '#007bff']
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => `${context.label}: ${Utils.formatCurrency(context.parsed.y)}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: (value) => Utils.formatCurrency(value)
                                }
                            }
                        }
                    }
                });
                
                this.updateExpandedChartStats({
                    'Total Revenue': Utils.formatCurrency(totalRevenue),
                    'COGS': Utils.formatCurrency(totalCOGS),
                    'Gross Profit': Utils.formatCurrency(grossProfit),
                    'Operating Expenses': Utils.formatCurrency(totalExpenses),
                    'Net Profit': Utils.formatCurrency(netProfit),
                    'Gross Margin': `${grossMargin}%`,
                    'Net Margin': `${netMargin}%`
                });
            }

            renderExpandedTopCategories(canvas, days) {
                const cutoffDate = days ? this.getDateDaysAgo(days) : null;
                
                let filteredSales = state.allSales;
                if (cutoffDate) {
                    filteredSales = state.allSales.filter(s => s.date >= cutoffDate);
                }
                
                const categoryRevenue = {};
                const categoryUnits = {};
                
                filteredSales.forEach(sale => {
                    const product = state.allProducts.find(p => p.name === sale.product);
                    const category = product ? product.category : 'Unknown';
                    
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const revenue = discounted * (1 + (sale.tax || 0) / 100);
                    
                    categoryRevenue[category] = (categoryRevenue[category] || 0) + revenue;
                    categoryUnits[category] = (categoryUnits[category] || 0) + sale.quantity;
                });
                
                const sortedCategories = Object.entries(categoryRevenue)
                    .sort((a, b) => b[1] - a[1]);
                
                const totalRevenue = Object.values(categoryRevenue).reduce((a, b) => a + b, 0);
                
                const ctx = canvas.getContext('2d');
                state.charts.expanded = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: sortedCategories.map(([cat]) => cat),
                        datasets: [{
                            data: sortedCategories.map(([, rev]) => rev),
                            backgroundColor: [
                                '#007bff',
                                '#28a745',
                                '#ffc107',
                                '#dc3545',
                                '#17a2b8',
                                '#6f42c1',
                                '#fd7e14'
                            ]
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'right'
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const label = context.label || '';
                                        const value = Utils.formatCurrency(context.parsed);
                                        const percentage = ((context.parsed / totalRevenue) * 100).toFixed(1);
                                        return `${label}: ${value} (${percentage}%)`;
                                    }
                                }
                            }
                        }
                    }
                });
                
                const stats = {};
                sortedCategories.forEach(([category, revenue]) => {
                    const percentage = ((revenue / totalRevenue) * 100).toFixed(1);
                    const units = categoryUnits[category];
                    stats[`${category} Revenue`] = Utils.formatCurrency(revenue);
                    stats[`${category} Share`] = `${percentage}%`;
                    stats[`${category} Units`] = units;
                });
                stats['Total Revenue'] = Utils.formatCurrency(totalRevenue);
                
                this.updateExpandedChartStats(stats);
            }

            renderExpandedMonthlyComparison(canvas, days) {
                const cutoffDate = days ? this.getDateDaysAgo(days) : null;
                
                let filteredSales = state.allSales;
                let filteredExpenses = state.allExpenses.filter(e => !this.isDebtPayment(e));
                
                if (cutoffDate) {
                    filteredSales = state.allSales.filter(s => s.date >= cutoffDate);
                    filteredExpenses = filteredExpenses.filter(e => e.date >= cutoffDate);
                }
                
                const monthlyData = {};
                
                filteredSales.forEach(sale => {
                    const month = sale.date.substring(0, 7);
                    if (!monthlyData[month]) {
                        monthlyData[month] = { revenue: 0, expenses: 0 };
                    }
                    
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const revenue = discounted * (1 + (sale.tax || 0) / 100);
                    monthlyData[month].revenue += revenue;
                });
                
                filteredExpenses.forEach(expense => {
                    const month = expense.date.substring(0, 7);
                    if (!monthlyData[month]) {
                        monthlyData[month] = { revenue: 0, expenses: 0 };
                    }
                    monthlyData[month].expenses += expense.amount;
                });
                
                const months = Object.keys(monthlyData).sort();
                const revenues = months.map(m => monthlyData[m].revenue);
                const expenses = months.map(m => monthlyData[m].expenses);
                const profits = months.map(m => monthlyData[m].revenue - monthlyData[m].expenses);
                
                const totalRevenue = revenues.reduce((a, b) => a + b, 0);
                const totalExpenses = expenses.reduce((a, b) => a + b, 0);
                const totalProfit = totalRevenue - totalExpenses;
                const avgMonthlyRevenue = revenues.length > 0 ? totalRevenue / revenues.length : 0;
                const avgMonthlyProfit = profits.length > 0 ? totalProfit / profits.length : 0;
                
                const ctx = canvas.getContext('2d');
                state.charts.expanded = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: months.map(m => new Date(m).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })),
                        datasets: [
                            {
                                label: 'Revenue',
                                data: revenues,
                                backgroundColor: '#28a745'
                            },
                            {
                                label: 'Op. Expenses',
                                data: expenses,
                                backgroundColor: '#dc3545'
                            },
                            {
                                label: 'Profit',
                                data: profits,
                                backgroundColor: '#007bff'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top'
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => `${context.dataset.label}: ${Utils.formatCurrency(context.parsed.y)}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: (value) => Utils.formatCurrency(value)
                                }
                            }
                        }
                    }
                });
                
                this.updateExpandedChartStats({
                    'Total Revenue': Utils.formatCurrency(totalRevenue),
                    'Op. Expenses': Utils.formatCurrency(totalExpenses),
                    'Total Profit': Utils.formatCurrency(totalProfit),
                    'Avg Monthly Revenue': Utils.formatCurrency(avgMonthlyRevenue),
                    'Avg Monthly Profit': Utils.formatCurrency(avgMonthlyProfit),
                    'Number of Months': months.length
                });
            }

            renderExpandedExpensesBreakdown(canvas, days) {
                const cutoffDate = days ? this.getDateDaysAgo(days) : null;
                
                let filteredExpenses = state.allExpenses.filter(e => !this.isDebtPayment(e));
                if (cutoffDate) {
                    filteredExpenses = filteredExpenses.filter(e => e.date >= cutoffDate);
                }
                
                const categoryExpenses = {};
                const categoryCount = {};
                
                filteredExpenses.forEach(expense => {
                    const category = expense.category || 'Other';
                    categoryExpenses[category] = (categoryExpenses[category] || 0) + expense.amount;
                    categoryCount[category] = (categoryCount[category] || 0) + 1;
                });
                
                const sortedCategories = Object.entries(categoryExpenses)
                    .sort((a, b) => b[1] - a[1]);
                
                const totalExpenses = Object.values(categoryExpenses).reduce((a, b) => a + b, 0);
                
                if (Object.keys(categoryExpenses).length === 0) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.font = '16px Roboto';
                    ctx.fillStyle = '#888';
                    ctx.textAlign = 'center';
                    ctx.fillText('No expense data available for this period', canvas.width / 2, canvas.height / 2);
                    
                    this.updateExpandedChartStats({
                        'Total Expenses': Utils.formatCurrency(0),
                        'Number of Expenses': 0
                    });
                    return;
                }
                
                const ctx = canvas.getContext('2d');
                state.charts.expanded = new Chart(ctx, {
                    type: 'pie',
                    data: {
                        labels: sortedCategories.map(([cat]) => cat),
                        datasets: [{
                            data: sortedCategories.map(([, amount]) => amount),
                            backgroundColor: [
                                '#007bff',
                                '#28a745',
                                '#ffc107',
                                '#dc3545',
                                '#17a2b8',
                                '#6f42c1',
                                '#fd7e14',
                                '#20c997',
                                '#e83e8c'
                            ]
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'right'
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const label = context.label || '';
                                        const value = Utils.formatCurrency(context.parsed);
                                        const percentage = ((context.parsed / totalExpenses) * 100).toFixed(1);
                                        return `${label}: ${value} (${percentage}%)`;
                                    }
                                }
                            }
                        }
                    }
                });
                
                const stats = {};
                sortedCategories.forEach(([category, amount]) => {
                    const percentage = ((amount / totalExpenses) * 100).toFixed(1);
                    const count = categoryCount[category];
                    const avgPerExpense = amount / count;
                    stats[`${category} Total`] = Utils.formatCurrency(amount);
                    stats[`${category} Share`] = `${percentage}%`;
                    stats[`${category} Count`] = count;
                    stats[`${category} Average`] = Utils.formatCurrency(avgPerExpense);
                });
                stats['Total Expenses'] = Utils.formatCurrency(totalExpenses);
                stats['Total Transactions'] = filteredExpenses.length;
                
                this.updateExpandedChartStats(stats);
            }

            updateExpandedChartStats(stats) {
                const statsDiv = document.getElementById('expanded-chart-stats');
                if (!statsDiv) return;
                
                statsDiv.innerHTML = Object.entries(stats).map(([label, value]) => `
                    <div class="stat-card">
                        <h4>${label}</h4>
                        <p>${value}</p>
                    </div>
                `).join('');
            }

            getDateDaysAgo(days) {
                const date = new Date();
                date.setDate(date.getDate() - days);
                return date.toISOString().split('T')[0];
            }

            renderAccounting() {
                // Debug logging to see what data we have
                console.log('🔍 Accounting Debug:', {
                    products: state.allProducts.length,
                    sales: state.allSales.length,
                    expenses: state.allExpenses.length,
                    liabilities: state.allLiabilities.length
                });
                
                // Calculate Assets
                const inventoryValue = state.allProducts.reduce((sum, p) => {
                    const qty = parseFloat(p.quantity) || 0;
                    const cost = parseFloat(p.cost) || 0;
                    return sum + (qty * cost);
                }, 0);
                
                const totalRevenue = state.allSales.reduce((sum, s) => {
                    const qty = parseFloat(s.quantity) || 0;
                    const price = parseFloat(s.price) || 0;
                    const discount = parseFloat(s.discount) || 0;
                    const tax = parseFloat(s.tax) || 0;
                    const subtotal = qty * price;
                    const discounted = subtotal * (1 - discount / 100);
                    return sum + discounted * (1 + tax / 100);
                }, 0);
                
                // FIX: Filter out invalid expenses and ensure amount is a number
                const validExpenses = state.allExpenses.filter(e => {
                    const amount = parseFloat(e.amount);
                    return !isNaN(amount) && amount !== null && amount !== undefined;
                });
                
                const totalExpenses = validExpenses.reduce((sum, e) => {
                    return sum + parseFloat(e.amount);
                }, 0);
                
                // Log invalid expenses for debugging
                const invalidExpenses = state.allExpenses.filter(e => {
                    const amount = parseFloat(e.amount);
                    return isNaN(amount) || amount === null || amount === undefined;
                });
                
                if (invalidExpenses.length > 0) {
                    console.warn('⚠️ Invalid expenses found:', invalidExpenses.length, 'expenses with invalid amounts');
                    console.log('Invalid expense samples:', invalidExpenses.slice(0, 3));
                }
                
                const cashBalance = totalRevenue - totalExpenses;
                const totalAssets = cashBalance + inventoryValue;
                
                // Calculate Liabilities (sum of all outstanding liability balances)
                const totalLiabilities = state.allLiabilities.reduce((sum, l) => {
                    const balance = parseFloat(l.balance) || 0;
                    return sum + balance;
                }, 0);
                
                // Calculate Equity (Assets - Liabilities)
                const totalEquity = totalAssets - totalLiabilities;
                const cashFlow = cashBalance;
                
                console.log('💰 Accounting Values:', {
                    inventoryValue: inventoryValue.toFixed(2),
                    totalRevenue: totalRevenue.toFixed(2),
                    totalExpenses: totalExpenses.toFixed(2),
                    validExpensesCount: validExpenses.length,
                    invalidExpensesCount: invalidExpenses.length,
                    cashBalance: cashBalance.toFixed(2),
                    totalAssets: totalAssets.toFixed(2),
                    totalLiabilities: totalLiabilities.toFixed(2),
                    totalEquity: totalEquity.toFixed(2),
                    cashFlow: cashFlow.toFixed(2)
                });
                
                this.updateElement('total-assets', Utils.formatCurrency(totalAssets));
                this.updateElement('total-liabilities', Utils.formatCurrency(totalLiabilities));
                this.updateElement('total-equity', Utils.formatCurrency(totalEquity));
                this.updateElement('cash-flow', Utils.formatCurrency(cashFlow));
                
                const totalTaxCollected = state.allSales.reduce((sum, s) => {
                    const qty = parseFloat(s.quantity) || 0;
                    const price = parseFloat(s.price) || 0;
                    const discount = parseFloat(s.discount) || 0;
                    const tax = parseFloat(s.tax) || 0;
                    const subtotal = qty * price;
                    const discounted = subtotal * (1 - discount / 100);
                    const taxAmount = discounted * tax / 100;
                    return sum + taxAmount;
                }, 0);
                
                this.updateElement('tax-collected', Utils.formatCurrency(totalTaxCollected));
                this.updateElement('tax-payable', Utils.formatCurrency(totalTaxCollected));
            }

            /** Normalize sale/expense date to YYYY-MM or YYYY for period filtering (handles string, Timestamp, or {seconds}) */
            getDatePeriod(obj, dateKey = 'date', periodLen) {
                const d = obj && obj[dateKey];
                if (!d) return '';
                if (typeof d === 'string') {
                    const iso = d.indexOf('T') !== -1 ? d.split('T')[0] : d;
                    return iso.substring(0, periodLen != null ? periodLen : 7);
                }
                if (d && typeof d.toDate === 'function') {
                    const str = d.toDate().toISOString().substring(0, 7);
                    return periodLen === 4 ? str.substring(0, 4) : str;
                }
                const sec = d.seconds ?? d._seconds;
                if (sec != null) {
                    const str = new Date(sec * 1000).toISOString().substring(0, 7);
                    return periodLen === 4 ? str.substring(0, 4) : str;
                }
                return '';
            }

            async generateIncomeStatement() {
                // Use mobile-friendly prompt
                const period = await MobileDialogs.prompt(
                    'Enter period (YYYY-MM for month, YYYY for year)', 
                    new Date().toISOString().substring(0, 7)
                );
                if (!period) return;
                const periodLen = period.length;
                const inPeriod = (item, key) => this.getDatePeriod(item, key, periodLen) === period;
                const periodSales = state.allSales.filter(s => inPeriod(s, 'date'));
                const periodExpenses = state.allExpenses.filter(e => inPeriod(e, 'date'));
                
                // Calculate revenue with NaN protection
                const totalRevenue = periodSales.reduce((sum, s) => {
                    const qty = parseFloat(s.quantity) || 0;
                    const price = parseFloat(s.price) || 0;
                    const discount = parseFloat(s.discount) || 0;
                    const tax = parseFloat(s.tax) || 0;
                    const subtotal = qty * price;
                    const discounted = subtotal * (1 - discount / 100);
                    return sum + discounted * (1 + tax / 100);
                }, 0);
                
                // Calculate COGS with NaN protection
                const totalCOGS = periodSales.reduce((sum, s) => {
                    const product = state.allProducts.find(p => p.name === s.product);
                    const qty = parseFloat(s.quantity) || 0;
                    const cost = product ? (parseFloat(product.cost) || 0) : 0;
                    return sum + (qty * cost);
                }, 0);
                
                const grossProfit = totalRevenue - totalCOGS;
                
                // Filter valid expenses and categorize
                const validExpenses = periodExpenses.filter(e => {
                    const amount = parseFloat(e.amount);
                    return !isNaN(amount) && amount !== null && amount !== undefined;
                });

                // Exclude debt/liability payments from operating expenses (principal is not a P&L expense)
                const operatingExpenses = validExpenses.filter(e => !this.isDebtPayment(e));
                const debtPayments = validExpenses.filter(e => this.isDebtPayment(e));
                
                // Group expenses by category
                const expensesByCategory = {};
                operatingExpenses.forEach(e => {
                    const category = e.category || 'Other';
                    if (!expensesByCategory[category]) {
                        expensesByCategory[category] = 0;
                    }
                    expensesByCategory[category] += parseFloat(e.amount);
                });
                
                const totalOperatingExpenses = Object.values(expensesByCategory).reduce((sum, amt) => sum + amt, 0);
                const totalDebtPayments = debtPayments.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
                const netIncome = grossProfit - totalOperatingExpenses;
                
                // Generate expense rows HTML
                const expenseRowsHTML = Object.entries(expensesByCategory)
                    .sort((a, b) => b[1] - a[1]) // Sort by amount descending
                    .map(([category, amount]) => `
                        <tr>
                            <td style="padding-left: 30px;">${category}</td>
                            <td class="amount">(${Utils.formatCurrency(amount)})</td>
                        </tr>
                    `).join('');
                
                const reportHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Income Statement</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 40px; }
                            h1 { text-align: center; color: #007bff; }
                            h2 { text-align: center; color: #666; margin-bottom: 30px; }
                            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                            th { background: #f8f9fa; font-weight: bold; }
                            .total-row { font-weight: bold; background: #f8f9fa; }
                            .amount { text-align: right; }
                            .positive { color: green; }
                            .negative { color: red; }
                            .section-header { background: #e9ecef; font-weight: bold; padding-top: 15px; }
                        </style>
                    </head>
                    <body>
                        <h1>Income Statement</h1>
                        <h2>For the Period: ${period}</h2>
                        <table>
                            <tr>
                                <th>Item</th>
                                <th class="amount">Amount</th>
                            </tr>
                            <tr class="section-header">
                                <td colspan="2">REVENUE</td>
                            </tr>
                            <tr>
                                <td style="padding-left: 20px;">Sales Revenue</td>
                                <td class="amount">${Utils.formatCurrency(totalRevenue)}</td>
                            </tr>
                            <tr class="section-header">
                                <td colspan="2">COST OF GOODS SOLD</td>
                            </tr>
                            <tr>
                                <td style="padding-left: 20px;">Cost of Goods Sold</td>
                                <td class="amount">(${Utils.formatCurrency(totalCOGS)})</td>
                            </tr>
                            <tr class="total-row">
                                <td>GROSS PROFIT</td>
                                <td class="amount">${Utils.formatCurrency(grossProfit)}</td>
                            </tr>
                            <tr><td colspan="2">&nbsp;</td></tr>
                            <tr class="section-header">
                                <td colspan="2">OPERATING EXPENSES</td>
                            </tr>
                            ${expenseRowsHTML}
                            <tr class="total-row">
                                <td>Total Operating Expenses</td>
                                <td class="amount">(${Utils.formatCurrency(totalOperatingExpenses)})</td>
                            </tr>
                            ${totalDebtPayments > 0 ? `
                            <tr>
                                <td style="padding-left: 20px; color: #666;">Debt/Liability Payments (not an expense)</td>
                                <td class="amount" style="color: #666;">${Utils.formatCurrency(totalDebtPayments)}</td>
                            </tr>
                            ` : ''}
                            <tr><td colspan="2">&nbsp;</td></tr>
                            <tr class="total-row">
                                <td><strong>NET INCOME</strong></td>
                                <td class="amount ${netIncome >= 0 ? 'positive' : 'negative'}">
                                    <strong>${Utils.formatCurrency(netIncome)}</strong>
                                </td>
                            </tr>
                        </table>
                        <div style="margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
                            <p style="margin: 5px 0;"><strong>Period Summary:</strong></p>
                            <p style="margin: 5px 0;">Sales Transactions: ${periodSales.length}</p>
                            <p style="margin: 5px 0;">Operating Expense Transactions: ${operatingExpenses.length}</p>
                            ${totalDebtPayments > 0 ? `<p style="margin: 5px 0;">Debt/Liability Payment Transactions: ${debtPayments.length}</p>` : ''}
                            <p style="margin: 5px 0;">Gross Profit Margin: ${totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : 0}%</p>
                            <p style="margin: 5px 0;">Net Profit Margin: ${totalRevenue > 0 ? ((netIncome / totalRevenue) * 100).toFixed(1) : 0}%</p>
                        </div>
                        <p style="text-align: center; margin-top: 40px; color: #666;">
                            Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
                        </p>
                    </body>
                    </html>
                `;
                
                // Use mobile-friendly modal instead of window.open()
                FinancialReportsModal.show(reportHTML, `Income Statement - ${period}`, 'income-statement');
                Utils.showToast('Income statement generated', 'success');
            }

            generateBalanceSheet() {
                // Calculate inventory with NaN protection
                const inventoryValue = state.allProducts.reduce((sum, p) => {
                    const qty = parseFloat(p.quantity) || 0;
                    const cost = parseFloat(p.cost) || 0;
                    return sum + (qty * cost);
                }, 0);
                
                // Calculate revenue with NaN protection
                const totalRevenue = state.allSales.reduce((sum, s) => {
                    const qty = parseFloat(s.quantity) || 0;
                    const price = parseFloat(s.price) || 0;
                    const discount = parseFloat(s.discount) || 0;
                    const tax = parseFloat(s.tax) || 0;
                    const subtotal = qty * price;
                    const discounted = subtotal * (1 - discount / 100);
                    return sum + discounted * (1 + tax / 100);
                }, 0);
                
                // Calculate expenses with NaN protection
                const validExpenses = state.allExpenses.filter(e => {
                    const amount = parseFloat(e.amount);
                    return !isNaN(amount) && amount !== null && amount !== undefined;
                });
                const totalExpenses = validExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
                
                const cash = totalRevenue - totalExpenses;
                const totalAssets = cash + inventoryValue;
                
                // Calculate liabilities with NaN protection and categorization
                const validLiabilities = state.allLiabilities.filter(l => {
                    const balance = parseFloat(l.balance);
                    return !isNaN(balance) && balance !== null && balance !== undefined && balance > 0;
                });
                
                // Categorize liabilities (current vs long-term)
                const today = new Date();
                const oneYearFromNow = new Date(today);
                oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
                
                const currentLiabilities = validLiabilities.filter(l => {
                    if (!l.dueDate) return true; // Assume current if no due date
                    const dueDate = new Date(l.dueDate);
                    return dueDate <= oneYearFromNow;
                });
                
                const longTermLiabilities = validLiabilities.filter(l => {
                    if (!l.dueDate) return false;
                    const dueDate = new Date(l.dueDate);
                    return dueDate > oneYearFromNow;
                });
                
                const totalCurrentLiabilities = currentLiabilities.reduce((sum, l) => sum + parseFloat(l.balance), 0);
                const totalLongTermLiabilities = longTermLiabilities.reduce((sum, l) => sum + parseFloat(l.balance), 0);
                const totalLiabilities = totalCurrentLiabilities + totalLongTermLiabilities;
                
                // Calculate equity
                const totalEquity = totalAssets - totalLiabilities;
                
                // Verification
                const balanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;
                const balanceCheck = balanced ? '✅ Balanced' : '⚠️ Not Balanced';
                
                // Generate liability rows HTML
                const currentLiabilitiesHTML = currentLiabilities.map(l => `
                    <tr>
                        <td style="padding-left: 40px;">${l.creditor} (${l.type})</td>
                        <td class="amount">${Utils.formatCurrency(l.balance)}</td>
                    </tr>
                `).join('') || '<tr><td style="padding-left: 40px;">None</td><td class="amount">₵0.00</td></tr>';
                
                const longTermLiabilitiesHTML = longTermLiabilities.length > 0 ? longTermLiabilities.map(l => `
                    <tr>
                        <td style="padding-left: 40px;">${l.creditor} (${l.type})</td>
                        <td class="amount">${Utils.formatCurrency(l.balance)}</td>
                    </tr>
                `).join('') : '';
                
                const reportHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Balance Sheet</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 40px; }
                            h1 { text-align: center; color: #007bff; }
                            h2 { text-align: center; color: #666; margin-bottom: 30px; }
                            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                            th { background: #f8f9fa; font-weight: bold; }
                            .section-header { background: #e9ecef; font-weight: bold; }
                            .subsection-header { background: #f8f9fa; font-weight: bold; font-style: italic; }
                            .total-row { font-weight: bold; background: #f8f9fa; }
                            .final-row { font-weight: bold; background: #007bff; color: white; }
                            .amount { text-align: right; }
                            .indent { padding-left: 30px; }
                            .balance-check { text-align: center; padding: 15px; margin-top: 20px; background: #d4edda; border-radius: 5px; font-weight: bold; }
                        </style>
                    </head>
                    <body>
                        <h1>Balance Sheet</h1>
                        <h2>As of ${new Date().toLocaleDateString()}</h2>
                        <table>
                            <tr class="section-header">
                                <td colspan="2">ASSETS</td>
                            </tr>
                            <tr class="subsection-header">
                                <td colspan="2" style="padding-left: 20px;">Current Assets</td>
                            </tr>
                            <tr>
                                <td style="padding-left: 40px;">Cash</td>
                                <td class="amount">${Utils.formatCurrency(cash)}</td>
                            </tr>
                            <tr>
                                <td style="padding-left: 40px;">Inventory</td>
                                <td class="amount">${Utils.formatCurrency(inventoryValue)}</td>
                            </tr>
                            <tr class="total-row">
                                <td style="padding-left: 20px;">Total Current Assets</td>
                                <td class="amount">${Utils.formatCurrency(totalAssets)}</td>
                            </tr>
                            <tr><td colspan="2">&nbsp;</td></tr>
                            <tr class="total-row">
                                <td><strong>TOTAL ASSETS</strong></td>
                                <td class="amount"><strong>${Utils.formatCurrency(totalAssets)}</strong></td>
                            </tr>
                            <tr><td colspan="2">&nbsp;</td></tr>
                            
                            <tr class="section-header">
                                <td colspan="2">LIABILITIES</td>
                            </tr>
                            <tr class="subsection-header">
                                <td colspan="2" style="padding-left: 20px;">Current Liabilities (Due within 1 year)</td>
                            </tr>
                            ${currentLiabilitiesHTML}
                            <tr class="total-row">
                                <td style="padding-left: 20px;">Total Current Liabilities</td>
                                <td class="amount">${Utils.formatCurrency(totalCurrentLiabilities)}</td>
                            </tr>
                            ${longTermLiabilities.length > 0 ? `
                                <tr><td colspan="2">&nbsp;</td></tr>
                                <tr class="subsection-header">
                                    <td colspan="2" style="padding-left: 20px;">Long-term Liabilities (Due after 1 year)</td>
                                </tr>
                                ${longTermLiabilitiesHTML}
                                <tr class="total-row">
                                    <td style="padding-left: 20px;">Total Long-term Liabilities</td>
                                    <td class="amount">${Utils.formatCurrency(totalLongTermLiabilities)}</td>
                                </tr>
                            ` : ''}
                            <tr><td colspan="2">&nbsp;</td></tr>
                            <tr class="total-row">
                                <td><strong>TOTAL LIABILITIES</strong></td>
                                <td class="amount"><strong>${Utils.formatCurrency(totalLiabilities)}</strong></td>
                            </tr>
                            <tr><td colspan="2">&nbsp;</td></tr>
                            
                            <tr class="section-header">
                                <td colspan="2">EQUITY</td>
                            </tr>
                            <tr>
                                <td class="indent">Owner's Equity</td>
                                <td class="amount">${Utils.formatCurrency(totalEquity)}</td>
                            </tr>
                            <tr class="total-row">
                                <td><strong>TOTAL EQUITY</strong></td>
                                <td class="amount"><strong>${Utils.formatCurrency(totalEquity)}</strong></td>
                            </tr>
                            <tr><td colspan="2">&nbsp;</td></tr>
                            <tr class="final-row">
                                <td><strong>TOTAL LIABILITIES & EQUITY</strong></td>
                                <td class="amount"><strong>${Utils.formatCurrency(totalLiabilities + totalEquity)}</strong></td>
                            </tr>
                        </table>
                        <div class="balance-check">
                            ${balanceCheck}: Assets (${Utils.formatCurrency(totalAssets)}) = Liabilities (${Utils.formatCurrency(totalLiabilities)}) + Equity (${Utils.formatCurrency(totalEquity)})
                        </div>
                        <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
                            <p style="margin: 5px 0;"><strong>Summary:</strong></p>
                            <p style="margin: 5px 0;">Current Liabilities: ${currentLiabilities.length} items</p>
                            <p style="margin: 5px 0;">Long-term Liabilities: ${longTermLiabilities.length} items</p>
                            <p style="margin: 5px 0;">Total Liability Items: ${validLiabilities.length}</p>
                            <p style="margin: 5px 0;">Debt-to-Equity Ratio: ${totalEquity !== 0 ? (totalLiabilities / Math.abs(totalEquity)).toFixed(2) : 'N/A'}</p>
                        </div>
                        <p style="text-align: center; margin-top: 40px; color: #666;">
                            Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
                        </p>
                    </body>
                    </html>
                `;
                
                // Use mobile-friendly modal instead of window.open()
                FinancialReportsModal.show(reportHTML, 'Balance Sheet', 'balance-sheet');
                Utils.showToast('Balance sheet generated', 'success');
            }

            generateCashflowStatement() {
                const monthlyData = {};
                
                // Process sales (operating cash inflow) with NaN protection
                state.allSales.forEach(sale => {
                    const month = this.getDatePeriod(sale, 'date', 7);
                    if (!month) return;
                    if (!monthlyData[month]) {
                        monthlyData[month] = { operating: 0, investing: 0, financing: 0 };
                    }
                    const qty = parseFloat(sale.quantity) || 0;
                    const price = parseFloat(sale.price) || 0;
                    const discount = parseFloat(sale.discount) || 0;
                    const tax = parseFloat(sale.tax) || 0;
                    const subtotal = qty * price;
                    const discounted = subtotal * (1 - discount / 100);
                    const total = discounted * (1 + tax / 100);
                    monthlyData[month].operating += total;
                });

                // Process expenses (operating / investing / financing cash outflow) with NaN protection
                const validExpenses = state.allExpenses.filter(e => {
                    const amount = parseFloat(e.amount);
                    return !isNaN(amount) && amount !== null && amount !== undefined;
                });
                
                validExpenses.forEach(expense => {
                    const month = this.getDatePeriod(expense, 'date', 7);
                    if (!month) return;
                    if (!monthlyData[month]) {
                        monthlyData[month] = { operating: 0, investing: 0, financing: 0 };
                    }
                    const amount = parseFloat(expense.amount) || 0;
                    const expenseType = (expense.expenseType || '').toLowerCase();
                    const category = (expense.category || '').toLowerCase();

                    // Financing cash flows: repayments of debt / liabilities
                    const isFinancing =
                        expenseType === 'liability_payment' ||
                        category === 'debt payment' ||
                        category === 'loan repayment';

                    // Investing cash flows: acquisition of long-term assets
                    const isInvesting =
                        expenseType === 'asset_purchase' ||
                        category.includes('asset') ||
                        category.includes('equipment') ||
                        category.includes('vehicle') ||
                        category.includes('property') ||
                        category.includes('capital');

                    if (isFinancing) {
                        monthlyData[month].financing -= amount;
                    } else if (isInvesting) {
                        monthlyData[month].investing -= amount;
                    } else {
                        monthlyData[month].operating -= amount;
                    }
                });

                // Liability repayments recorded in payment_transactions (not expenses)
                (state.allLiabilityPayments || []).forEach((p) => {
                    const dateStr = p.paymentDate;
                    if (!dateStr || String(dateStr).length < 7) return;
                    const month = String(dateStr).slice(0, 7);
                    const amt = parseFloat(p.amount) || 0;
                    if (!amt) return;
                    if (!monthlyData[month]) {
                        monthlyData[month] = { operating: 0, investing: 0, financing: 0 };
                    }
                    monthlyData[month].financing -= amt;
                });
                
                // Process new liabilities as financing cash inflow (principal received)
                if (state.allLiabilities && state.allLiabilities.length > 0) {
                    state.allLiabilities.forEach(liability => {
                        const amount = parseFloat(liability.amount) || 0;
                        if (!amount) return;

                        const rawDate = liability.createdAt || liability.dueDate;
                        if (!rawDate) return;

                        let dateStr;
                        try {
                            if (typeof rawDate === 'string') {
                                dateStr = rawDate;
                            } else if (rawDate && typeof rawDate.toDate === 'function') {
                                dateStr = rawDate.toDate().toISOString().split('T')[0];
                            } else {
                                const d = new Date(rawDate);
                                if (isNaN(d.getTime())) return;
                                dateStr = d.toISOString().split('T')[0];
                            }
                        } catch (e) {
                            return;
                        }
                        if (!dateStr || dateStr.length < 7 || isNaN(new Date(dateStr).getTime())) return;

                        const month = dateStr.slice(0, 7); // YYYY-MM
                        if (!monthlyData[month]) {
                            monthlyData[month] = { operating: 0, investing: 0, financing: 0 };
                        }
                        monthlyData[month].financing += amount;
                    });
                }
                
                const months = Object.keys(monthlyData).sort();
                let runningBalance = 0;
                
                const rowsHTML = months.map(month => {
                    const data = monthlyData[month];
                    const netCashFlow = data.operating + data.investing + data.financing;
                    runningBalance += netCashFlow;
                    
                    return `
                        <tr>
                            <td>${new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</td>
                            <td class="amount ${data.operating >= 0 ? 'positive' : 'negative'}">${Utils.formatCurrency(data.operating)}</td>
                            <td class="amount">${Utils.formatCurrency(data.investing)}</td>
                            <td class="amount">${Utils.formatCurrency(data.financing)}</td>
                            <td class="amount ${netCashFlow >= 0 ? 'positive' : 'negative'}"><strong>${Utils.formatCurrency(netCashFlow)}</strong></td>
                            <td class="amount"><strong>${Utils.formatCurrency(runningBalance)}</strong></td>
                        </tr>
                    `;
                }).join('');
                
                // Calculate totals
                const totalOperating = Object.values(monthlyData).reduce((sum, d) => sum + d.operating, 0);
                const totalInvesting = Object.values(monthlyData).reduce((sum, d) => sum + d.investing, 0);
                const totalFinancing = Object.values(monthlyData).reduce((sum, d) => sum + d.financing, 0);
                const totalNetCashFlow = totalOperating + totalInvesting + totalFinancing;
                
                const reportHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Cash Flow Statement</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 40px; }
                            h1 { text-align: center; color: #007bff; }
                            h2 { text-align: center; color: #666; margin-bottom: 30px; }
                            table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
                            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                            th { background: #f8f9fa; font-weight: bold; }
                            .amount { text-align: right; }
                            .positive { color: green; }
                            .negative { color: red; }
                            .total-row { font-weight: bold; background: #f8f9fa; }
                            .info-box { margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; }
                        </style>
                    </head>
                    <body>
                        <h1>Cash Flow Statement</h1>
                        <h2>All Periods</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>Period</th>
                                    <th class="amount">Operating Activities</th>
                                    <th class="amount">Investing Activities</th>
                                    <th class="amount">Financing Activities</th>
                                    <th class="amount">Net Cash Flow</th>
                                    <th class="amount">Cumulative Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHTML}
                            </tbody>
                            <tfoot>
                                <tr class="total-row">
                                    <td><strong>TOTALS</strong></td>
                                    <td class="amount ${totalOperating >= 0 ? 'positive' : 'negative'}"><strong>${Utils.formatCurrency(totalOperating)}</strong></td>
                                    <td class="amount"><strong>${Utils.formatCurrency(totalInvesting)}</strong></td>
                                    <td class="amount"><strong>${Utils.formatCurrency(totalFinancing)}</strong></td>
                                    <td class="amount ${totalNetCashFlow >= 0 ? 'positive' : 'negative'}"><strong>${Utils.formatCurrency(totalNetCashFlow)}</strong></td>
                                    <td class="amount"><strong>${Utils.formatCurrency(runningBalance)}</strong></td>
                                </tr>
                            </tfoot>
                        </table>
                        <div class="info-box">
                            <p style="margin: 5px 0;"><strong>Cash Flow Categories:</strong></p>
                            <p style="margin: 5px 0;"><strong>Operating Activities:</strong> Revenue from sales minus operating expenses</p>
                            <p style="margin: 5px 0;"><strong>Investing Activities:</strong> Purchase/sale of long-term assets (e.g. equipment, vehicles, property)</p>
                            <p style="margin: 5px 0;"><strong>Financing Activities:</strong> Loans, equity injections, and debt repayments</p>
                        </div>
                        <div class="info-box" style="margin-top: 15px;">
                            <p style="margin: 5px 0;"><strong>Summary:</strong></p>
                            <p style="margin: 5px 0;">Total Periods: ${months.length}</p>
                            <p style="margin: 5px 0;">Periods with Positive Cash Flow: ${Object.values(monthlyData).filter(d => (d.operating + d.investing + d.financing) > 0).length}</p>
                            <p style="margin: 5px 0;">Periods with Negative Cash Flow: ${Object.values(monthlyData).filter(d => (d.operating + d.investing + d.financing) < 0).length}</p>
                            <p style="margin: 5px 0;">Average Monthly Cash Flow: ${Utils.formatCurrency(months.length > 0 ? totalNetCashFlow / months.length : 0)}</p>
                        </div>
                        <p style="text-align: center; margin-top: 40px; color: #666;">
                            Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
                        </p>
                    </body>
                    </html>
                `;
                
                // Use mobile-friendly modal instead of window.open()
                FinancialReportsModal.show(reportHTML, 'Cash Flow Statement', 'cash-flow');
                Utils.showToast('Cash flow statement generated', 'success');
            }

            async renderForecasting() {
                const periodSelect = document.getElementById('forecast-period-select');
                const refreshBtn = document.getElementById('refresh-forecast-btn');
                const forecastDays = periodSelect ? parseInt(periodSelect.value) : 30;

                if (periodSelect && !periodSelect._bound) {
                    periodSelect.addEventListener('change', () => this.renderForecasting());
                    periodSelect._bound = true;
                }
                if (refreshBtn && !refreshBtn._bound) {
                    refreshBtn.addEventListener('click', () => this.renderForecasting());
                    refreshBtn._bound = true;
                }

                const BACKEND_URL = window.BACKEND_URL || '';

                try {
                    const response = await fetch(`${BACKEND_URL}/api/ai/forecast/advanced`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            historical_sales: state.allSales || [],
                            products_data: state.allProducts || [],
                            forecast_days: forecastDays,
                            include_product_forecast: true
                        })
                    });

                    if (!response.ok) throw new Error('Forecast request failed');
                    const data = await response.json();

                    const dailyAvg = data.predicted_daily_average || 0;
                    const periodTotal = dailyAvg * forecastDays;
                    this.updateElement('fc-daily-avg', Utils.formatCurrency(dailyAvg));
                    this.updateElement('fc-period-total', Utils.formatCurrency(periodTotal));

                    const trendBadge = document.getElementById('fc-trend-badge');
                    if (trendBadge) {
                        const t = data.trend || 'stable';
                        const icon = t === 'up' ? '↑' : t === 'down' ? '↓' : '→';
                        const colors = { up: 'rgba(40,167,69,0.3)', down: 'rgba(220,53,69,0.3)', stable: 'rgba(255,255,255,0.2)' };
                        trendBadge.style.background = colors[t] || colors.stable;
                        trendBadge.textContent = `${icon} ${t.charAt(0).toUpperCase() + t.slice(1)}`;
                    }

                    this.updateElement('fc-confidence', `Confidence: ${(data.confidence || 'Medium').charAt(0).toUpperCase() + (data.confidence || 'medium').slice(1)}`);
                    this.updateElement('fc-data-points', data.data_points || 0);
                    const dp = data.data_points || 0;
                    this.updateElement('fc-data-quality', dp >= 30 ? 'Excellent data' : dp >= 14 ? 'Good data' : dp >= 7 ? 'Fair data' : 'Limited data');

                    const wp = data.weekly_pattern || [];
                    if (wp.length > 0) {
                        const best = wp.reduce((a, b) => a.multiplier > b.multiplier ? a : b);
                        this.updateElement('fc-best-day', best.day || '—');
                        this.updateElement('fc-best-day-mult', `${(best.multiplier * 100).toFixed(0)}% of average`);
                    }

                    const aiPanel = document.getElementById('fc-ai-summary');
                    if (data.ai_summary && aiPanel) {
                        document.getElementById('fc-ai-summary-text').textContent = data.ai_summary;
                        aiPanel.style.display = 'block';
                    }

                    this.renderForecastTrendChart(data);
                    this.renderWeeklyPatternChart(wp);
                    this.renderMonthlyHistoryChart(data.historical_monthly || []);
                    this.renderProductForecastTable(data.product_forecasts || []);
                    this.renderForecastFactors(data.factors || []);

                } catch (error) {
                    console.error('Advanced forecast error, falling back to client-side:', error);
                    this.renderForecastFallback();
                }

                this.renderInventoryAlerts();
            }

            renderForecastFallback() {
                const monthlyRevenues = {};
                state.allSales.forEach(sale => {
                    const month = this.getDatePeriod(sale, 'date', 7);
                    if (!month) return;
                    monthlyRevenues[month] = (monthlyRevenues[month] || 0) +
                        (parseFloat(sale.quantity) || 0) * (parseFloat(sale.price) || 0);
                });
                const revenues = Object.values(monthlyRevenues);
                const avg = revenues.length ? revenues.reduce((a, b) => a + b, 0) / revenues.length : 0;
                this.updateElement('fc-daily-avg', Utils.formatCurrency(avg / 30));
                this.updateElement('fc-period-total', Utils.formatCurrency(avg));
                this.updateElement('fc-data-points', Object.keys(monthlyRevenues).length);
                this.updateElement('fc-data-quality', 'Offline estimate');
            }

            renderForecastTrendChart(data) {
                const canvas = document.getElementById('forecast-trend-chart');
                if (!canvas) return;
                if (state.charts.forecastTrend) state.charts.forecastTrend.destroy();

                const series = data.forecast_series || [];
                const historical = data.historical_monthly || [];
                if (series.length === 0 && historical.length === 0) return;

                const labels = series.map(s => {
                    const d = new Date(s.date);
                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                });
                const predicted = series.map(s => s.predicted);
                const lower = series.map(s => s.lower_bound);
                const upper = series.map(s => s.upper_bound);

                state.charts.forecastTrend = new Chart(canvas.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'Upper Bound',
                                data: upper,
                                borderColor: 'transparent',
                                backgroundColor: 'rgba(0, 123, 255, 0.08)',
                                fill: '+1',
                                pointRadius: 0,
                            },
                            {
                                label: 'Predicted Revenue',
                                data: predicted,
                                borderColor: '#007bff',
                                backgroundColor: 'rgba(0, 123, 255, 0.15)',
                                borderWidth: 2.5,
                                tension: 0.3,
                                fill: false,
                                pointRadius: series.length > 30 ? 0 : 3,
                                pointHoverRadius: 5,
                            },
                            {
                                label: 'Lower Bound',
                                data: lower,
                                borderColor: 'transparent',
                                backgroundColor: 'rgba(0, 123, 255, 0.08)',
                                fill: '-1',
                                pointRadius: 0,
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => {
                                        if (ctx.datasetIndex === 1) return `Predicted: ${Utils.formatCurrency(ctx.parsed.y)}`;
                                        if (ctx.datasetIndex === 0) return `Upper: ${Utils.formatCurrency(ctx.parsed.y)}`;
                                        return `Lower: ${Utils.formatCurrency(ctx.parsed.y)}`;
                                    }
                                }
                            },
                            legend: { labels: { filter: (item) => item.datasetIndex === 1 } }
                        },
                        scales: {
                            y: { beginAtZero: true, ticks: { callback: (v) => Utils.formatCurrency(v) } },
                            x: { ticks: { maxTicksLimit: 10 } }
                        }
                    }
                });
            }

            renderWeeklyPatternChart(weeklyPattern) {
                const canvas = document.getElementById('weekly-pattern-chart');
                if (!canvas || !weeklyPattern.length) return;
                if (state.charts.weeklyPattern) state.charts.weeklyPattern.destroy();

                const colors = weeklyPattern.map(wp =>
                    wp.multiplier >= 1.1 ? 'rgba(40,167,69,0.7)' :
                    wp.multiplier <= 0.9 ? 'rgba(220,53,69,0.7)' :
                    'rgba(0,123,255,0.7)'
                );

                state.charts.weeklyPattern = new Chart(canvas.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: weeklyPattern.map(wp => wp.day.substring(0, 3)),
                        datasets: [{
                            label: 'Sales Multiplier',
                            data: weeklyPattern.map(wp => wp.multiplier),
                            backgroundColor: colors,
                            borderRadius: 4,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            tooltip: { callbacks: { label: (ctx) => `${(ctx.parsed.y * 100).toFixed(0)}% of average` } },
                            legend: { display: false },
                            annotation: { annotations: { baseline: { type: 'line', yMin: 1, yMax: 1, borderColor: '#888', borderWidth: 1, borderDash: [4, 4] } } }
                        },
                        scales: {
                            y: { beginAtZero: true, ticks: { callback: (v) => `${(v * 100).toFixed(0)}%` } }
                        }
                    }
                });
            }

            renderMonthlyHistoryChart(monthlyData) {
                const canvas = document.getElementById('monthly-history-chart');
                if (!canvas || !monthlyData.length) return;
                if (state.charts.monthlyHistory) state.charts.monthlyHistory.destroy();

                state.charts.monthlyHistory = new Chart(canvas.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: monthlyData.map(m => {
                            const d = new Date(m.month + '-01');
                            return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                        }),
                        datasets: [{
                            label: 'Revenue',
                            data: monthlyData.map(m => m.revenue),
                            backgroundColor: 'rgba(102, 126, 234, 0.7)',
                            borderRadius: 4,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            tooltip: { callbacks: { label: (ctx) => Utils.formatCurrency(ctx.parsed.y) } },
                            legend: { display: false }
                        },
                        scales: {
                            y: { beginAtZero: true, ticks: { callback: (v) => Utils.formatCurrency(v) } }
                        }
                    }
                });
            }

            renderProductForecastTable(forecasts) {
                const container = document.getElementById('product-forecast-table');
                if (!container) return;

                if (!forecasts.length) {
                    container.innerHTML = '<p style="color:#888;text-align:center;padding:1rem;">No product forecast data available</p>';
                    return;
                }

                const rows = forecasts.slice(0, 20).map(f => {
                    const stockoutColor = f.days_until_stockout <= 7 ? '#dc3545' : f.days_until_stockout <= 14 ? '#ffc107' : '#28a745';
                    const velocityIcon = f.velocity === 'high' ? '🔥' : f.velocity === 'low' ? '🐌' : '➡️';
                    return `<tr>
                        <td><strong>${f.product}</strong></td>
                        <td>${f.current_stock}</td>
                        <td>${f.recent_daily_demand}/day</td>
                        <td>${Math.round(f.forecasted_demand)}</td>
                        <td style="color:${stockoutColor};font-weight:600;">${f.days_until_stockout >= 999 ? '∞' : f.days_until_stockout + 'd'}</td>
                        <td>${f.reorder_quantity > 0 ? '<strong>' + f.reorder_quantity + '</strong>' : '—'}</td>
                        <td>${velocityIcon} ${f.velocity}</td>
                        <td>${Utils.formatCurrency(f.estimated_reorder_cost)}</td>
                    </tr>`;
                }).join('');

                container.innerHTML = `
                    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                        <thead><tr style="border-bottom:2px solid #ddd;text-align:left;">
                            <th style="padding:0.75rem 0.5rem;">Product</th>
                            <th style="padding:0.75rem 0.5rem;">Stock</th>
                            <th style="padding:0.75rem 0.5rem;">Daily Demand</th>
                            <th style="padding:0.75rem 0.5rem;">Period Demand</th>
                            <th style="padding:0.75rem 0.5rem;">Stockout In</th>
                            <th style="padding:0.75rem 0.5rem;">Reorder Qty</th>
                            <th style="padding:0.75rem 0.5rem;">Velocity</th>
                            <th style="padding:0.75rem 0.5rem;">Reorder Cost</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>`;
            }

            renderForecastFactors(factors) {
                const container = document.getElementById('forecast-factors');
                if (!container) return;
                container.innerHTML = factors.map(f =>
                    `<div style="background:#f0f4ff;padding:0.6rem 1rem;border-radius:20px;font-size:0.85rem;border:1px solid #d0d8f0;">
                        <i class="fas fa-info-circle" style="color:#007bff;margin-right:0.4rem;"></i>${f}
                    </div>`
                ).join('');
            }

            renderInventoryAlerts() {
                const alertsDiv = document.getElementById('inventory-alerts');
                if (!alertsDiv) return;
                
                const lowStockProducts = state.allProducts.filter(p => 
                    p.quantity <= (p.minStock || 10)
                );
                
                const outOfStockProducts = state.allProducts.filter(p => p.quantity === 0);
                
                if (lowStockProducts.length === 0 && outOfStockProducts.length === 0) {
                    alertsDiv.innerHTML = '<p style="color: green;"><i class="fas fa-check-circle"></i> All products are adequately stocked</p>';
                    return;
                }
                
                let html = '';
                
                if (outOfStockProducts.length > 0) {
                    html += '<div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 1rem; margin-bottom: 1rem; border-radius: 4px;">';
                    html += '<h4 style="color: #721c24; margin-bottom: 0.5rem;"><i class="fas fa-exclamation-circle"></i> Out of Stock</h4>';
                    html += '<ul style="margin: 0; padding-left: 1.5rem;">';
                    outOfStockProducts.forEach(p => {
                        html += `<li><strong>${p.name}</strong> - Stock: 0</li>`;
                    });
                    html += '</ul></div>';
                }
                
                if (lowStockProducts.length > 0) {
                    html += '<div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 1rem; border-radius: 4px;">';
                    html += '<h4 style="color: #856404; margin-bottom: 0.5rem;"><i class="fas fa-exclamation-triangle"></i> Low Stock Warning</h4>';
                    html += '<ul style="margin: 0; padding-left: 1.5rem;">';
                    lowStockProducts.filter(p => p.quantity > 0).forEach(p => {
                        html += `<li><strong>${p.name}</strong> - Stock: ${p.quantity} (Min: ${p.minStock || 10})</li>`;
                    });
                    html += '</ul></div>';
                }
                
                alertsDiv.innerHTML = html;
            }

            applyTheme(themeKey) {
                const root = document.documentElement;
                const valid = ['classic', 'modern', 'corporate', 'minimal', 'ocean', 'forest', 'sunset', 'dark'];
                if (themeKey && valid.includes(themeKey)) {
                    root.setAttribute('data-theme', themeKey);
                } else {
                    root.removeAttribute('data-theme');
                }
            }

            isDebtPayment(expense) { return isDebtPayment(expense); }

            getCurrencySymbolFromSetting(currency) {
                const currencyMap = {
                    'GHS (₵)': '₵',
                    'USD ($)': '$',
                    'EUR (€)': '€',
                    'GBP (£)': '£'
                };
                if (currencyMap[currency]) return currencyMap[currency];
                if (currency && currency.indexOf('GHS') !== -1) return '₵';
                if (currency && currency.indexOf('USD') !== -1) return '$';
                if (currency && currency.indexOf('EUR') !== -1) return '€';
                if (currency && currency.indexOf('GBP') !== -1) return '£';
                return (typeof CONFIG !== 'undefined' && CONFIG.defaults && CONFIG.defaults.currencySymbol) ? CONFIG.defaults.currencySymbol : '₵';
            }

            async loadSettings() {
                try {
                    const settingsDoc = await getDoc(firebaseService.settingsRef());
                    if (settingsDoc.exists()) {
                        const settings = settingsDoc.data();
                        state.currencySymbol = this.getCurrencySymbolFromSetting(settings.currency);
                        this.applyTheme(settings.theme || 'classic');
                        const businessNameEl = document.getElementById('business-name');
                        if (businessNameEl) {
                            businessNameEl.value = settings.name || '';
                            document.getElementById('default-tax').value = settings.tax || 0;
                            document.getElementById('currency-select').value = settings.currency || 'GHS (₵)';
                            const themeEl = document.getElementById('theme-select');
                            if (themeEl) themeEl.value = settings.theme || 'classic';
                            document.getElementById('low-stock-threshold').value = settings.lowStockThreshold || 10;
                            document.getElementById('email-notifications').checked = settings.emailNotifications || false;
                            document.getElementById('daily-reports').checked = settings.dailyReports || false;
                            document.getElementById('notification-email').value = settings.notificationEmail || '';
                        }
                    }
                    if (document.querySelector('#activity-log-table tbody')) await this.renderActivityLog();
                } catch (error) {
                    console.error('Failed to load settings:', error);
                }
            }

            async handleSaveSettings(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const settings = {
                        name: document.getElementById('business-name').value,
                        tax: parseFloat(document.getElementById('default-tax').value),
                        currency: document.getElementById('currency-select').value,
                        theme: document.getElementById('theme-select')?.value || 'classic',
                        lowStockThreshold: parseInt(document.getElementById('low-stock-threshold').value),
                        emailNotifications: document.getElementById('email-notifications').checked,
                        dailyReports: document.getElementById('daily-reports').checked,
                        notificationEmail: document.getElementById('notification-email').value
                    };
                    
                    await setDoc(firebaseService.settingsRef(), settings);
                    state.currencySymbol = this.getCurrencySymbolFromSetting(settings.currency);
                    this.applyTheme(settings.theme);
                    await ActivityLogger.log('Settings Updated', 'Business settings updated');

                    this._syncEmailSettingsToBackend(settings);
                    
                    Utils.showToast('Settings saved successfully', 'success');
                    this.markSectionDirty('dashboard');
                    this._refreshCurrentSectionIfDirty();
                } catch (error) {
                    Utils.showToast('Failed to save settings: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            _syncEmailSettingsToBackend(settings) {
                const BACKEND_URL = window.BACKEND_URL || '';
                fetch(`${BACKEND_URL}/api/email/settings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        emailNotifications: !!settings.emailNotifications,
                        dailyReports: !!settings.dailyReports,
                        notificationEmail: settings.notificationEmail || ''
                    })
                }).catch(err => console.warn('Backend email settings sync failed:', err.message));
            }

            async renderActivityLog() {
                const tbody = document.querySelector('#activity-log-table tbody');
                if (!tbody) return;
                
                tbody.innerHTML = '<tr><td colspan="3" class="no-data">Loading...</td></tr>';
                
                const activities = await ActivityLogger.getRecentActivities(50);
                
                if (activities.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="3" class="no-data">No activities recorded</td></tr>';
                    return;
                }
                
                tbody.innerHTML = activities.map(activity => `
                    <tr>
                        <td>${new Date(activity.timestamp).toLocaleString()}</td>
                        <td><strong>${activity.action}</strong></td>
                        <td>${activity.details}</td>
                    </tr>
                `).join('');
            }

            calculateLoan() {
                const principal = parseFloat(document.getElementById('loan-amount').value);
                const annualRate = parseFloat(document.getElementById('loan-rate').value);
                const months = parseInt(document.getElementById('loan-term').value);
                
                if (!principal || !annualRate || !months) {
                    Utils.showToast('Please fill all fields', 'warning');
                    return;
                }
                
                const monthlyRate = annualRate / 100 / 12;
                const monthlyPayment = principal * monthlyRate * Math.pow(1 + monthlyRate, months) / 
                                      (Math.pow(1 + monthlyRate, months) - 1);
                const totalRepayment = monthlyPayment * months;
                const totalInterest = totalRepayment - principal;
                
                document.getElementById('monthly-payment').textContent = Utils.formatCurrency(monthlyPayment);
                document.getElementById('total-interest').textContent = Utils.formatCurrency(totalInterest);
                document.getElementById('total-repayment').textContent = Utils.formatCurrency(totalRepayment);
                document.getElementById('loan-results').style.display = 'block';
            }
            
            calculatePrice() {
                const cost = parseFloat(document.getElementById('cost-price').value);
                const margin = parseFloat(document.getElementById('profit-margin').value);
                const tax = parseFloat(document.getElementById('pricing-tax').value) || 0;
                
                if (!cost || !margin) {
                    Utils.showToast('Please fill all required fields', 'warning');
                    return;
                }
                
                const sellingPrice = cost * (1 + margin / 100);
                const sellingPriceWithTax = sellingPrice * (1 + tax / 100);
                const profitPerUnit = sellingPrice - cost;
                
                document.getElementById('selling-price').textContent = Utils.formatCurrency(sellingPrice);
                document.getElementById('selling-price-tax').textContent = Utils.formatCurrency(sellingPriceWithTax);
                document.getElementById('profit-per-unit').textContent = Utils.formatCurrency(profitPerUnit);
                document.getElementById('pricing-results').style.display = 'block';
            }
            openInvoiceModal() {
                const select = document.getElementById('invoice-sale-select');
                if (!select) return;
                
                select.innerHTML = '<option value="">Select a sale...</option>';
                
                const sortedSales = [...state.allSales].sort((a, b) => 
                    new Date(b.date) - new Date(a.date)
                );
                
                sortedSales.forEach(sale => {
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const total = discounted * (1 + (sale.tax || 0) / 100);
                    
                    select.innerHTML += `
                        <option value="${sale.id}">
                            ${sale.date} - ${sale.customer} - ${sale.product} - ${Utils.formatCurrency(total)}
                        </option>
                    `;
                });
                
                document.getElementById('invoice-preview-container').style.display = 'none';
                document.getElementById('invoice-modal').style.display = 'block';
            }

            async generateInvoicePreview() {
                const saleId = document.getElementById('invoice-sale-select')?.value;
                if (!saleId) {
                    Utils.showToast('Please select a sale', 'warning');
                    return;
                }
                
                const sale = state.allSales.find(s => s.id === saleId);
                if (!sale) {
                    Utils.showToast('Sale not found', 'error');
                    return;
                }
                
                let businessName = 'My Business';
                try {
                    const settingsDoc = await getDoc(firebaseService.settingsRef());
                    if (settingsDoc.exists()) {
                        businessName = settingsDoc.data().name || 'My Business';
                    }
                } catch (error) {
                    console.error('Failed to load settings:', error);
                }
                
                const subtotal = sale.quantity * sale.price;
                const discountAmount = subtotal * (sale.discount || 0) / 100;
                const subtotalAfterDiscount = subtotal - discountAmount;
                const taxAmount = subtotalAfterDiscount * (sale.tax || 0) / 100;
                const total = subtotalAfterDiscount + taxAmount;
                
                const customer = state.allCustomers.find(c => c.name === sale.customer);
                const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;
                
                const invoiceHTML = `
                    <div class="invoice-header">
                        <div>
                            <h2 style="margin: 0; color: #007bff;">${businessName}</h2>
                            <p style="margin: 0.5rem 0 0 0; color: #666;">
                                Business Address<br>
                                Phone: (000) 000-0000<br>
                                Email: business@example.com
                            </p>
                        </div>
                        <div style="text-align: right;">
                            <h3 style="margin: 0;">INVOICE</h3>
                            <p style="margin: 0.5rem 0 0 0;">
                                <strong>Invoice #:</strong> ${invoiceNumber}<br>
                                <strong>Date:</strong> ${sale.date}<br>
                                <strong>Due Date:</strong> ${sale.date}
                            </p>
                        </div>
                    </div>
                    
                    <div class="invoice-details">
                        <div>
                            <h4 style="margin: 0 0 0.5rem 0; color: #007bff;">Bill To:</h4>
                            <p style="margin: 0;">
                                <strong>${sale.customer}</strong><br>
                                ${customer?.email || ''}<br>
                                ${customer?.phone || ''}<br>
                                ${customer?.address || ''}
                            </p>
                        </div>
                        <div>
                            <h4 style="margin: 0 0 0.5rem 0; color: #007bff;">Payment Info:</h4>
                            <p style="margin: 0;">
                                <strong>Status:</strong> Paid<br>
                                <strong>Method:</strong> Cash
                            </p>
                        </div>
                    </div>
                    
                    <div class="invoice-items">
                        <table>
                            <thead>
                                <tr style="background: #f8f9fa;">
                                    <th style="text-align: left; padding: 0.75rem;">Description</th>
                                    <th style="text-align: center; padding: 0.75rem;">Quantity</th>
                                    <th style="text-align: right; padding: 0.75rem;">Unit Price</th>
                                    <th style="text-align: right; padding: 0.75rem;">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td style="padding: 0.75rem;">${sale.product}</td>
                                    <td style="text-align: center; padding: 0.75rem;">${sale.quantity}</td>
                                    <td style="text-align: right; padding: 0.75rem;">${Utils.formatCurrency(sale.price)}</td>
                                    <td style="text-align: right; padding: 0.75rem;">${Utils.formatCurrency(subtotal)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    
                    <div style="display: flex; justify-content: flex-end;">
                        <div style="width: 300px;">
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #ddd;">
                                <span>Subtotal:</span>
                                <span>${Utils.formatCurrency(subtotal)}</span>
                            </div>
                            ${sale.discount > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #ddd; color: #28a745;">
                                <span>Discount (${sale.discount}%):</span>
                                <span>-${Utils.formatCurrency(discountAmount)}</span>
                            </div>
                            ` : ''}
                            ${sale.tax > 0 ? `
                            <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #ddd;">
                                <span>Tax (${sale.tax}%):</span>
                                <span>${Utils.formatCurrency(taxAmount)}</span>
                            </div>
                            ` : ''}
                            <div class="invoice-total">
                                <strong>Total: ${Utils.formatCurrency(total)}</strong>
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #ddd; text-align: center; color: #666;">
                        <p style="margin: 0;">Thank you for your business!</p>
                        <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem;">
                            For questions about this invoice, please contact us.
                        </p>
                    </div>
                `;
                
                document.getElementById('invoice-preview').innerHTML = invoiceHTML;
                document.getElementById('invoice-preview-container').style.display = 'block';
                
                this.currentInvoiceData = {
                    sale,
                    invoiceNumber,
                    businessName,
                    subtotal,
                    discountAmount,
                    taxAmount,
                    total
                };
            }

            downloadInvoicePDF() {
                const element = document.getElementById('invoice-preview');
                if (!element) return;
                
                const opt = {
                    margin: 10,
                    filename: `invoice_${this.currentInvoiceData?.invoiceNumber || Date.now()}.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2 },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };
                
                html2pdf().set(opt).from(element).save();
                Utils.showToast('Invoice downloaded', 'success');
            }

            emailInvoice() {
                if (!this.currentInvoiceData) {
                    Utils.showToast('No invoice generated', 'error');
                    return;
                }
                
                const customer = state.allCustomers.find(c => 
                    c.name === this.currentInvoiceData.sale.customer
                );
                
                if (!customer || !customer.email) {
                    Utils.showToast('Customer email not found', 'error');
                    return;
                }
                
                const templateParams = {
                    to_email: customer.email,
                    to_name: customer.name,
                    invoice_number: this.currentInvoiceData.invoiceNumber,
                    invoice_date: this.currentInvoiceData.sale.date,
                    total_amount: Utils.formatCurrency(this.currentInvoiceData.total),
                    business_name: this.currentInvoiceData.businessName
                };
                
                Utils.showSpinner();
                
                emailjs.send('service_x4hgyq2', 'template_xf12d5d', templateParams)
                    .then(() => {
                        Utils.showToast('Invoice emailed successfully', 'success');
                    })
                    .catch((error) => {
                        console.error('Email error:', error);
                        Utils.showToast('Failed to send email: ' + error.text, 'error');
                    })
                    .finally(() => {
                        Utils.hideSpinner();
                    });
            }

            /** Print receipts for a single date group (sales under that date header) */
            printSalesForDate(dateKey) {
                const customerSearch = (document.getElementById('sales-customer-search')?.value || '').toString().toLowerCase();
                const productSearch = (document.getElementById('sales-product-search-table')?.value || '').toString().toLowerCase();
                const dateFilter = document.getElementById('sales-date-filter')?.value || 'all';
                
                let filtered = Array.isArray(state.allSales) ? [...state.allSales] : [];
                if (dateFilter !== 'all') {
                    const { start, end } = Utils.getDateRange(dateFilter === 'today' ? 'day' : dateFilter);
                    filtered = filtered.filter(s => {
                        const d = this.getDatePeriod(s, 'date', 10);
                        return d && d >= start && d <= end;
                    });
                }
                if (customerSearch) filtered = filtered.filter(s => ((s.customer || '').toString().toLowerCase()).includes(customerSearch));
                if (productSearch) filtered = filtered.filter(s => ((s.product || '').toString().toLowerCase()).includes(productSearch));
                
                const sales = filtered.filter(s => (this.getDatePeriod(s, 'date', 10) || s.date) === dateKey);
                if (sales.length === 0) {
                    Utils.showToast('No sales for this date', 'warning');
                    return;
                }
                
                const productMap = new Map((state.allProducts || []).map(p => [p.name, p]));
                let dailyRevenue = 0;
                let dailyCost = 0;
                sales.forEach(sale => {
                    const qty = parseFloat(sale.quantity) || 0;
                    const price = parseFloat(sale.price) || 0;
                    const discount = parseFloat(sale.discount) || 0;
                    const tax = parseFloat(sale.tax) || 0;
                    const subtotal = qty * price;
                    const discounted = subtotal * (1 - discount / 100);
                    dailyRevenue += discounted * (1 + tax / 100);

                    // Prefer sale-time cost snapshot; fall back to current product cost
                    const saleCostPerUnit = parseFloat(sale.cost);
                    if (!Number.isNaN(saleCostPerUnit) && saleCostPerUnit > 0) {
                        dailyCost += qty * saleCostPerUnit;
                    } else {
                        const product = productMap.get(sale.product);
                        if (product) {
                            const productCost = parseFloat(product.cost) || 0;
                            dailyCost += qty * productCost;
                        }
                    }
                });
                const dailyProfit = dailyRevenue - dailyCost;
                
                const rows = sales.map(sale => {
                    const qty = parseFloat(sale.quantity) || 0;
                    const price = parseFloat(sale.price) || 0;
                    const discount = parseFloat(sale.discount) || 0;
                    const tax = parseFloat(sale.tax) || 0;
                    const subtotal = qty * price;
                    const discounted = subtotal * (1 - discount / 100);
                    const total = discounted * (1 + tax / 100);
                    const cust = (sale.customer || '').toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    const prod = (sale.product || '').toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return `<tr><td>${cust}</td><td>${prod}</td><td>${sale.quantity}</td><td>${Utils.formatCurrency(price)}</td><td>${Utils.formatCurrency(total)}</td></tr>`;
                }).join('');
                
                const printHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Sales receipts - ${dateKey}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 16px; }
                            h1 { font-size: 18px; margin-bottom: 8px; }
                            .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
                            table { width: 100%; border-collapse: collapse; }
                            th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
                            th { background: #f5f5f5; }
                            .no-print { margin-bottom: 12px; }
                            @media print { .no-print { display: none; } }
                        </style>
                    </head>
                    <body>
                        <div class="no-print">
                            <button onclick="window.print()" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Print</button>
                        </div>
                        <h1>Sales receipts — ${dateKey}</h1>
                        <p class="meta">${sales.length} sale(s) | Revenue: ${Utils.formatCurrency(dailyRevenue)} | Profit: ${Utils.formatCurrency(dailyProfit)} | Generated: ${new Date().toLocaleString()}</p>
                        <table>
                            <thead><tr><th>Customer</th><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </body>
                    </html>
                `;
                
                const printWindow = window.open('', '_blank');
                printWindow.document.write(printHTML);
                printWindow.document.close();
                printWindow.focus();
                setTimeout(() => printWindow.print(), 300);
            }

            /** Print sales report grouped by date (respects current date/customer/product filters) */
            printSalesGroupByDate() {
                const dateFilter = document.getElementById('sales-date-filter')?.value || 'all';
                const customerSearch = (document.getElementById('sales-customer-search')?.value || '').toString().toLowerCase();
                const productSearch = (document.getElementById('sales-product-search-table')?.value || '').toString().toLowerCase();
                
                let filtered = Array.isArray(state.allSales) ? [...state.allSales] : [];
                if (dateFilter !== 'all') {
                    const { start, end } = Utils.getDateRange(dateFilter === 'today' ? 'day' : dateFilter);
                    filtered = filtered.filter(s => {
                        const d = this.getDatePeriod(s, 'date', 10);
                        return d && d >= start && d <= end;
                    });
                }
                if (customerSearch) {
                    filtered = filtered.filter(s => ((s.customer || '').toString().toLowerCase()).includes(customerSearch));
                }
                if (productSearch) {
                    filtered = filtered.filter(s => ((s.product || '').toString().toLowerCase()).includes(productSearch));
                }
                
                const grouped = {};
                filtered.forEach(sale => {
                    const dateKey = this.getDatePeriod(sale, 'date', 10) || (sale.date || 'Unknown date');
                    if (!grouped[dateKey]) grouped[dateKey] = [];
                    grouped[dateKey].push(sale);
                });
                const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
                
                if (sortedDates.length === 0) {
                    Utils.showToast('No sales to print for current filters', 'warning');
                    return;
                }
                
                const productMap = new Map((state.allProducts || []).map(p => [p.name, p]));
                let bodyRows = '';
                let grandRevenue = 0;
                let grandProfit = 0;
                
                sortedDates.forEach(date => {
                    const sales = grouped[date];
                    let dailyRevenue = 0;
                    let dailyCost = 0;
                    sales.forEach(sale => {
                        const qty = parseFloat(sale.quantity) || 0;
                        const price = parseFloat(sale.price) || 0;
                        const discount = parseFloat(sale.discount) || 0;
                        const tax = parseFloat(sale.tax) || 0;
                        const subtotal = qty * price;
                        const discounted = subtotal * (1 - discount / 100);
                        dailyRevenue += discounted * (1 + tax / 100);
                        // Prefer sale-time cost snapshot; fall back to current product cost
                        const saleCostPerUnit = parseFloat(sale.cost);
                        if (!Number.isNaN(saleCostPerUnit) && saleCostPerUnit > 0) {
                            dailyCost += qty * saleCostPerUnit;
                        } else {
                            const product = productMap.get(sale.product);
                            if (product) {
                                const productCost = parseFloat(product.cost) || 0;
                                dailyCost += qty * productCost;
                            }
                        }
                    });
                    const dailyProfit = dailyRevenue - dailyCost;
                    grandRevenue += dailyRevenue;
                    grandProfit += dailyProfit;
                    
                    bodyRows += `
                        <tr><td colspan="5" style="background:#f0f0f0;font-weight:bold;padding:8px;border:1px solid #ddd;">${date} — ${sales.length} sale(s) | Revenue: ${Utils.formatCurrency(dailyRevenue)} | Profit: ${Utils.formatCurrency(dailyProfit)}</td></tr>
                        <tr><th>Customer</th><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr>
                        ${sales.map(sale => {
                            const qty = parseFloat(sale.quantity) || 0;
                            const price = parseFloat(sale.price) || 0;
                            const discount = parseFloat(sale.discount) || 0;
                            const tax = parseFloat(sale.tax) || 0;
                            const subtotal = qty * price;
                            const discounted = subtotal * (1 - discount / 100);
                            const total = discounted * (1 + tax / 100);
                            const cust = (sale.customer || '').toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            const prod = (sale.product || '').toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            return `<tr><td>${cust}</td><td>${prod}</td><td>${sale.quantity}</td><td>${Utils.formatCurrency(price)}</td><td>${Utils.formatCurrency(total)}</td></tr>`;
                        }).join('')}
                    `;
                });
                
                const title = dateFilter !== 'all' ? `Sales by Date (${dateFilter})` : 'Sales by Date (All Time)';
                const printHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>${title}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 16px; }
                            h1 { font-size: 18px; margin-bottom: 8px; }
                            .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
                            table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
                            th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
                            th { background: #f5f5f5; }
                            .no-print { margin-bottom: 12px; }
                            @media print { .no-print { display: none; } }
                        </style>
                    </head>
                    <body>
                        <div class="no-print">
                            <button onclick="window.print()" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Print</button>
                        </div>
                        <h1>${title}</h1>
                        <p class="meta">Generated: ${new Date().toLocaleString()} | Total revenue: ${Utils.formatCurrency(grandRevenue)} | Total profit: ${Utils.formatCurrency(grandProfit)}</p>
                        <table>
                            ${bodyRows}
                        </table>
                    </body>
                    </html>
                `;
                
                const printWindow = window.open('', '_blank');
                printWindow.document.write(printHTML);
                printWindow.document.close();
                printWindow.focus();
                setTimeout(() => printWindow.print(), 300);
            }

            exportSalesCSV() {
                const data = [['Date', 'Customer', 'Product', 'Quantity', 'Price', 'Discount', 'Tax', 'Total']];
                
                state.allSales.forEach(sale => {
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const total = discounted * (1 + (sale.tax || 0) / 100);
                    
                    data.push([
                        sale.date,
                        sale.customer,
                        sale.product,
                        sale.quantity,
                        sale.price,
                        sale.discount || 0,
                        sale.tax || 0,
                        total.toFixed(2)
                    ]);
                });
                
                Utils.exportToCSV(data, 'sales_export.csv');
            }

            exportInventoryCSV() {
                const data = [['Product', 'Category', 'Cost', 'Price', 'Quantity', 'Value']];
                
                state.allProducts.forEach(product => {
                    data.push([
                        product.name,
                        product.category,
                        product.cost,
                        product.price,
                        product.quantity,
                        (product.cost * product.quantity).toFixed(2)
                    ]);
                });
                
                Utils.exportToCSV(data, 'inventory_export.csv');
            }

            exportExpensesCSV() {
                const data = [['Date', 'Description', 'Category', 'Amount']];
                
                state.allExpenses.forEach(expense => {
                    data.push([
                        expense.date,
                        expense.description,
                        expense.category,
                        expense.amount.toFixed(2)
                    ]);
                });
                
                Utils.exportToCSV(data, 'expenses_export.csv');
            }

            exportCustomersCSV() {
                const data = [['Name', 'Email', 'Phone', 'Address', 'Total Purchases', 'Last Purchase']];
                
                state.allCustomers.forEach(customer => {
                    const customerSales = state.allSales.filter(s => s.customer === customer.name);
                    const totalPurchases = customerSales.reduce((sum, s) => {
                        const subtotal = s.quantity * s.price;
                        const discounted = subtotal * (1 - (s.discount || 0) / 100);
                        return sum + discounted * (1 + (s.tax || 0) / 100);
                    }, 0);
                    
                    const lastPurchase = customerSales.length > 0
                        ? customerSales.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date
                        : 'Never';
                    
                    data.push([
                        customer.name,
                        customer.email || '',
                        customer.phone || '',
                        customer.address || '',
                        totalPurchases.toFixed(2),
                        lastPurchase
                    ]);
                });
                
                Utils.exportToCSV(data, 'customers_export.csv');
            }

            // ==================== OUTLET MANAGEMENT METHODS ====================

            async handleAddOutlet(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const outletData = {
                        name: document.getElementById('outlet-name').value,
                        location: document.getElementById('outlet-location').value,
                        manager: document.getElementById('outlet-manager').value,
                        phone: document.getElementById('outlet-phone').value,
                        email: document.getElementById('outlet-email').value,
                        commissionRate: parseFloat(document.getElementById('outlet-commission').value),
                        notes: document.getElementById('outlet-notes').value || '',
                        status: 'active',
                        createdAt: new Date().toISOString(),
                        createdBy: state.currentUser.uid,
                        inventoryValue: 0
                    };
                    
                    // Validate email format
                    if (!Utils.validateEmail(outletData.email)) {
                        Utils.showToast('Please enter a valid email address', 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    // Add outlet to Firestore
                    const outletRef = await addDoc(firebaseService.getOutletsCollection(), outletData);
                    
                    // Create info subdocument
                    await setDoc(
                        doc(db, 'users', state.currentUser.uid, 'outlets', outletRef.id),
                        outletData
                    );
                    
                    // Log activity
                    await ActivityLogger.log('Outlet Created', `Created outlet: ${outletData.name}`);
                    
                    Utils.showToast('Outlet created successfully', 'success');
                    document.getElementById('add-outlet-modal').style.display = 'none';
                    document.getElementById('add-outlet-form').reset();
                    
                    // Reload outlets
                    await dataLoader.loadOutlets();
                    this.renderOutlets();
                    
                } catch (error) {
                    Utils.showToast('Failed to create outlet: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async handleEditOutlet(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const outletId = document.getElementById('edit-outlet-id').value;
                    const outletData = {
                        name: document.getElementById('edit-outlet-name').value,
                        location: document.getElementById('edit-outlet-location').value,
                        manager: document.getElementById('edit-outlet-manager').value,
                        phone: document.getElementById('edit-outlet-phone').value,
                        commissionRate: parseFloat(document.getElementById('edit-outlet-commission').value),
                        status: document.getElementById('edit-outlet-status').value,
                        notes: document.getElementById('edit-outlet-notes').value || '',
                        updatedAt: new Date().toISOString()
                    };
                    
                    // Update outlet
                    await updateDoc(
                        doc(db, 'users', state.currentUser.uid, 'outlets', outletId),
                        outletData
                    );
                    
                    // Update info subdocument
                    await updateDoc(
                        doc(db, 'users', state.currentUser.uid, 'outlets', outletId),
                        outletData
                    );
                    
                    await ActivityLogger.log('Outlet Updated', `Updated outlet: ${outletData.name}`);
                    
                    Utils.showToast('Outlet updated successfully', 'success');
                    document.getElementById('edit-outlet-modal').style.display = 'none';
                    
                    await dataLoader.loadOutlets();
                    this.renderOutlets();
                    
                } catch (error) {
                    Utils.showToast('Failed to update outlet: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            editOutlet(outletId) {
                const outlet = state.allOutlets.find(o => o.id === outletId);
                if (!outlet) return;
                
                document.getElementById('edit-outlet-id').value = outlet.id;
                document.getElementById('edit-outlet-name').value = outlet.name;
                document.getElementById('edit-outlet-location').value = outlet.location;
                document.getElementById('edit-outlet-manager').value = outlet.manager;
                document.getElementById('edit-outlet-phone').value = outlet.phone;
                document.getElementById('edit-outlet-commission').value = outlet.commissionRate;
                document.getElementById('edit-outlet-status').value = outlet.status;
                document.getElementById('edit-outlet-notes').value = outlet.notes || '';
                
                document.getElementById('edit-outlet-modal').style.display = 'block';
            }

            async deleteOutlet(outletId) {
                const outlet = state.allOutlets.find(o => o.id === outletId);
                if (!outlet) return;
                
                if (!confirm(`Delete outlet "${outlet.name}"? This will delete all associated data including consignments and settlements. This action cannot be undone.`)) {
                    return;
                }
                
                Utils.showSpinner();
                try {
                    // Delete all subcollections first
                    const collections = ['inventory', 'consignments', 'sales', 'settlements', 'outlets'];
                    
                    for (const collName of collections) {
                        const snapshot = await getDocs(
                            collection(db, 'users', state.currentUser.uid, 'outlets', outletId, collName)
                        );
                        
                        const batch = writeBatch(db);
                        snapshot.forEach(doc => {
                            batch.delete(doc.ref);
                        });
                        await batch.commit();
                    }
                    
                    // Delete outlet document
                    await deleteDoc(doc(db, 'users', state.currentUser.uid, 'outlets', outletId));
                    
                    await ActivityLogger.log('Outlet Deleted', `Deleted outlet: ${outlet.name}`);
                    
                    Utils.showToast('Outlet deleted successfully', 'success');
                    
                    await dataLoader.loadOutlets();
                    this.renderOutlets();
                    
                } catch (error) {
                    Utils.showToast('Failed to delete outlet: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async viewOutletDetails(outletId) {
                const outlet = state.allOutlets.find(o => o.id === outletId);
                if (!outlet) return;
                
                // Navigate to a detailed view or show modal
                Utils.showToast('Outlet details view - to be implemented', 'info');
                // You can create a detailed modal or navigate to a dashboard filtered for this outlet
            }

            renderOutlets() {
                // Render outlet cards
                const outletsGrid = document.getElementById('outlets-grid');
                console.log("Outlets: ", state.allOutlets)
                if (outletsGrid) {
                    if (state.allOutlets.length === 0) {
                        outletsGrid.innerHTML = '<div class="no-data" style="grid-column: 1/-1;">No outlets found. Click "Add New Outlet" to create one.</div>';
                    } else {
                        outletsGrid.innerHTML = state.allOutlets.map(outlet => `
                            <div class="outlet-card">
                                <h3>${outlet.name}</h3>
                                <p style="margin: 0.5rem 0; font-size: 0.9rem; opacity: 0.9;">
                                    <i class="fas fa-map-marker-alt"></i> ${outlet.location}
                                </p>
                                <div class="outlet-stats">
                                    <div>
                                        <small>Inventory Value</small><br>
                                        <strong>${Utils.formatCurrency(outlet.inventoryValue || 0)}</strong>
                                    </div>
                                    <div>
                                        <small>Commission</small><br>
                                        <strong>${outlet.commissionRate}%</strong>
                                    </div>
                                    <div>
                                        <small>Manager</small><br>
                                        <strong>${outlet.manager}</strong>
                                    </div>
                                    <div>
                                        <small>Status</small><br>
                                        <strong style="color: ${outlet.status === 'active' ? '#28a745' : '#dc3545'};">
                                            ${outlet.status.toUpperCase()}
                                        </strong>
                                    </div>
                                </div>
                            </div>
                        `).join('');
                    }
                }
                
                // Render outlets table
                const tbody = document.querySelector('#outlets-table tbody');
                if (tbody) {
                    if (state.allOutlets.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="7" class="no-data">No outlets found</td></tr>';
                    } else {
                        tbody.innerHTML = state.allOutlets.map(outlet => `
                            <tr>
                                <td><strong>${outlet.name}</strong></td>
                                <td>${outlet.location}</td>
                                <td>${outlet.manager}</td>
                                <td>${outlet.phone}</td>
                                <td>${Utils.formatCurrency(outlet.inventoryValue || 0)}</td>
                                <td>
                                    <span style="padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; background: ${outlet.status === 'active' ? '#d4edda' : '#f8d7da'}; color: ${outlet.status === 'active' ? '#155724' : '#721c24'};">
                                        ${outlet.status.toUpperCase()}
                                    </span>
                                </td>
                                <td class="actions">
                                    <button onclick="appController.viewOutletDetails('${outlet.id}')" title="View Details">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button onclick="appController.editOutlet('${outlet.id}')" title="Edit">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="danger" onclick="appController.deleteOutlet('${outlet.id}')" title="Delete">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('');
                    }
                }

                const transfersContainer = document.getElementById('stock-transfers-container');
                if (transfersContainer) {
                    (async () => {
                        const transfers = [];
                        for (const outlet of state.allOutlets) {
                            try {
                                const ownerUid = outlet.createdBy || state.currentUser.uid;
                                const snapshot = await getDocs(
                                    collection(db, 'users', ownerUid, 'outlets', outlet.id, 'outlet_inventory')
                                );
                                snapshot.forEach(d => {
                                    const data = d.data();
                                    if (data.transferredFrom || data.transferredAt) {
                                        transfers.push({
                                            id: d.id,
                                            product: data.name || 'Unknown',
                                            quantity: data.lastTransferQty || data.quantity || 0,
                                            from: data.transferredFrom || 'Main Shop',
                                            to: outlet.name,
                                            date: data.transferredAt || data.createdAt || ''
                                        });
                                    }
                                });
                            } catch (err) { /* skip */ }
                        }

                        if (transfers.length === 0) {
                            transfersContainer.innerHTML = '<p style="color: #666; text-align: center; padding: 1rem;">No stock transfers recorded yet.</p>';
                        } else {
                            transfers.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                            transfersContainer.innerHTML = `
                                <div class="table-container">
                                    <table>
                                        <thead><tr><th>Product</th><th>Qty</th><th>From</th><th>To</th><th>Date</th></tr></thead>
                                        <tbody>
                                            ${transfers.slice(0, 20).map(t => `
                                                <tr>
                                                    <td>${t.product}</td>
                                                    <td>${t.quantity}</td>
                                                    <td>${t.from}</td>
                                                    <td>${t.to}</td>
                                                    <td>${t.date ? new Date(t.date).toLocaleDateString() : '-'}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            `;
                        }
                    })();
                }
            }

            // ==================== CONSIGNMENT MANAGEMENT METHODS ====================

            openSendConsignmentModal() {
                if (state.allOutlets.length === 0) {
                    Utils.showToast('Please create at least one outlet first', 'warning');
                    return;
                }
                
                // Populate outlet dropdown
                const outletSelect = document.getElementById('consignment-outlet');
                if (outletSelect) {
                    outletSelect.innerHTML = '<option value="">Choose outlet...</option>' +
                        state.allOutlets
                            .filter(o => o.status === 'active')
                            .map(outlet => `<option value="${outlet.id}">${outlet.name} - ${outlet.location}</option>`)
                            .join('');
                }
                
                // Set today's date
                document.getElementById('consignment-date').valueAsDate = new Date();
                
                // Clear products container
                document.getElementById('consignment-products-container').innerHTML = '';
                
                // Add first product row
                this.addConsignmentProductRow();
                
                document.getElementById('send-consignment-modal').style.display = 'block';
            }

            addConsignmentProductRow() {
                const container = document.getElementById('consignment-products-container');
                if (!container) return;
                
                const rowIndex = container.children.length;
                
                const row = document.createElement('div');
                row.className = 'bulk-product-row';
                row.dataset.rowIndex = rowIndex;
                
                row.innerHTML = `
                    <div style="position: relative;">
                        <input type="text" 
                            id="consignment-product-search-${rowIndex}" 
                            placeholder="🔍 Search product from main inventory..." 
                            autocomplete="off"
                            class="bulk-product-search">
                        <div id="consignment-product-dropdown-${rowIndex}" class="bulk-product-search-dropdown" style="display: none;"></div>
                        <input type="hidden" id="consignment-product-id-${rowIndex}" required>
                    </div>
                    <input type="number" 
                        id="consignment-product-quantity-${rowIndex}" 
                        placeholder="Quantity" 
                        min="1" 
                        required>
                    <input type="text" 
                        id="consignment-product-cost-${rowIndex}" 
                        placeholder="Cost" 
                        readonly 
                        style="background: #e9ecef;">
                    <input type="text" 
                        id="consignment-product-retail-${rowIndex}" 
                        placeholder="Retail" 
                        readonly 
                        style="background: #e9ecef;">
                    <button type="button" class="danger" onclick="appController.removeConsignmentProductRow(${rowIndex})">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
                
                container.appendChild(row);
                
                // Add event listeners
                const searchInput = document.getElementById(`consignment-product-search-${rowIndex}`);
                const quantityInput = document.getElementById(`consignment-product-quantity-${rowIndex}`);
                
                if (searchInput) {
                    searchInput.addEventListener('input', Utils.debounce((e) => {
                        this.searchConsignmentProducts(e.target.value, rowIndex);
                    }, 300));
                    
                    searchInput.addEventListener('focus', (e) => {
                        this.searchConsignmentProducts(e.target.value, rowIndex);
                    });
                }
                
                if (quantityInput) {
                    quantityInput.addEventListener('input', () => {
                        this.updateConsignmentTotals();
                    });
                }
            }

            removeConsignmentProductRow(rowIndex) {
                const row = document.querySelector(`[data-row-index="${rowIndex}"]`);
                if (row) {
                    row.remove();
                    this.updateConsignmentTotals();
                }
            }

            searchConsignmentProducts(query, rowIndex) {
                const dropdown = document.getElementById(`consignment-product-dropdown-${rowIndex}`);
                if (!dropdown) return;
                
                const searchQuery = query.toLowerCase().trim();
                
                // Only search from main shop inventory (products with quantity > 0)
                const availableProducts = state.allProducts.filter(p => p.quantity > 0);
                
                let filtered = availableProducts;
                if (searchQuery) {
                    filtered = availableProducts.filter(p => 
                        p.name.toLowerCase().includes(searchQuery) ||
                        p.category.toLowerCase().includes(searchQuery) ||
                        p.barcode?.includes(searchQuery)
                    );
                }
                
                if (filtered.length === 0) {
                    dropdown.innerHTML = '<div style="padding: 0.75rem; color: #666; text-align: center;">No products found in main inventory</div>';
                    dropdown.style.display = 'block';
                    return;
                }
                
                dropdown.innerHTML = filtered.map(product => `
                    <div class="bulk-product-search-item" 
                        onclick="appController.selectConsignmentProduct('${product.id}', '${product.name}', ${product.cost}, ${product.price}, ${product.quantity}, ${rowIndex})">
                        <div><strong>${product.name}</strong> <span style="color: #666;">(${product.category})</span></div>
                        <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">
                            Main Stock: ${product.quantity} | Cost: ${Utils.formatCurrency(product.cost)} | Retail: ${Utils.formatCurrency(product.price)}
                        </div>
                    </div>
                `).join('');
                
                dropdown.style.display = 'block';
            }

            selectConsignmentProduct(productId, productName, cost, price, availableStock, rowIndex) {
                document.getElementById(`consignment-product-id-${rowIndex}`).value = productId;
                document.getElementById(`consignment-product-search-${rowIndex}`).value = `${productName} (Available: ${availableStock})`;
                document.getElementById(`consignment-product-cost-${rowIndex}`).value = Utils.formatCurrency(cost);
                document.getElementById(`consignment-product-retail-${rowIndex}`).value = Utils.formatCurrency(price);
                
                // Set default quantity to 1
                const quantityInput = document.getElementById(`consignment-product-quantity-${rowIndex}`);
                if (quantityInput && !quantityInput.value) {
                    quantityInput.value = '1';
                }
                
                // Set max attribute based on available stock
                if (quantityInput) {
                    quantityInput.setAttribute('max', availableStock);
                }
                
                document.getElementById(`consignment-product-dropdown-${rowIndex}`).style.display = 'none';
                
                this.updateConsignmentTotals();
            }

            updateConsignmentTotals() {
                const container = document.getElementById('consignment-products-container');
                if (!container) return;
                
                let totalItems = 0;
                let totalCost = 0;
                let totalRetail = 0;
                
                Array.from(container.children).forEach(row => {
                    const rowIndex = row.dataset.rowIndex;
                    const productId = document.getElementById(`consignment-product-id-${rowIndex}`)?.value;
                    const quantity = parseInt(document.getElementById(`consignment-product-quantity-${rowIndex}`)?.value) || 0;
                    
                    if (productId && quantity > 0) {
                        const product = state.allProducts.find(p => p.id === productId);
                        if (product) {
                            totalItems += quantity;
                            totalCost += quantity * product.cost;
                            totalRetail += quantity * product.price;
                        }
                    }
                });
                
                document.getElementById('consignment-total-items').textContent = totalItems;
                document.getElementById('consignment-total-cost').textContent = Utils.formatCurrency(totalCost);
                document.getElementById('consignment-total-retail').textContent = Utils.formatCurrency(totalRetail);
            }

            async handleSendConsignment(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const container = document.getElementById('consignment-products-container');
                    if (!container || container.children.length === 0) {
                        Utils.showToast('Please add at least one product', 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const outletId = document.getElementById('consignment-outlet').value;
                    const date = document.getElementById('consignment-date').value;
                    const notes = document.getElementById('consignment-notes').value;
                    
                    if (!outletId) {
                        Utils.showToast('Please select an outlet', 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const outlet = state.allOutlets.find(o => o.id === outletId);
                    
                    // Collect products
                    const products = [];
                    let hasError = false;
                    
                    Array.from(container.children).forEach(row => {
                        const rowIndex = row.dataset.rowIndex;
                        const productId = document.getElementById(`consignment-product-id-${rowIndex}`)?.value;
                        const quantity = parseInt(document.getElementById(`consignment-product-quantity-${rowIndex}`)?.value) || 0;
                        
                        if (!productId || quantity <= 0) {
                            hasError = true;
                            return;
                        }
                        
                        const product = state.allProducts.find(p => p.id === productId);
                        if (!product) {
                            Utils.showToast(`Product not found in row ${parseInt(rowIndex) + 1}`, 'error');
                            hasError = true;
                            return;
                        }
                        
                        if (product.quantity < quantity) {
                            Utils.showToast(`Insufficient stock for ${product.name}. Available: ${product.quantity}`, 'warning');
                            hasError = true;
                            return;
                        }
                        
                        products.push({
                            id: productId,
                            name: product.name,
                            category: product.category,
                            quantity: quantity,
                            cost: product.cost,
                            price: product.price
                        });
                    });
                    
                    if (hasError) {
                        Utils.hideSpinner();
                        return;
                    }
                    
                    // Calculate totals
                    const totalCostValue = products.reduce((sum, p) => sum + (p.quantity * p.cost), 0);
                    const totalRetailValue = products.reduce((sum, p) => sum + (p.quantity * p.price), 0);
                    const totalQuantity = products.reduce((sum, p) => sum + p.quantity, 0);
                    
                    // Create consignment document
                    const consignmentData = {
                        date: date,
                        outletId: outletId,
                        outletName: outlet.name,
                        products: products,
                        totalQuantity: totalQuantity,
                        totalCostValue: totalCostValue,
                        totalRetailValue: totalRetailValue,
                        notes: notes,
                        status: 'pending',
                        createdAt: new Date().toISOString(),
                        createdBy: state.currentUser.email
                    };
                    
                    const batch = writeBatch(db);
                    
                    // Add consignment to outlet's consignments subcollection
                    const consignmentRef = doc(collection(db, 'users', state.currentUser.uid, 'outlets', outletId, 'consignments'));
                    batch.set(consignmentRef, consignmentData);
                    
                    // Update main shop inventory (deduct quantities)
                    for (const product of products) {
                        const mainProduct = state.allProducts.find(p => p.id === product.id);
                        const productRef = doc(firebaseService.getUserCollection('inventory'), product.id);
                        batch.update(productRef, {
                            quantity: mainProduct.quantity - product.quantity,
                            lastConsignment: new Date().toISOString()
                        });
                    }
                    
                    await batch.commit();
                    
                    await ActivityLogger.log('Consignment Sent', `Sent consignment to ${outlet.name}: ${totalQuantity} items worth ${Utils.formatCurrency(totalCostValue)}`);
                    
                    Utils.showToast(`Consignment sent successfully to ${outlet.name}`, 'success');
                    document.getElementById('send-consignment-modal').style.display = 'none';
                    document.getElementById('send-consignment-form').reset();
                    
                    // Reload data
                    await dataLoader.loadProducts();
                    await dataLoader.loadOutlets();
                    this.markSectionsDirty(['inventory', 'consignments', 'outlets']);
                    this._refreshCurrentSectionIfDirty();
                } catch (error) {
                    Utils.showToast('Failed to send consignment: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            /*async confirmConsignment(outletId, consignmentId) {
                if (!confirm('Confirm receipt of this consignment? This will add the items to your outlet inventory.')) {
                    return;
                }
                
                Utils.showSpinner();
                try {
                    const consignmentRef = doc(db, 'users', state.currentUser.uid, 'outlets', outletId, 'consignments', consignmentId);
                    const consignmentSnap = await getDoc(consignmentRef);
                    
                    if (!consignmentSnap.exists()) {
                        Utils.showToast('Consignment not found', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const consignment = consignmentSnap.data();
                    const batch = writeBatch(db);
                    
                    // Update consignment status
                    batch.update(consignmentRef, {
                        status: 'confirmed',
                        confirmedAt: new Date().toISOString(),
                        confirmedBy: state.currentUser.email
                    });
                    
                    // Add products to outlet inventory
                    for (const product of consignment.products) {
                        const outletInventoryRef = doc(db, 'users', state.currentUser.uid, 'outlets', outletId, 'inventory', product.id);
                        const outletInventorySnap = await getDoc(outletInventoryRef);
                        
                        if (outletInventorySnap.exists()) {
                            // Update existing
                            const existing = outletInventorySnap.data();
                            batch.update(outletInventoryRef, {
                                quantity: existing.quantity + product.quantity,
                                lastUpdated: new Date().toISOString()
                            });
                        } else {
                            // Create new
                            batch.set(outletInventoryRef, {
                                productId: product.id,
                                name: product.name,
                                category: product.category,
                                quantity: product.quantity,
                                cost: product.cost,
                                retail: product.retail,
                                lastUpdated: new Date().toISOString()
                            });
                        }
                    }
                    
                    await batch.commit();
                    
                    await ActivityLogger.log('Consignment Confirmed', `Confirmed consignment: ${consignment.totalQuantity} items`);
                    
                    Utils.showToast('Consignment confirmed successfully', 'success');
                    this.renderConsignments();
                    
                } catch (error) {
                    Utils.showToast('Failed to confirm consignment: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }*/

            async confirmConsignment(outletId, consignmentId) {
                console.log('=== CONFIRMING CONSIGNMENT ===');
                console.log('Outlet ID:', outletId);
                console.log('Consignment ID:', consignmentId);
                console.log('User role:', state.userRole);
                
                const skipPrompt = arguments[2];
                
                if (!skipPrompt) {
                    if (!confirm('Confirm receipt of this consignment? This will add the items to outlet inventory.')) {
                        return;
                    }
                }
                
                Utils.showSpinner();
                try {
                    // Determine which user ID to use
                    let userId = state.currentUser.uid;
                    
                    if (state.userRole === 'outlet_manager') {
                        // Get parent admin ID from outlet data
                        const outlet = state.allOutlets.find(o => o.id === outletId);
                        if (outlet && outlet.parentAdminId) {
                            userId = outlet.parentAdminId;
                            console.log('Using parent admin ID:', userId);
                        } else {
                            // Fallback: get from user document
                            const userDocRef = doc(db, 'users', state.currentUser.uid);
                            const userDoc = await getDoc(userDocRef);
                            if (userDoc.exists()) {
                                userId = userDoc.data().createdBy || state.currentUser.uid;
                                console.log('Got parent ID from user doc:', userId);
                            }
                        }
                    }
                    
                    console.log('Firestore path: users/' + userId + '/outlets/' + outletId);
                    
                    const consignmentRef = doc(db, 'users', userId, 'outlets', outletId, 'consignments', consignmentId);
                    const consignmentSnap = await getDoc(consignmentRef);
                    
                    if (!consignmentSnap.exists()) {
                        Utils.showToast('Consignment not found', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const consignment = consignmentSnap.data();
                    
                    console.log('Consignment data:', consignment);
                    console.log('Products to add:', consignment.products);
                    
                    const batch = writeBatch(db);
                    
                    // Update consignment status
                    batch.update(consignmentRef, {
                        status: 'confirmed',
                        confirmedAt: new Date().toISOString(),
                        confirmedBy: state.currentUser.email
                    });
                    
                    // Add products to outlet inventory
                    for (const product of consignment.products) {
                        const outletInventoryRef = doc(db, 'users', userId, 'outlets', outletId, 'outlet_inventory', product.id);
                        const outletInventorySnap = await getDoc(outletInventoryRef);
                        
                        if (outletInventorySnap.exists()) {
                            // Update existing
                            const existing = outletInventorySnap.data();
                            console.log(`Updating existing inventory for ${product.name}: ${existing.quantity} + ${product.quantity}`);
                            batch.update(outletInventoryRef, {
                                quantity: existing.quantity + product.quantity,
                                lastUpdated: new Date().toISOString()
                            });
                        } else {
                            // Create new
                            console.log(`Creating new inventory entry for ${product.name}`);
                            batch.set(outletInventoryRef, {
                                productId: product.id,
                                name: product.name,
                                category: product.category,
                                quantity: product.quantity,
                                cost: product.cost,
                                price: product.price,
                                lastUpdated: new Date().toISOString()
                            });
                        }
                    }
                    
                    await batch.commit();
                    
                    await ActivityLogger.log('Consignment Confirmed', `Confirmed consignment: ${consignment.totalQuantity} items for ${consignment.outletName}`);
                    
                    Utils.showToast('Consignment confirmed successfully', 'success');
                    
                    // Refresh views
                    await dataLoader.loadAll();
                    this.renderConsignments();
                    
                } catch (error) {
                    console.error('Error confirming consignment:', error);
                    Utils.showToast('Failed to confirm consignment: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            /*async renderConsignments() {
                const listContainer = document.getElementById('consignments-list');
                if (!listContainer) return;
                
                Utils.showSpinner();
                
                try {
                    // Get filters
                    const outletFilter = document.getElementById('consignment-outlet-filter')?.value || '';
                    const statusFilter = document.getElementById('consignment-status-filter')?.value || '';
                    
                    // Load all consignments from all outlets
                    const allConsignments = [];

                     // Determine which outlets to load consignments from
                    let outletsToLoad = [];
                    
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // Outlet manager: only load their outlet's consignments
                        outletsToLoad = state.allOutlets.filter(o => o.id === state.assignedOutlet);
                        console.log('Loading consignments for outlet manager:', outletsToLoad[0]?.name);
                    } else {
                        // Admin: load all outlets
                        outletsToLoad = state.allOutlets;
                        console.log('Loading consignments from all', outletsToLoad.length, 'outlets');
                    }
                    
                    for (const outlet of outletsToLoad) {
                        const consignmentsSnapshot = await getDocs(
                            collection(db, 'users', state.currentUser.uid, 'outlets', outlet.id, 'consignments')
                        );
                        
                        consignmentsSnapshot.forEach(doc => {
                            allConsignments.push({
                                ...doc.data(),
                                id: doc.id,
                                outletId: outlet.id
                            });
                        });
                    }
                    
                    // Sort by date (newest first)
                    allConsignments.sort((a, b) => new Date(b.date) - new Date(a.date));
                    
                    // Apply filters
                    let filtered = allConsignments;
                    
                    if (outletFilter) {
                        filtered = filtered.filter(c => c.outletId === outletFilter);
                    }
                    
                    if (statusFilter) {
                        filtered = filtered.filter(c => c.status === statusFilter);
                    }
                    
                    if (filtered.length === 0) {
                        listContainer.innerHTML = '<div class="no-data">No consignments found</div>';
                    } else {
                        listContainer.innerHTML = filtered.map(consignment => `
                            <div class="card" style="margin-bottom: 1rem;">
                                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                                    <div>
                                        <h4 style="margin: 0;">
                                            ${consignment.outletName}
                                            <span class="location-badge">${consignment.date}</span>
                                        </h4>
                                        <p style="margin: 0.5rem 0; color: #666;">
                                            <strong>${consignment.totalQuantity} items</strong> • 
                                            Cost: ${Utils.formatCurrency(consignment.totalCostValue)} • 
                                            Retail: ${Utils.formatCurrency(consignment.totalRetailValue)}
                                        </p>
                                    </div>
                                    <span class="consignment-status ${consignment.status}">
                                        ${consignment.status.toUpperCase()}
                                    </span>
                                </div>
                                
                                <div style="background: #f8f9fa; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
                                    <strong>Products:</strong>
                                    <ul style="margin: 0.5rem 0 0 0; padding-left: 1.5rem;">
                                        ${(consignment.products || []).map(p => `
                                            <li>${p.name} - ${p.quantity} units @ ${Utils.formatCurrency(p.cost)} (Retail: ${Utils.formatCurrency(p.retail)})</li>
                                        `).join('')}
                                    </ul>
                                </div>
                                
                                ${consignment.notes ? `
                                    <p style="margin: 0.5rem 0; color: #666; font-style: italic;">
                                        <i class="fas fa-sticky-note"></i> ${consignment.notes}
                                    </p>
                                ` : ''}
                                
                                <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                                    <button onclick="appController.viewConsignmentDetails('${consignment.outletId}', '${consignment.id}')">
                                        <i class="fas fa-eye"></i> View Details
                                    </button>
                                    ${consignment.status === 'pending' && state.userRole === 'outlet_manager' && state.assignedOutlet === consignment.outletId ? `
                                        <button onclick="appController.confirmConsignment('${consignment.outletId}', '${consignment.id}')" style="background: #28a745;">
                                            <i class="fas fa-check"></i> Confirm Receipt
                                        </button>
                                    ` : ''}
                                    ${consignment.status === 'confirmed' ? `
                                        <span style="color: #28a745; padding: 0.5rem;">
                                            <i class="fas fa-check-circle"></i> Confirmed on ${new Date(consignment.confirmedAt).toLocaleDateString()}
                                        </span>
                                    ` : ''}
                                </div>
                            </div>
                        `).join('');
                    }

                    // Show helpful info for outlet managers
                    if (state.userRole === 'outlet_manager') {
                        const infoDiv = document.createElement('div');
                        infoDiv.className = 'card';
                        infoDiv.style.marginBottom = '1rem';
                        infoDiv.innerHTML = `
                            <div style="background: #d1ecf1; padding: 1rem; border-radius: 4px; border-left: 4px solid #17a2b8;">
                                <h4 style="margin: 0 0 0.5rem 0; color: #0c5460;">
                                    <i class="fas fa-info-circle"></i> Consignment Receipts
                                </h4>
                                <p style="margin: 0; color: #0c5460; font-size: 0.9rem;">
                                    When the main shop sends you inventory, it appears here as "PENDING". 
                                    Click <strong>"Confirm Receipt"</strong> to add the items to your outlet inventory.
                                </p>
                            </div>
                        `;
                        listContainer.parentElement.insertBefore(infoDiv, listContainer);
                    }
                    
                    // Populate outlet filter based on role
                    const outletFilterSelect = document.getElementById('consignment-outlet-filter');
                    if (outletFilterSelect) {
                        if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                            // Outlet manager: hide filter (only their outlet)
                            const filterContainer = outletFilterSelect.closest('.filters');
                            if (filterContainer) {
                                const outletFilterDiv = outletFilterSelect.parentElement;
                                if (outletFilterDiv) outletFilterDiv.style.display = 'none';
                            }
                        } else if (outletFilterSelect.options.length <= 1) {
                            // Admin: show all outlets in filter
                            outletFilterSelect.innerHTML = '<option value="">All Outlets</option>' +
                                state.allOutlets.map(outlet => 
                                    `<option value="${outlet.id}">${outlet.name}</option>`
                                ).join('');
                        }
                    }
                } catch (error) {
                    console.error('Error rendering consignments:', error);
                    listContainer.innerHTML = '<div class="no-data">Error loading consignments</div>';
                } finally {
                    Utils.hideSpinner();
                }
            }*/

            async renderConsignments() {
                const listContainer = document.getElementById('consignments-list');
                if (!listContainer) {
                    console.log('Consignments list container not found');
                    return;
                }
                
                console.log('Rendering consignments...');
                console.log('User role:', state.userRole);
                console.log('Assigned outlet:', state.assignedOutlet);
                
                Utils.showSpinner();
                
                try {
                    // Get filters
                    const outletFilter = document.getElementById('consignment-outlet-filter')?.value || '';
                    const statusFilter = document.getElementById('consignment-status-filter')?.value || '';
                    
                    // Load all consignments
                    const allConsignments = [];
                    
                    // Determine which outlets to load consignments from
                    let outletsToLoad = [];
                    
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // Outlet manager: only load their outlet's consignments
                        outletsToLoad = state.allOutlets.filter(o => o.id === state.assignedOutlet);
                        console.log('Loading consignments for outlet manager:', outletsToLoad[0]?.name);
                        console.log('consignments:', outletsToLoad);
                    } else {
                        // Admin: load all outlets
                        outletsToLoad = state.allOutlets;
                        console.log('Loading consignments from all', outletsToLoad.length, 'outlets');
                    }

                    for (const outlet of outletsToLoad) {
                        try {
                            // Determine which user ID to use for Firestore path
                            let userId = state.currentUser.uid;
                            
                            // If outlet manager, use parent admin's ID
                            if (state.userRole === 'outlet_manager' && outlet.createdBy) {
                                userId = outlet.createdBy;
                                console.log('Using parent admin ID:', userId);
                            }
                            
                            console.log(`Loading consignments from: users/${userId}/outlets/${outlet.id}/consignments`);
                            
                            const consignmentsRef = collection(db, 'users', userId, 'outlets', outlet.id, 'consignments');
                            const consignmentsSnapshot = await getDocs(consignmentsRef);
                            
                            console.log(`Outlet ${outlet.name} has ${consignmentsSnapshot.size} consignments`);
                            
                            consignmentsSnapshot.forEach(doc => {
                                allConsignments.push({
                                    ...doc.data(),
                                    id: doc.id,
                                    outletId: outlet.id,
                                    parentAdminId: userId // Store for later use
                                });
                            });
                        } catch (error) {
                            console.error(`Error loading consignments for outlet ${outlet.id}:`, error);
                        }
                    }
                    
                    /*for (const outlet of outletsToLoad) {
                        try {
                            const consignmentsRef = collection(db, 'users', state.currentUser.uid, 'outlets', outlet.id, 'consignments');
                            const consignmentsSnapshot = await getDocs(consignmentsRef);
                            
                            console.log(`Outlet ${outlet.name} has ${consignmentsSnapshot.size} consignments`);
                            
                            consignmentsSnapshot.forEach(doc => {
                                allConsignments.push({
                                    ...doc.data(),
                                    id: doc.id,
                                    outletId: outlet.id
                                });
                            });
                        } catch (error) {
                            console.error(`Error loading consignments for outlet ${outlet.id}:`, error);
                        }
                    }*/
                    
                    console.log('Total consignments loaded:', allConsignments.length);
                    
                    // Sort by date (newest first)
                    allConsignments.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
                    
                    // Apply filters
                    let filtered = allConsignments;
                    
                    if (outletFilter) {
                        filtered = filtered.filter(c => c.outletId === outletFilter);
                    }
                    
                    if (statusFilter) {
                        filtered = filtered.filter(c => c.status === statusFilter);
                    }
                    
                    console.log('Filtered consignments:', filtered.length);
                    
                    if (filtered.length === 0) {
                        listContainer.innerHTML = '<div class="no-data">No consignments found. Send a consignment to get started.</div>';
                    } else {
                        // Build HTML for each consignment
                        const consignmentsHTML = filtered.map(consignment => {
                            // Prepare action buttons based on status and role
                            let actionButtons = '';
                            
                            if (consignment.status === 'pending') {
                                if (state.userRole === 'outlet_manager' && state.assignedOutlet === consignment.outletId) {
                                    actionButtons = `
                                        <button onclick="appController.confirmConsignment('${consignment.outletId}', '${consignment.id}')" 
                                                style="background: #28a745; font-weight: bold; padding: 0.75rem 1.5rem; animation: pulse 2s infinite;">
                                            <i class="fas fa-check-circle"></i> Confirm Receipt
                                        </button>
                                    `;
                                } else if (state.userRole === 'admin') {
                                    actionButtons = `
                                        <span style="color: #ffc107; padding: 0.5rem;">
                                            <i class="fas fa-clock"></i> Awaiting outlet confirmation
                                        </span>
                                    `;
                                }
                            } else if (consignment.status === 'confirmed') {
                                const confirmedDate = consignment.confirmedAt ? 
                                    ' on ' + new Date(consignment.confirmedAt).toLocaleDateString() : '';
                                actionButtons = `
                                    <span style="color: #28a745; padding: 0.5rem;">
                                        <i class="fas fa-check-circle"></i> Confirmed${confirmedDate}
                                    </span>
                                `;
                            }
                            
                            // Build products list
                            const productsList = (consignment.products || []).map(p => 
                                `<li>${p.name} - ${p.quantity} units @ ${Utils.formatCurrency(p.cost)} (Retail: ${Utils.formatCurrency(p.price)})</li>`
                            ).join('');
                            
                            // Return complete card HTML
                            return `
                                <div class="card" style="margin-bottom: 1rem;">
                                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                                        <div>
                                            <h4 style="margin: 0;">
                                                ${consignment.outletName}
                                                <span class="location-badge">${consignment.date}</span>
                                            </h4>
                                            <p style="margin: 0.5rem 0; color: #666;">
                                                <strong>${consignment.totalQuantity} items</strong> • 
                                                Cost: ${Utils.formatCurrency(consignment.totalCostValue)} • 
                                                Retail: ${Utils.formatCurrency(consignment.totalRetailValue)}
                                            </p>
                                        </div>
                                        <span class="consignment-status ${consignment.status || 'pending'}">
                                            ${consignment.status ? consignment.status.toUpperCase() : 'PENDING'}
                                        </span>
                                    </div>
                                    
                                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
                                        <strong>Products:</strong>
                                        <ul style="margin: 0.5rem 0 0 0; padding-left: 1.5rem;">
                                            ${productsList}
                                        </ul>
                                    </div>
                                    
                                    ${consignment.notes ? `
                                        <p style="margin: 0.5rem 0; color: #666; font-style: italic;">
                                            <i class="fas fa-sticky-note"></i> ${consignment.notes}
                                        </p>
                                    ` : ''}
                                    
                                    <div style="display: flex; gap: 0.5rem; margin-top: 1rem; align-items: center; flex-wrap: wrap;">
                                        <button onclick="appController.viewConsignmentDetails('${consignment.outletId}', '${consignment.id}')">
                                            <i class="fas fa-eye"></i> View Details
                                        </button>
                                        ${actionButtons}
                                    </div>
                                </div>
                            `;
                        }).join('');
                        
                        listContainer.innerHTML = consignmentsHTML;
                    }
                    
                    // Populate outlet filter based on role
                    const outletFilterSelect = document.getElementById('consignment-outlet-filter');
                    if (outletFilterSelect) {
                        if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                            // Hide filter for outlet managers
                            const filterContainer = outletFilterSelect.closest('.filters');
                            if (filterContainer) {
                                const outletFilterDiv = outletFilterSelect.parentElement;
                                if (outletFilterDiv) outletFilterDiv.style.display = 'none';
                            }
                        } else if (outletFilterSelect.options.length <= 1) {
                            // Populate for admins
                            outletFilterSelect.innerHTML = '<option value="">All Outlets</option>' +
                                state.allOutlets.map(outlet => 
                                    `<option value="${outlet.id}">${outlet.name}</option>`
                                ).join('');
                        }
                    }
                    
                } catch (error) {
                    console.error('Error rendering consignments:', error);
                    listContainer.innerHTML = '<div class="no-data">Error loading consignments: ' + error.message + '</div>';
                } finally {
                    Utils.hideSpinner();
                }
            }

            async viewConsignmentDetails(outletId, consignmentId) {
                Utils.showSpinner();
                
                try {

                    // Determine which user ID to use
                    let userId = state.currentUser.uid;
                    
                    if (state.userRole === 'outlet_manager') {
                        const outlet = state.allOutlets.find(o => o.id === outletId);
                        console.log("View Consignment: ", outlet)
                        if (outlet && outlet.createdBy) {
                            userId = outlet.createdBy;
                        }
                    }

                    const consignmentRef = doc(db, 'users', userId, 'outlets', outletId, 'consignments', consignmentId);
                    const consignmentSnap = await getDoc(consignmentRef);
                    
                    if (!consignmentSnap.exists()) {
                        Utils.showToast('Consignment not found', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const consignment = consignmentSnap.data();
                    const outlet = state.allOutlets.find(o => o.id === outletId);
                    
                    const detailsContent = document.getElementById('consignment-details-content');
                    if (!detailsContent) return;
                    
                    detailsContent.innerHTML = `
                        <div style="margin-bottom: 2rem;">
                            <h4 style="margin: 0 0 1rem 0; color: #007bff;">Consignment Information</h4>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                                <div>
                                    <p style="margin: 0.5rem 0;"><strong>Outlet:</strong> ${outlet?.name || 'Unknown'}</p>
                                    <p style="margin: 0.5rem 0;"><strong>Location:</strong> ${outlet?.location || 'N/A'}</p>
                                    <p style="margin: 0.5rem 0;"><strong>Date:</strong> ${consignment.date}</p>
                                </div>
                                <div>
                                    <p style="margin: 0.5rem 0;"><strong>Status:</strong> 
                                        <span class="consignment-status ${consignment.status}">${consignment.status.toUpperCase()}</span>
                                    </p>
                                    <p style="margin: 0.5rem 0;"><strong>Created By:</strong> ${consignment.createdBy}</p>
                                    ${consignment.status === 'confirmed' ? `
                                        <p style="margin: 0.5rem 0;"><strong>Confirmed:</strong> ${new Date(consignment.confirmedAt).toLocaleString()}</p>
                                        <p style="margin: 0.5rem 0;"><strong>Confirmed By:</strong> ${consignment.confirmedBy}</p>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 2rem;">
                            <h4 style="margin: 0 0 1rem 0; color: #007bff;">Products</h4>
                            <table style="width: 100%;">
                                <thead>
                                    <tr>
                                        <th>Product</th>
                                        <th>Category</th>
                                        <th>Quantity</th>
                                        <th>Cost</th>
                                        <th>Retail</th>
                                        <th>Total Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${(consignment.products || []).map(product => `
                                        <tr>
                                            <td>${product.name}</td>
                                            <td>${product.category}</td>
                                            <td>${product.quantity}</td>
                                            <td>${Utils.formatCurrency(product.cost)}</td>
                                            <td>${Utils.formatCurrency(product.price)}</td>
                                            <td>${Utils.formatCurrency(product.quantity * product.cost)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                                <tfoot>
                                    <tr style="font-weight: bold; background: #f8f9fa;">
                                        <td colspan="2">TOTAL</td>
                                        <td>${consignment.totalQuantity} items</td>
                                        <td>-</td>
                                        <td>-</td>
                                        <td>${Utils.formatCurrency(consignment.totalCostValue)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        
                        <div style="background: #f8f9fa; padding: 1rem; border-radius: 4px;">
                            <h4 style="margin: 0 0 0.5rem 0;">Summary</h4>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                                <p style="margin: 0.25rem 0;"><strong>Total Items:</strong></p>
                                <p style="margin: 0.25rem 0; text-align: right;">${consignment.totalQuantity}</p>
                                
                                <p style="margin: 0.25rem 0;"><strong>Total Cost Value:</strong></p>
                                <p style="margin: 0.25rem 0; text-align: right;">${Utils.formatCurrency(consignment.totalCostValue)}</p>
                                
                                <p style="margin: 0.25rem 0;"><strong>Total Retail Value:</strong></p>
                                <p style="margin: 0.25rem 0; text-align: right; color: #007bff;">${Utils.formatCurrency(consignment.totalRetailValue)}</p>
                                
                                <p style="margin: 0.25rem 0;"><strong>Potential Profit:</strong></p>
                                <p style="margin: 0.25rem 0; text-align: right; color: #28a745;">${Utils.formatCurrency(consignment.totalRetailValue - consignment.totalCostValue)}</p>
                            </div>
                        </div>
                        
                        ${consignment.notes ? `
                            <div style="margin-top: 1rem; padding: 1rem; background: #fff3cd; border-radius: 4px;">
                                <strong><i class="fas fa-sticky-note"></i> Notes:</strong>
                                <p style="margin: 0.5rem 0 0 0;">${consignment.notes}</p>
                            </div>
                        ` : ''}
                    `;
                    
                    // Add action buttons if applicable
                    const actionsDiv = document.getElementById('consignment-actions');
                    if (actionsDiv) {
                        if (consignment.status === 'pending' && state.userRole === 'outlet_manager' && state.assignedOutlet === outletId) {
                            actionsDiv.innerHTML = `
                                <button onclick="appController.confirmConsignment('${outletId}', '${consignmentId}'); document.getElementById('view-consignment-modal').style.display='none';" style="background: #28a745;">
                                    <i class="fas fa-check"></i> Confirm Receipt
                                </button>
                            `;
                        } else {
                            actionsDiv.innerHTML = '';
                        }
                    }
                    
                    document.getElementById('view-consignment-modal').style.display = 'block';
                    
                } catch (error) {
                    Utils.showToast('Failed to load consignment details: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            // ==================== SETTLEMENT MANAGEMENT METHODS ====================

            openGenerateSettlementModal() {
                if (state.allOutlets.length === 0) {
                    Utils.showToast('Please create at least one outlet first', 'warning');
                    return;
                }
                
                // Populate outlet dropdown
                const outletSelect = document.getElementById('settlement-outlet');
                if (outletSelect) {
                    outletSelect.innerHTML = '<option value="">Choose outlet...</option>' +
                        state.allOutlets
                            .filter(o => o.status === 'active')
                            .map(outlet => `<option value="${outlet.id}">${outlet.name} - ${outlet.location}</option>`)
                            .join('');
                }
                
                // Set default period to last month
                const now = new Date();
                const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const periodInput = document.getElementById('settlement-period');
                if (periodInput) {
                    periodInput.value = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
                }
                
                document.getElementById('generate-settlement-modal').style.display = 'block';
            }

            async handleGenerateSettlement(e) {
                e.preventDefault();
                Utils.showSpinner();
                const flowStartedAt = Date.now();
                const flowCorrelationId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : `flow_${Date.now()}`;
                
                try {
                    metricsService.emit('flow_started', {
                        flow_name: 'generate_settlement'
                    }, { correlationId: flowCorrelationId });

                    const outletId = document.getElementById('settlement-outlet').value;
                    const period = document.getElementById('settlement-period').value; // Format: YYYY-MM

                    if (!outletId || !period) {
                        Utils.showToast('Please select outlet and period', 'warning');
                        Utils.hideSpinner();
                        return;
                    }

                    const outlet = state.allOutlets.find(o => o.id === outletId);
                    if (!outlet) {
                        Utils.showToast('Outlet not found', 'error');
                        Utils.hideSpinner();
                        return;
                    }

                    // Check if settlement already exists
                    const existingSettlementRef = doc(db, 'users', state.currentUser.uid, 'outlets', outletId, 'settlements', period);
                    const existingSnap = await getDoc(existingSettlementRef);


                    
                    if (existingSnap.exists()) {
                        if (!confirm(`Settlement for ${period} already exists. Regenerate?`)) {
                            Utils.hideSpinner();
                            return;
                        }
                    }
                    
                    // Calculate settlement
                    const settlement = await this.calculateSettlement(outletId, period);
                    
                    if (!settlement) {
                        Utils.showToast('Failed to calculate settlement', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    // Save settlement
                    await setDoc(existingSettlementRef, settlement);
                    
                    await ActivityLogger.log('Settlement Generated', `Generated settlement for ${outlet.name} - ${period}`);

                    metricsService.emit('flow_completed', {
                        flow_name: 'generate_settlement',
                        duration_ms: Date.now() - flowStartedAt,
                        result: 'success'
                    }, { correlationId: flowCorrelationId });
                    
                    Utils.showToast('Settlement generated successfully', 'success');
                    document.getElementById('generate-settlement-modal').style.display = 'none';
                    
                    // View the generated settlement
                    this.viewSettlementDetails(outletId, period);
                    
                } catch (error) {
                    metricsService.emit('write_failed', {
                        entity: 'settlement',
                        target_collection: 'users/{uid}/outlets/{outletId}/settlements',
                        duration_ms: Date.now() - flowStartedAt,
                        error_code: error?.code || 'unknown',
                        error_message: error?.message || String(error)
                    }, { correlationId: flowCorrelationId });
                    metricsService.emit('flow_completed', {
                        flow_name: 'generate_settlement',
                        duration_ms: Date.now() - flowStartedAt,
                        result: 'blocked'
                    }, { correlationId: flowCorrelationId });
                    Utils.showToast('Failed to generate settlement: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async calculateSettlement(outletId, period) {
                try {
                    const outlet = state.allOutlets.find(o => o.id === outletId);
                    if (!outlet) return null;
                    const [year, month] = period.split('-');
                    
                    // Get date range for the period
                    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
                    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
                    const startDateStr = startDate.toISOString().split('T')[0];
                    const endDateStr = endDate.toISOString().split('T')[0];
                    
                    // 1. Get Opening Inventory Value (closing inventory from previous month)
                    const previousMonth = new Date(parseInt(year), parseInt(month) - 2, 1);
                    const previousPeriod = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`;
                    
                    let openingInventoryValue = 0;
                    const previousSettlementRef = doc(db, 'users', state.currentUser.uid, 'outlets', outletId, 'settlements', previousPeriod);
                    const previousSettlementSnap = await getDoc(previousSettlementRef);
                    
                    if (previousSettlementSnap.exists()) {
                        openingInventoryValue = previousSettlementSnap.data().closingInventoryValue || 0;
                    }
                    
                    // 2. Get Consignments Received during the period
                    const consignmentsSnapshot = await getDocs(
                        collection(db, 'users', state.currentUser.uid, 'outlets', outletId, 'consignments')
                    );
                    
                    let consignmentsReceivedValue = 0;
                    const consignmentsList = [];
                    
                    consignmentsSnapshot.forEach(doc => {
                        const consignment = doc.data();
                        if (consignment.date >= startDateStr && consignment.date <= endDateStr && consignment.status === 'confirmed') {
                            const consignmentValue = parseFloat(consignment.totalCostValue) || 0;
                            const consignmentItems = parseInt(consignment.totalQuantity, 10) || 0;
                            consignmentsReceivedValue += consignmentValue;
                            consignmentsList.push({
                                id: doc.id,
                                date: consignment.date,
                                value: consignmentValue,
                                items: consignmentItems
                            });
                        }
                    });
                    
                    // 3. Get Sales during the period
                    const salesSnapshot = await getDocs(
                        collection(db, 'users', state.currentUser.uid, 'outlets', outletId, 'outlet_sales')
                    );
                    
                    let totalSalesValue = 0;
                    let costOfGoodsSold = 0;
                    const salesList = [];
                    
                    salesSnapshot.forEach(doc => {
                        const sale = doc.data();
                        if (sale.date >= startDateStr && sale.date <= endDateStr) {
                            // Use canonical getSaleTotal so settlement matches dashboard and PDF
                            const saleTotal = getSaleTotal(sale);

                            totalSalesValue += saleTotal;

                            const product = state.allProducts.find(p => p.name === sale.product);
                            if (product) {
                                costOfGoodsSold += (parseFloat(sale.quantity) || 0) * product.cost;
                            }

                            salesList.push({
                                id: doc.id,
                                date: sale.date,
                                customer: sale.customer || 'Walk-in',
                                product: sale.product || sale.productName || 'Unknown Product',
                                quantity: parseFloat(sale.quantity) || 0,
                                value: saleTotal
                            });
                        }
                    });
                    
                    // 4. Get Current (Closing) Inventory Value
                    const currentInventorySnapshot = await getDocs(
                        collection(db, 'users', state.currentUser.uid, 'outlets', outletId, 'outlet_inventory')
                    );
                    
                    let closingInventoryValue = 0;
                    const closingInventoryList = [];
                    
                    currentInventorySnapshot.forEach(doc => {
                        const item = doc.data();
                        const qty = parseFloat(item.quantity) || 0;
                        const cost = parseFloat(item.cost) || parseFloat(item.unitCost) || parseFloat(item.price) || 0;
                        const itemValue = qty * cost;
                        closingInventoryValue += itemValue;
                        closingInventoryList.push({
                            name: item.name || 'Unnamed Item',
                            quantity: qty,
                            cost: cost,
                            value: itemValue
                        });
                    });
                    
                    // 5. Calculate COGS (Alternative method if not calculated from sales)
                    // COGS = Opening Inventory + Consignments Received - Closing Inventory
                    const calculatedCOGS = openingInventoryValue + consignmentsReceivedValue - closingInventoryValue;
                    
                    // Use the calculated COGS if it's more accurate
                    const finalCOGS = Math.max(costOfGoodsSold, calculatedCOGS);
                    
                    // 6. Calculate Gross Profit
                    const grossProfit = totalSalesValue - finalCOGS;
                    
                    // 7. Calculate Commission (outlet's earnings)
                    const commissionRatePercent = parseFloat(outlet.commissionRate) || 0;
                    const commissionRate = commissionRatePercent / 100;
                    const outletCommission = grossProfit * commissionRate;
                    
                    // 8. Calculate Amount Payable to Main Shop
                    const amountPayableToMain = totalSalesValue - outletCommission;
                    
                    // Create settlement object
                    const settlement = {
                        outletId: outletId,
                        outletName: outlet.name,
                        period: period,
                        startDate: startDateStr,
                        endDate: endDateStr,
                        
                        // Inventory
                        openingInventoryValue: openingInventoryValue,
                        consignmentsReceivedValue: consignmentsReceivedValue,
                        closingInventoryValue: closingInventoryValue,
                        
                        // Sales
                        totalSalesValue: totalSalesValue,
                        salesCount: salesList.length,
                        
                        // Calculations
                        costOfGoodsSold: finalCOGS,
                        grossProfit: grossProfit,
                        
                        // Commission
                        commissionRate: commissionRatePercent,
                        outletCommission: outletCommission,
                        
                        // Payment
                        amountPayableToMain: amountPayableToMain,
                        paymentStatus: 'pending',
                        amountPaid: 0,
                        balanceDue: amountPayableToMain,
                        
                        // Details
                        consignments: consignmentsList,
                        sales: salesList,
                        closingInventory: closingInventoryList,
                        
                        // Metadata
                        generatedAt: new Date().toISOString(),
                        generatedBy: state.currentUser?.email || 'system'
                    };
                    
                    return settlement;
                    
                } catch (error) {
                    console.error('Error calculating settlement:', error);
                    return null;
                }
            }

            async viewSettlementDetails(outletId, settlementId) {
                Utils.showSpinner();
                
                try {

                    // Determine which user ID to use
                    let userId = state.currentUser.uid;
                    
                    if (state.userRole === 'outlet_manager') {
                        const outlet = state.allOutlets.find(o => o.id === outletId);
                        console.log("View Settlement: ", outlet)
                        if (outlet && outlet.createdBy) {
                            userId = outlet.createdBy;
                        }
                    }

                    const settlementRef = doc(db, 'users', userId, 'outlets', outletId, 'settlements', settlementId);
                    const settlementSnap = await getDoc(settlementRef);
                    
                    if (!settlementSnap.exists()) {
                        Utils.showToast('Settlement not found', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const settlement = settlementSnap.data();
                    
                    const detailsContent = document.getElementById('settlement-details-content');
                    if (!detailsContent) return;
                    
                    const statusColors = {
                        pending: '#ffc107',
                        partial: '#17a2b8',
                        paid: '#28a745'
                    };
                    
                    detailsContent.innerHTML = `
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; border-radius: 8px; margin-bottom: 2rem;">
                            <h2 style="margin: 0 0 0.5rem 0;">${settlement.outletName}</h2>
                            <p style="margin: 0; font-size: 1.2rem;">Settlement for ${new Date(settlement.period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.3);">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <small>Status</small><br>
                                        <strong style="font-size: 1.1rem;">${settlement.paymentStatus.toUpperCase()}</strong>
                                    </div>
                                    <div style="text-align: right;">
                                        <small>Amount Payable</small><br>
                                        <strong style="font-size: 1.5rem;">${Utils.formatCurrency(settlement.amountPayableToMain)}</strong>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                            <div class="stat-card">
                                <h4>Opening Inventory</h4>
                                <p>${Utils.formatCurrency(settlement.openingInventoryValue)}</p>
                            </div>
                            <div class="stat-card">
                                <h4>Consignments Received</h4>
                                <p>${Utils.formatCurrency(settlement.consignmentsReceivedValue)}</p>
                            </div>
                            <div class="stat-card">
                                <h4>Total Sales</h4>
                                <p style="color: #28a745;">${Utils.formatCurrency(settlement.totalSalesValue)}</p>
                            </div>
                            <div class="stat-card">
                                <h4>Closing Inventory</h4>
                                <p>${Utils.formatCurrency(settlement.closingInventoryValue)}</p>
                            </div>
                        </div>
                        
                        <div class="settlement-card">
                            <h4 style="margin: 0 0 1rem 0; color: #007bff;"><i class="fas fa-calculator"></i> Calculation Breakdown</h4>
                            <div class="settlement-breakdown">
                                <div><span>Opening Inventory Value:</span><span>${Utils.formatCurrency(settlement.openingInventoryValue)}</span></div>
                                <div><span>+ Consignments Received:</span><span>${Utils.formatCurrency(settlement.consignmentsReceivedValue)}</span></div>
                                <div><span>- Closing Inventory Value:</span><span>${Utils.formatCurrency(settlement.closingInventoryValue)}</span></div>
                                <div style="border-top: 2px solid #007bff; padding-top: 0.5rem; font-weight: bold;">
                                    <span>= Cost of Goods Sold (COGS):</span><span>${Utils.formatCurrency(settlement.costOfGoodsSold)}</span>
                                </div>
                            </div>
                            
                            <div class="settlement-breakdown" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #ddd;">
                                <div><span>Total Sales Value:</span><span>${Utils.formatCurrency(settlement.totalSalesValue)}</span></div>
                                <div><span>- Cost of Goods Sold:</span><span>${Utils.formatCurrency(settlement.costOfGoodsSold)}</span></div>
                                <div style="border-top: 2px solid #28a745; padding-top: 0.5rem; font-weight: bold;">
                                    <span>= Gross Profit:</span><span style="color: #28a745;">${Utils.formatCurrency(settlement.grossProfit)}</span></div>
                            </div>
                            
                            <div class="settlement-breakdown" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #ddd;">
                                <div><span>Gross Profit:</span><span>${Utils.formatCurrency(settlement.grossProfit)}</span></div>
                                <div><span>× Commission Rate:</span><span>${settlement.commissionRate}%</span></div>
                                <div style="border-top: 2px solid #17a2b8; padding-top: 0.5rem; font-weight: bold;">
                                    <span>= Outlet Commission:</span><span style="color: #17a2b8;">${Utils.formatCurrency(settlement.outletCommission)}</span></div>
                            </div>
                            
                            <div class="settlement-breakdown" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #ddd;">
                                <div><span>Total Sales Value:</span><span>${Utils.formatCurrency(settlement.totalSalesValue)}</span></div>
                                <div><span>- Outlet Commission:</span><span>${Utils.formatCurrency(settlement.outletCommission)}</span></div>
                                <div style="border-top: 3px solid #007bff; padding-top: 0.5rem; font-weight: bold; font-size: 1.1rem;">
                                    <span>= AMOUNT PAYABLE TO MAIN:</span><span style="color: #007bff;">${Utils.formatCurrency(settlement.amountPayableToMain)}</span></div>
                            </div>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem;">
                            <div class="settlement-card">
                                <h4 style="margin: 0 0 0.5rem 0;"><i class="fas fa-truck"></i> Consignments (${settlement.consignments.length})</h4>
                                ${settlement.consignments.length > 0 ? `
                                    <ul style="margin: 0; padding-left: 1.5rem; font-size: 0.9rem;">
                                        ${settlement.consignments.map(c => `
                                            <li>${c.date}: ${c.items} items - ${Utils.formatCurrency(c.value)}</li>
                                        `).join('')}
                                    </ul>
                                ` : '<p style="margin: 0; color: #888;">No consignments this period</p>'}
                            </div>
                            
                            <div class="settlement-card">
                                <h4 style="margin: 0 0 0.5rem 0;"><i class="fas fa-shopping-cart"></i> Sales (${settlement.salesCount})</h4>
                                ${settlement.salesCount > 0 ? `
                                    <p style="margin: 0; font-size: 0.9rem;">
                                        Total: ${Utils.formatCurrency(settlement.totalSalesValue)}<br>
                                        Average: ${Utils.formatCurrency(settlement.totalSalesValue / settlement.salesCount)}
                                    </p>
                                ` : '<p style="margin: 0; color: #888;">No sales this period</p>'}
                            </div>
                        </div>
                        
                        ${settlement.paymentStatus !== 'paid' ? `
                            <div style="margin-top: 2rem; padding: 1rem; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ffc107;">
                                <p style="margin: 0; color: #856404;">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <strong>Balance Due:</strong> ${Utils.formatCurrency(settlement.balanceDue)}
                                </p>
                                ${settlement.amountPaid > 0 ? `
                                    <p style="margin: 0.5rem 0 0 0; color: #856404;">
                                        Amount Paid: ${Utils.formatCurrency(settlement.amountPaid)}
                                    </p>
                                ` : ''}
                            </div>
                        ` : `
                            <div style="margin-top: 2rem; padding: 1rem; background: #d4edda; border-radius: 4px; border-left: 4px solid #28a745;">
                                <p style="margin: 0; color: #155724;">
                                    <i class="fas fa-check-circle"></i>
                                    <strong>PAID IN FULL</strong> - Settlement completed
                                </p>
                                ${settlement.paymentDate ? `
                                    <p style="margin: 0.5rem 0 0 0; color: #155724;">
                                        Payment Date: ${new Date(settlement.paymentDate).toLocaleDateString()}
                                    </p>
                                ` : ''}
                            </div>
                        `}
                        
                        <div style="margin-top: 2rem; text-align: center; display: flex; gap: 1rem; justify-content: center;">
                            <button onclick="appController.exportSettlementPDF('${outletId}', '${settlementId}')">
                                <i class="fas fa-file-pdf"></i> Export PDF
                            </button>
                            ${settlement.paymentStatus !== 'paid' && state.userRole === 'admin' ? `
                                <button onclick="document.getElementById('view-settlement-modal').style.display='none'; appController.openRecordPaymentModal('${outletId}', '${settlementId}');" style="background: #28a745;">
                                    <i class="fas fa-money-bill-wave"></i> Record Payment
                                </button>
                            ` : ''}
                        </div>
                    `;
                    
                    document.getElementById('view-settlement-modal').style.display = 'block';
                    
                } catch (error) {
                    Utils.showToast('Failed to load settlement details: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async openRecordPaymentModal(preselectedOutletId = null, preselectedSettlementId = null) {
                Utils.showSpinner();
                
                try {
                    // Load all pending/partial settlements
                    const pendingSettlements = [];
                    
                    for (const outlet of state.allOutlets) {
                        const settlementsSnapshot = await getDocs(
                            collection(db, 'users', state.currentUser.uid, 'outlets', outlet.id, 'settlements')
                        );
                        
                        settlementsSnapshot.forEach(doc => {
                            const settlement = doc.data();
                        if (settlement.paymentStatus !== 'paid') {
                            pendingSettlements.push({
                                ...settlement,
                                id: doc.id,
                                outletId: outlet.id,
                                displayName: `${outlet.name} - ${new Date(settlement.period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} - ${Utils.formatCurrency(settlement.balanceDue)}`
                            });
                        }
                    });
                }
                
                // Sort by date (oldest first)
                pendingSettlements.sort((a, b) => new Date(a.period) - new Date(b.period));
                
                if (pendingSettlements.length === 0) {
                    Utils.showToast('No pending settlements found', 'info');
                    Utils.hideSpinner();
                    return;
                }
                
                // Populate settlement dropdown
                const settlementSelect = document.getElementById('payment-settlement');
                if (settlementSelect) {
                    settlementSelect.innerHTML = '<option value="">Choose settlement...</option>' +
                        pendingSettlements.map(s => 
                            `<option value="${s.outletId}|${s.id}" ${preselectedOutletId === s.outletId && preselectedSettlementId === s.id ? 'selected' : ''}>${s.displayName}</option>`
                        ).join('');
                }
                
                // Set today's date
                document.getElementById('payment-date').valueAsDate = new Date();
                
                // If preselected, show info
                if (preselectedOutletId && preselectedSettlementId) {
                    this.showPaymentSettlementInfo(`${preselectedOutletId}|${preselectedSettlementId}`);
                }
                
                document.getElementById('record-payment-modal').style.display = 'block';
                
                } catch (error) {
                    Utils.showToast('Failed to load settlements: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async showPaymentSettlementInfo(value) {
                if (!value) {
                    document.getElementById('payment-settlement-info').style.display = 'none';
                    return;
                }
                
                const [outletId, settlementId] = value.split('|');
                
                try {
                    const settlementRef = doc(db, 'users', state.currentUser.uid, 'outlets', outletId, 'settlements', settlementId);
                    const settlementSnap = await getDoc(settlementRef);
                    
                    if (!settlementSnap.exists()) return;
                    
                    const settlement = settlementSnap.data();
                    
                    const infoDiv = document.getElementById('payment-settlement-info');
                    if (infoDiv) {
                        infoDiv.innerHTML = `
                            <h4 style="margin: 0 0 0.5rem 0;">${settlement.outletName} - ${new Date(settlement.period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h4>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.9rem;">
                                <div><strong>Total Amount:</strong></div>
                                <div style="text-align: right;">${Utils.formatCurrency(settlement.amountPayableToMain)}</div>
                                
                                ${settlement.amountPaid > 0 ? `
                                    <div><strong>Already Paid:</strong></div>
                                    <div style="text-align: right; color: #28a745;">${Utils.formatCurrency(settlement.amountPaid)}</div>
                                ` : ''}
                                
                                <div style="border-top: 2px solid #007bff; padding-top: 0.5rem;"><strong>Balance Due:</strong></div>
                                <div style="text-align: right; border-top: 2px solid #007bff; padding-top: 0.5rem; color: #007bff; font-size: 1.1rem;"><strong>${Utils.formatCurrency(settlement.balanceDue)}</strong></div>
                            </div>
                        `;
                        infoDiv.style.display = 'block';
                        
                        // Set max payment amount
                        const paymentAmountInput = document.getElementById('payment-amount');
                        if (paymentAmountInput) {
                            paymentAmountInput.setAttribute('max', settlement.balanceDue);
                            paymentAmountInput.value = settlement.balanceDue; // Default to full payment
                        }
                    }
                    
                } catch (error) {
                    console.error('Error loading settlement info:', error);
                }
            }

            async handleRecordPayment(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!state.currentUser || !state.currentUser.uid) {
                    Utils.showToast('Please sign in again to record payments', 'error');
                    return;
                }
                Utils.showSpinner();
                
                try {
                    const settlementValue = document.getElementById('payment-settlement').value;
                    if (!settlementValue) {
                        Utils.showToast('Please select a settlement', 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const [outletId, settlementId] = settlementValue.split('|');
                    const paymentDate = document.getElementById('payment-date').value;
                    const amount = parseFloat(document.getElementById('payment-amount').value);
                    const method = document.getElementById('payment-method').value;
                    const reference = document.getElementById('payment-reference').value;
                    const notes = document.getElementById('payment-notes').value;
                    
                    if (amount <= 0) {
                        Utils.showToast('Payment amount must be greater than 0', 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    // Get current settlement
                    const settlementRef = doc(db, 'users', state.currentUser.uid, 'outlets', outletId, 'settlements', settlementId);
                    const settlementSnap = await getDoc(settlementRef);
                    
                    if (!settlementSnap.exists()) {
                        Utils.showToast('Settlement not found', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    const settlement = settlementSnap.data();
                    const balanceDue = Number(settlement.balanceDue);
                    const amountPaidSoFar = Number(settlement.amountPaid) || 0;
                    if (isNaN(balanceDue) || balanceDue <= 0) {
                        Utils.showToast('Invalid settlement data (balance due missing)', 'error');
                        Utils.hideSpinner();
                        return;
                    }
                    if (amount > balanceDue) {
                        Utils.showToast(`Payment amount cannot exceed balance due (${Utils.formatCurrency(balanceDue)})`, 'warning');
                        Utils.hideSpinner();
                        return;
                    }
                    
                    // Calculate new balances
                    const newAmountPaid = amountPaidSoFar + amount;
                    const newBalanceDue = balanceDue - amount;
                    const newStatus = newBalanceDue === 0 ? 'paid' : newBalanceDue < settlement.amountPayableToMain ? 'partial' : 'pending';
                    
                    // Create payment record
                    const payment = {
                        date: paymentDate,
                        amount: amount,
                        method: method,
                        reference: reference,
                        notes: notes,
                        recordedAt: new Date().toISOString(),
                        recordedBy: state.currentUser.email
                    };
                    
                    // Update settlement
                    const updateData = {
                        amountPaid: newAmountPaid,
                        balanceDue: newBalanceDue,
                        paymentStatus: newStatus,
                        lastPayment: payment
                    };
                    
                    if (newStatus === 'paid') {
                        updateData.paymentDate = paymentDate;
                        updateData.paidAt = new Date().toISOString();
                    }
                    
                    // Add payment to payments array
                    if (!settlement.payments) {
                        updateData.payments = [payment];
                    } else {
                        updateData.payments = [...settlement.payments, payment];
                    }
                    
                    await updateDoc(settlementRef, updateData);
                    
                    await ActivityLogger.log('Payment Recorded', `Payment of ${Utils.formatCurrency(amount)} recorded for ${settlement.outletName} - ${settlement.period}`);
                    
                    Utils.showToast(`Payment of ${Utils.formatCurrency(amount)} recorded successfully`, 'success');
                    document.getElementById('record-payment-modal').style.display = 'none';
                    document.getElementById('record-payment-form').reset();
                    
                    this.renderSettlements();
                    
                } catch (error) {
                    console.error('Record payment error:', error);
                    Utils.showToast('Failed to record payment: ' + (error.message || 'Please try again'), 'error');
                    // Keep modal open so user can retry
                } finally {
                    Utils.hideSpinner();
                }
            }

            /*async renderSettlements() {
                const listContainer = document.getElementById('settlements-list');
                const summaryContainer = document.getElementById('settlements-summary');
                
                if (!listContainer) return;
                
                Utils.showSpinner();
                
                try {
                    // Get filters
                    const outletFilter = document.getElementById('settlement-outlet-filter')?.value || '';
                    const periodFilter = document.getElementById('settlement-period-filter')?.value || '';
                    const statusFilter = document.getElementById('settlement-status-filter')?.value || '';
                    
                    // Load all settlements
                    const allSettlements = [];
                    
                    for (const outlet of state.allOutlets) {
                        const settlementsSnapshot = await getDocs(
                            collection(db, 'users', state.currentUser.uid, 'outlets', outlet.id, 'settlements')
                        );
                        
                        settlementsSnapshot.forEach(doc => {
                            allSettlements.push({
                                ...doc.data(),
                                id: doc.id,
                                outletId: outlet.id
                            });
                        });
                    }
                    
                    // Sort by period (newest first)
                    allSettlements.sort((a, b) => b.period.localeCompare(a.period));
                    
                    // Apply filters
                    let filtered = allSettlements;
                    
                    if (outletFilter) {
                        filtered = filtered.filter(s => s.outletId === outletFilter);
                    }
                    
                    if (periodFilter) {
                        filtered = filtered.filter(s => s.period === periodFilter);
                    }
                    
                    if (statusFilter) {
                        filtered = filtered.filter(s => s.paymentStatus === statusFilter);
                    }
                    
                    // Calculate summary metrics
                    const totalSettlements = filtered.length;
                    const totalPayable = filtered.reduce((sum, s) => sum + s.amountPayableToMain, 0);
                    const totalPaid = filtered.reduce((sum, s) => sum + s.amountPaid, 0);
                    const totalOutstanding = filtered.reduce((sum, s) => sum + s.balanceDue, 0);
                    const pendingCount = filtered.filter(s => s.paymentStatus === 'pending').length;
                    const partialCount = filtered.filter(s => s.paymentStatus === 'partial').length;
                    const paidCount = filtered.filter(s => s.paymentStatus === 'paid').length;
                    
                    // Render summary
                    if (summaryContainer) {
                        summaryContainer.innerHTML = `
                            <div class="metric-card">
                                <h3>${totalSettlements}</h3>
                                <p>Total Settlements</p>
                            </div>
                            <div class="metric-card">
                                <h3>${Utils.formatCurrency(totalPayable)}</h3>
                                <p>Total Payable</p>
                            </div>
                            <div class="metric-card" style="border-left: 4px solid #28a745;">
                                <h3>${Utils.formatCurrency(totalPaid)}</h3>
                                <p>Total Paid</p>
                            </div>
                            <div class="metric-card" style="border-left: 4px solid #dc3545;">
                                <h3>${Utils.formatCurrency(totalOutstanding)}</h3>
                                <p>Outstanding Balance</p>
                            </div>
                            <div class="metric-card" style="border-left: 4px solid #ffc107;">
                                <h3>${pendingCount}</h3>
                                <p>Pending</p>
                            </div>
                            <div class="metric-card" style="border-left: 4px solid #17a2b8;">
                                <h3>${partialCount}</h3>
                                <p>Partial Payments</p>
                            </div>
                        `;
                    }
                    
                    // Render settlements list
                    if (filtered.length === 0) {
                        listContainer.innerHTML = '<div class="no-data">No settlements found</div>';
                    } else {
                        listContainer.innerHTML = filtered.map(settlement => {
                            const statusColors = {
                                pending: { bg: '#fff3cd', text: '#856404', border: '#ffc107' },
                                partial: { bg: '#d1ecf1', text: '#0c5460', border: '#17a2b8' },
                                paid: { bg: '#d4edda', text: '#155724', border: '#28a745' }
                            };
                            const defaultStatusColors = { bg: '#f8f9fa', text: '#6c757d', border: '#dee2e6' };
                            const colors = statusColors[settlement.paymentStatus] || defaultStatusColors;
                            const isOverdue = settlement.paymentStatus !== 'paid' && new Date(settlement.period) < new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
                            
                            return `
                                <div class="settlement-card ${isOverdue ? 'overdue' : ''}" style="border-left-color: ${colors.border};">
                                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                                        <div>
                                            <h4 style="margin: 0 0 0.25rem 0;">${settlement.outletName}</h4>
                                            <p style="margin: 0; color: #666; font-size: 0.9rem;">
                                                ${new Date(settlement.period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                                ${isOverdue ? '<span style="color: #dc3545; margin-left: 0.5rem;"><i class="fas fa-exclamation-triangle"></i> Overdue</span>' : ''}
                                            </p>
                                        </div>
                                        <span style="padding: 0.5rem 1rem; background: ${colors.bg}; color: ${colors.text}; border-radius: 20px; font-weight: 500; font-size: 0.85rem;">
                                            ${(settlement.paymentStatus || 'pending').toUpperCase()}
                                        </span>
                                    </div>
                                    
                                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
                                        <div>
                                            <small style="color: #666;">Total Sales</small><br>
                                            <strong>${Utils.formatCurrency(settlement.totalSalesValue)}</strong>
                                        </div>
                                        <div>
                                            <small style="color: #666;">Gross Profit</small><br>
                                            <strong style="color: #28a745;">${Utils.formatCurrency(settlement.grossProfit)}</strong>
                                        </div>
                                        <div>
                                            <small style="color: #666;">Outlet Commission</small><br>
                                            <strong style="color: #17a2b8;">${Utils.formatCurrency(settlement.outletCommission)}</strong>
                                        </div>
                                        <div>
                                            <small style="color: #666;">Payable to Main</small><br>
                                            <strong style="color: #007bff;">${Utils.formatCurrency(settlement.amountPayableToMain)}</strong>
                                        </div>
                                    </div>
                                    
                                    ${settlement.paymentStatus !== 'paid' ? `
                                        <div style="background: ${isOverdue ? '#f8d7da' : '#f8f9fa'}; padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem;">
                                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                                <span><strong>Balance Due:</strong></span>
                                                <span style="color: ${isOverdue ? '#dc3545' : '#007bff'}; font-size: 1.1rem; font-weight: bold;">
                                                    ${Utils.formatCurrency(settlement.balanceDue)}
                                                </span>
                                            </div>
                                            ${settlement.amountPaid > 0 ? `
                                                <div style="margin-top: 0.5rem; font-size: 0.9rem; color: #666;">
                                                    Paid: ${Utils.formatCurrency(settlement.amountPaid)} of ${Utils.formatCurrency(settlement.amountPayableToMain)}
                                                </div>
                                            ` : ''}
                                        </div>
                                    ` : `
                                        <div style="background: #d4edda; padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem; color: #155724;">
                                            <i class="fas fa-check-circle"></i> <strong>Paid in Full</strong>
                                            ${settlement.paymentDate ? ` on ${new Date(settlement.paymentDate).toLocaleDateString()}` : ''}
                                        </div>
                                    `}
                                    
                                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                        <button onclick="appController.viewSettlementDetails('${settlement.outletId}', '${settlement.id}')">
                                            <i class="fas fa-eye"></i> View Details
                                        </button>
                                        ${settlement.paymentStatus !== 'paid' && state.userRole === 'admin' ? `
                                            <button onclick="appController.openRecordPaymentModal('${settlement.outletId}', '${settlement.id}')" style="background: #28a745;">
                                                <i class="fas fa-money-bill-wave"></i> Record Payment
                                            </button>
                                        ` : ''}
                                        <button onclick="appController.exportSettlementPDF('${settlement.outletId}', '${settlement.id}')">
                                            <i class="fas fa-file-pdf"></i> Export PDF
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    }
                    
                    // Populate filter dropdowns if empty
                    const outletFilterSelect = document.getElementById('settlement-outlet-filter');
                    if (outletFilterSelect && outletFilterSelect.options.length <= 1) {
                        outletFilterSelect.innerHTML = '<option value="">All Outlets</option>' +
                            state.allOutlets.map(outlet => 
                                `<option value="${outlet.id}">${outlet.name}</option>`
                            ).join('');
                    }
                    
                    const periodFilterSelect = document.getElementById('settlement-period-filter');
                    if (periodFilterSelect && periodFilterSelect.options.length <= 1) {
                        const uniquePeriods = [...new Set(allSettlements.map(s => s.period))].sort().reverse();
                        periodFilterSelect.innerHTML = '<option value="">All Periods</option>' +
                            uniquePeriods.map(period => 
                                `<option value="${period}">${new Date(period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>`
                            ).join('');
                    }
                    
                } catch (error) {
                    console.error('Error rendering settlements:', error);
                    listContainer.innerHTML = '<div class="no-data">Error loading settlements</div>';
                } finally {
                    Utils.hideSpinner();
                }
            }*/

            async renderSettlements() {
                const listContainer = document.getElementById('settlements-list');
                const summaryContainer = document.getElementById('settlements-summary');
                
                if (!listContainer) return;
                
                console.log('=== RENDERING SETTLEMENTS ===');
                console.log('User role:', state.userRole);
                console.log('Assigned outlet:', state.assignedOutlet);
                
                Utils.showSpinner();
                
                try {
                    // Get filters
                    const outletFilter = document.getElementById('settlement-outlet-filter')?.value || '';
                    const periodFilter = document.getElementById('settlement-period-filter')?.value || '';
                    const statusFilter = document.getElementById('settlement-status-filter')?.value || '';
                    
                    // Load all settlements
                    const allSettlements = [];
                    
                    // ⭐ CRITICAL: Determine which user ID to use
                    let userId;
                    let outletsToLoad = [];
                    
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // OUTLET MANAGER: Only load their outlet's settlements
                        const outlet = state.allOutlets[0];
                        
                        if (!outlet || !outlet.createdBy) {
                            console.error('❌ Outlet not loaded or missing parentAdminId');
                            Utils.showToast('Configuration error: Missing parent admin reference', 'error');
                            Utils.hideSpinner();
                            return;
                        }
                        
                        userId = outlet.createdBy;
                        outletsToLoad = [outlet];
                        
                        console.log('Loading settlements for outlet manager');
                        console.log('Parent Admin ID:', userId);
                        console.log('Outlet:', outlet.name);
                        
                    } else {
                        // ADMIN: Load all outlets
                        userId = state.currentUser.uid;
                        outletsToLoad = state.allOutlets;
                        
                        console.log('Loading settlements for admin');
                        console.log('Admin ID:', userId);
                        console.log('Outlets:', outletsToLoad.length);
                    }
                    
                    // Load settlements from each outlet
                    for (const outlet of outletsToLoad) {
                        const settlementsPath = `users/${userId}/outlets/${outlet.id}/settlements`;
                        console.log('Loading from:', settlementsPath);
                        
                        const settlementsSnapshot = await getDocs(
                            collection(db, 'users', userId, 'outlets', outlet.id, 'settlements')
                        );
                        
                        console.log(`Found ${settlementsSnapshot.size} settlement(s) for outlet:`, outlet.name);
                        
                        settlementsSnapshot.forEach(doc => {
                            allSettlements.push({
                                ...doc.data(),
                                id: doc.id,
                                outletId: outlet.id
                            });
                        });
                    }
                    
                    console.log('Total settlements loaded:', allSettlements.length);
                    
                    // Sort by period (newest first); guard against undefined period
                    allSettlements.sort((a, b) => (b.period || '').localeCompare(a.period || ''));
                    
                    // Apply filters
                    let filtered = allSettlements;
                    
                    if (outletFilter) {
                        filtered = filtered.filter(s => s.outletId === outletFilter);
                    }
                    
                    if (periodFilter) {
                        filtered = filtered.filter(s => s.period === periodFilter);
                    }
                    
                    if (statusFilter) {
                        filtered = filtered.filter(s => s.paymentStatus === statusFilter);
                    }
                    
                    console.log('Filtered settlements:', filtered.length);
                    
                    // Calculate summary metrics
                    const totalSettlements = filtered.length;
                    const totalPayable = filtered.reduce((sum, s) => sum + s.amountPayableToMain, 0);
                    const totalPaid = filtered.reduce((sum, s) => sum + s.amountPaid, 0);
                    const totalOutstanding = filtered.reduce((sum, s) => sum + s.balanceDue, 0);
                    const pendingCount = filtered.filter(s => s.paymentStatus === 'pending').length;
                    const partialCount = filtered.filter(s => s.paymentStatus === 'partial').length;
                    const paidCount = filtered.filter(s => s.paymentStatus === 'paid').length;
                    
                    // Render summary
                    if (summaryContainer) {
                        summaryContainer.innerHTML = `
                            <div class="metric-card">
                                <h3>${totalSettlements}</h3>
                                <p>Total Settlements</p>
                            </div>
                            <div class="metric-card">
                                <h3>${Utils.formatCurrency(totalPayable)}</h3>
                                <p>Total Payable</p>
                            </div>
                            <div class="metric-card" style="border-left: 4px solid #28a745;">
                                <h3>${Utils.formatCurrency(totalPaid)}</h3>
                                <p>Total Paid</p>
                            </div>
                            <div class="metric-card" style="border-left: 4px solid #dc3545;">
                                <h3>${Utils.formatCurrency(totalOutstanding)}</h3>
                                <p>Outstanding Balance</p>
                            </div>
                            <div class="metric-card" style="border-left: 4px solid #ffc107;">
                                <h3>${pendingCount}</h3>
                                <p>Pending</p>
                            </div>
                            <div class="metric-card" style="border-left: 4px solid #17a2b8;">
                                <h3>${partialCount}</h3>
                                <p>Partial Payments</p>
                            </div>
                        `;
                    }
                    
                    // Render settlements list
                    if (filtered.length === 0) {
                        listContainer.innerHTML = `
                            <div class="no-data">
                                <i class="fas fa-file-invoice-dollar" style="font-size: 3rem; color: #ddd; margin-bottom: 1rem;"></i>
                                <p>No settlements found</p>
                                ${state.userRole === 'outlet_manager' ? 
                                    '<small>Settlements will appear here after sales are made and settlement periods end.</small>' : 
                                    '<small>Settlements will be generated monthly for each outlet.</small>'}
                            </div>
                        `;
                    } else {
                        listContainer.innerHTML = filtered.map(settlement => {
                            const statusColors = {
                                pending: { bg: '#fff3cd', text: '#856404', border: '#ffc107' },
                                partial: { bg: '#d1ecf1', text: '#0c5460', border: '#17a2b8' },
                                paid: { bg: '#d4edda', text: '#155724', border: '#28a745' }
                            };
                            const defaultStatusColors = { bg: '#f8f9fa', text: '#6c757d', border: '#dee2e6' };
                            const colors = statusColors[settlement.paymentStatus] || defaultStatusColors;
                            const isOverdue = settlement.paymentStatus !== 'paid' && new Date(settlement.period) < new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
                            
                            return `
                                <div class="settlement-card ${isOverdue ? 'overdue' : ''}" style="border-left-color: ${colors.border};">
                                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                                        <div>
                                            <h4 style="margin: 0 0 0.25rem 0;">${settlement.outletName}</h4>
                                            <p style="margin: 0; color: #666; font-size: 0.9rem;">
                                                ${new Date(settlement.period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                                ${isOverdue ? '<span style="color: #dc3545; margin-left: 0.5rem;"><i class="fas fa-exclamation-triangle"></i> Overdue</span>' : ''}
                                            </p>
                                        </div>
                                        <span style="padding: 0.5rem 1rem; background: ${colors.bg}; color: ${colors.text}; border-radius: 20px; font-weight: 500; font-size: 0.85rem;">
                                            ${(settlement.paymentStatus || 'pending').toUpperCase()}
                                        </span>
                                    </div>
                                    
                                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
                                        <div>
                                            <small style="color: #666;">Total Sales</small><br>
                                            <strong>${Utils.formatCurrency(settlement.totalSalesValue)}</strong>
                                        </div>
                                        <div>
                                            <small style="color: #666;">Gross Profit</small><br>
                                            <strong style="color: #28a745;">${Utils.formatCurrency(settlement.grossProfit)}</strong>
                                        </div>
                                        <div>
                                            <small style="color: #666;">Outlet Commission</small><br>
                                            <strong style="color: #17a2b8;">${Utils.formatCurrency(settlement.outletCommission)}</strong>
                                        </div>
                                        <div>
                                            <small style="color: #666;">Payable to Main</small><br>
                                            <strong style="color: #007bff;">${Utils.formatCurrency(settlement.amountPayableToMain)}</strong>
                                        </div>
                                    </div>
                                    
                                    ${settlement.paymentStatus !== 'paid' ? `
                                        <div style="background: ${isOverdue ? '#f8d7da' : '#f8f9fa'}; padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem;">
                                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                                <span><strong>Balance Due:</strong></span>
                                                <span style="color: ${isOverdue ? '#dc3545' : '#007bff'}; font-size: 1.1rem; font-weight: bold;">
                                                    ${Utils.formatCurrency(settlement.balanceDue)}
                                                </span>
                                            </div>
                                            ${settlement.amountPaid > 0 ? `
                                                <div style="margin-top: 0.5rem; font-size: 0.9rem; color: #666;">
                                                    Paid: ${Utils.formatCurrency(settlement.amountPaid)} of ${Utils.formatCurrency(settlement.amountPayableToMain)}
                                                </div>
                                            ` : ''}
                                        </div>
                                    ` : `
                                        <div style="background: #d4edda; padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem; color: #155724;">
                                            <i class="fas fa-check-circle"></i> <strong>Paid in Full</strong>
                                            ${settlement.paymentDate ? ` on ${new Date(settlement.paymentDate).toLocaleDateString()}` : ''}
                                        </div>
                                    `}
                                    
                                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                        <button onclick="appController.viewSettlementDetails('${settlement.outletId}', '${settlement.id}')">
                                            <i class="fas fa-eye"></i> View Details
                                        </button>
                                        ${settlement.paymentStatus !== 'paid' && state.userRole === 'admin' ? `
                                            <button onclick="appController.openRecordPaymentModal('${settlement.outletId}', '${settlement.id}')" style="background: #28a745;">
                                                <i class="fas fa-money-bill-wave"></i> Record Payment
                                            </button>
                                        ` : ''}
                                        <button onclick="appController.exportSettlementPDF('${settlement.outletId}', '${settlement.id}')">
                                            <i class="fas fa-file-pdf"></i> Export PDF
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    }
                    
                    // Populate filter dropdowns
                    const outletFilterSelect = document.getElementById('settlement-outlet-filter');
                    if (outletFilterSelect) {
                        if (state.userRole === 'outlet_manager') {
                            // Hide outlet filter for managers
                            const filterContainer = outletFilterSelect.closest('.filters');
                            if (filterContainer) {
                                const outletFilterDiv = outletFilterSelect.parentElement;
                                if (outletFilterDiv) outletFilterDiv.style.display = 'none';
                            }
                        } else if (state.userRole === 'admin' && outletFilterSelect.options.length <= 1) {
                            outletFilterSelect.innerHTML = '<option value="">All Outlets</option>' +
                                state.allOutlets.map(outlet => 
                                    `<option value="${outlet.id}">${outlet.name}</option>`
                                ).join('');
                        }
                    }
                    
                    const periodFilterSelect = document.getElementById('settlement-period-filter');
                    if (periodFilterSelect && periodFilterSelect.options.length <= 1) {
                        const uniquePeriods = [...new Set(allSettlements.map(s => s.period))].sort().reverse();
                        periodFilterSelect.innerHTML = '<option value="">All Periods</option>' +
                            uniquePeriods.map(period => 
                                `<option value="${period}">${new Date(period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>`
                            ).join('');
                    }
                    
                    console.log('✅ Settlements rendered successfully');
                    
                } catch (error) {
                    console.error('❌ Error rendering settlements:', error);
                    console.error('Error code:', error.code);
                    listContainer.innerHTML = '<div class="no-data">Error loading settlements: ' + error.message + '</div>';
                } finally {
                    Utils.hideSpinner();
                }
            }

            exportSettlementPDF(outletId, settlementId) {
                // Placeholder for PDF export functionality
                Utils.showToast('PDF export functionality - to be implemented with a PDF library', 'info');
                // You can integrate jsPDF library for this
            }

            performGlobalSearch(query) {
                const results = {
                    products: [],
                    sales: [],
                    customers: [],
                    expenses: []
                };
                
                state.allProducts.forEach(product => {
                    if (
                        product.name.toLowerCase().includes(query) ||
                        product.category.toLowerCase().includes(query) ||
                        product.barcode?.includes(query)
                    ) {
                        results.products.push(product);
                    }
                });
                
                state.allSales.forEach(sale => {
                    if (
                        sale.customer.toLowerCase().includes(query) ||
                        sale.product.toLowerCase().includes(query) ||
                        sale.date.includes(query)
                    ) {
                        results.sales.push(sale);
                    }
                });
                
                state.allCustomers.forEach(customer => {
                    if (
                        customer.name.toLowerCase().includes(query) ||
                        customer.email?.toLowerCase().includes(query) ||
                        customer.phone?.includes(query)
                    ) {
                        results.customers.push(customer);
                    }
                });
                
                state.allExpenses.forEach(expense => {
                    if (
                        expense.description.toLowerCase().includes(query) ||
                        expense.category.toLowerCase().includes(query) ||
                        expense.date.includes(query)
                    ) {
                        results.expenses.push(expense);
                    }
                });
                
                this.displayGlobalSearchResults(results, query);
            }

            displayGlobalSearchResults(results, query) {
                const container = document.getElementById('global-search-results');
                if (!container) return;
                
                let html = '';
                let totalResults = 0;
                
                if (results.products.length > 0) {
                    html += '<div style="padding: 1rem; border-bottom: 1px solid #eee;"><h4 style="margin: 0 0 0.5rem 0; color: #007bff;">Products</h4>';
                    results.products.slice(0, 5).forEach(product => {
                        html += `
                            <div style="padding: 0.5rem; cursor: pointer; border-radius: 4px;" 
                                 onclick="appController.navigateToSection('inventory'); document.getElementById('inventory-search').value='${product.name}'; document.getElementById('global-search-results').style.display='none';"
                                 onmouseover="this.style.background='#f8f9fa'" 
                                 onmouseout="this.style.background='transparent'">
                                <strong>${product.name}</strong> - ${product.category} (Stock: ${product.quantity})
                            </div>
                        `;
                    });
                    if (results.products.length > 5) {
                        html += `<div style="padding: 0.5rem; color: #666; font-size: 0.9rem;">+${results.products.length - 5} more</div>`;
                    }
                    html += '</div>';
                    totalResults += results.products.length;
                }
                
                if (results.sales.length > 0) {
                    html += '<div style="padding: 1rem; border-bottom: 1px solid #eee;"><h4 style="margin: 0 0 0.5rem 0; color: #28a745;">Sales</h4>';
                    results.sales.slice(0, 5).forEach(sale => {
                        const subtotal = sale.quantity * sale.price;
                        const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                        const total = discounted * (1 + (sale.tax || 0) / 100);
                        
                        html += `
                            <div style="padding: 0.5rem; cursor: pointer; border-radius: 4px;" 
                                 onclick="appController.navigateToSection('sales'); document.getElementById('sales-customer-search').value='${sale.customer}'; document.getElementById('global-search-results').style.display='none';"
                                 onmouseover="this.style.background='#f8f9fa'" 
                                 onmouseout="this.style.background='transparent'">
                                ${sale.date} - <strong>${sale.customer}</strong> - ${sale.product} - ${Utils.formatCurrency(total)}
                            </div>
                        `;
                    });
                    if (results.sales.length > 5) {
                        html += `<div style="padding: 0.5rem; color: #666; font-size: 0.9rem;">+${results.sales.length - 5} more</div>`;
                    }
                    html += '</div>';
                    totalResults += results.sales.length;
                }
                
                if (results.customers.length > 0) {
                    html += '<div style="padding: 1rem; border-bottom: 1px solid #eee;"><h4 style="margin: 0 0 0.5rem 0; color: #17a2b8;">Customers</h4>';
                    results.customers.slice(0, 5).forEach(customer => {
                        html += `
                            <div style="padding: 0.5rem; cursor: pointer; border-radius: 4px;" 
                                 onclick="appController.navigateToSection('customers'); document.getElementById('customer-search').value='${customer.name}'; document.getElementById('global-search-results').style.display='none';"
                                 onmouseover="this.style.background='#f8f9fa'" 
                                 onmouseout="this.style.background='transparent'">
                                <strong>${customer.name}</strong> - ${customer.email || ''} ${customer.phone || ''}
                            </div>
                        `;
                    });
                    if (results.customers.length > 5) {
                        html += `<div style="padding: 0.5rem; color: #666; font-size: 0.9rem;">+${results.customers.length - 5} more</div>`;
                    }
                    html += '</div>';
                    totalResults += results.customers.length;
                }
                
                const canViewExpenses = state.userRole !== 'outlet_manager';
                if (canViewExpenses && results.expenses.length > 0) {
                    html += '<div style="padding: 1rem;"><h4 style="margin: 0 0 0.5rem 0; color: #dc3545;">Expenses</h4>';
                    results.expenses.slice(0, 5).forEach(expense => {
                        html += `
                            <div style="padding: 0.5rem; cursor: pointer; border-radius: 4px;" 
                                 onclick="appController.navigateToSection('expenses'); document.getElementById('expense-search').value='${expense.description}'; document.getElementById('global-search-results').style.display='none';"
                                 onmouseover="this.style.background='#f8f9fa'" 
                                 onmouseout="this.style.background='transparent'">
                                ${expense.date} - <strong>${expense.description}</strong> - ${expense.category} - ${Utils.formatCurrency(expense.amount)}
                            </div>
                        `;
                    });
                    if (results.expenses.length > 5) {
                        html += `<div style="padding: 0.5rem; color: #666; font-size: 0.9rem;">+${results.expenses.length - 5} more</div>`;
                    }
                    html += '</div>';
                    totalResults += results.expenses.length;
                }
                
                if (totalResults === 0) {
                    html = '<div style="padding: 1rem; text-align: center; color: #666;">No results found for "' + query + '"</div>';
                }
                
                container.innerHTML = html;
                container.style.display = 'block';
            }

            async backupAllData() {
                Utils.showSpinner();
                
                try {
                    const backup = {
                        version: '1.0',
                        timestamp: new Date().toISOString(),
                        data: {
                            products: state.allProducts,
                            sales: state.allSales,
                            expenses: state.allExpenses,
                            customers: state.allCustomers,
                            suppliers: state.allSuppliers || [],
                            purchaseOrders: state.allPurchaseOrders || [],
                            liabilities: state.allLiabilities || [],
                            outlets: state.allOutlets || []
                        }
                    };
                    
                    try {
                        const settingsDoc = await getDoc(firebaseService.settingsRef());
                        if (settingsDoc.exists()) {
                            backup.data.settings = settingsDoc.data();
                        }
                    } catch (error) {
                        console.error('Failed to backup settings:', error);
                    }
                    
                    const dataStr = JSON.stringify(backup, null, 2);
                    const blob = new Blob([dataStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `bookkeeping_backup_${new Date().toISOString().split('T')[0]}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                    
                    Utils.showToast('Data backed up successfully', 'success');
                } catch (error) {
                    Utils.showToast('Backup failed: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async restoreFromBackup(file) {
                if (!confirm('This will OVERWRITE all existing data. Are you sure you want to continue?')) {
                    return;
                }
                
                Utils.showSpinner();
                
                try {
                    const reader = new FileReader();
                    
                    reader.onload = async (e) => {
                        try {
                            const backup = JSON.parse(e.target.result);
                            
                            if (!backup.data || !backup.version) {
                                throw new Error('Invalid backup file format');
                            }
                            
                            const batch = writeBatch(db);
                            
                            const collections = ['inventory', 'sales', 'expenses', 'customers', 'suppliers', 'purchase_orders', 'liabilities'];
                            for (const collName of collections) {
                                const snapshot = await getDocs(firebaseService.getUserCollection(collName));
                                snapshot.forEach(doc => {
                                    batch.delete(doc.ref);
                                });
                            }
                            
                            if (backup.data.products) {
                                for (const product of backup.data.products) {
                                    const { id, ...productData } = product;
                                    const docRef = doc(firebaseService.getUserCollection('inventory'), id);
                                    batch.set(docRef, productData);
                                }
                            }
                            
                            if (backup.data.sales) {
                                for (const sale of backup.data.sales) {
                                    const { id, ...saleData } = sale;
                                    const docRef = doc(firebaseService.getUserCollection('sales'), id);
                                    batch.set(docRef, saleData);
                                }
                            }
                            
                            if (backup.data.expenses) {
                                for (const expense of backup.data.expenses) {
                                    const { id, ...expenseData } = expense;
                                    const docRef = doc(firebaseService.getUserCollection('expenses'), id);
                                    batch.set(docRef, expenseData);
                                }
                            }
                            
                            if (backup.data.customers) {
                                for (const customer of backup.data.customers) {
                                    const { id, ...customerData } = customer;
                                    const docRef = doc(firebaseService.getUserCollection('customers'), id);
                                    batch.set(docRef, customerData);
                                }
                            }
                            
                            if (backup.data.suppliers) {
                                for (const item of backup.data.suppliers) {
                                    const { id, ...data } = item;
                                    const docRef = doc(firebaseService.getUserCollection('suppliers'), id);
                                    batch.set(docRef, data);
                                }
                            }
                            
                            if (backup.data.purchaseOrders) {
                                for (const item of backup.data.purchaseOrders) {
                                    const { id, ...data } = item;
                                    const docRef = doc(firebaseService.getUserCollection('purchase_orders'), id);
                                    batch.set(docRef, data);
                                }
                            }
                            
                            if (backup.data.liabilities) {
                                for (const item of backup.data.liabilities) {
                                    const { id, ...data } = item;
                                    const docRef = doc(firebaseService.getUserCollection('liabilities'), id);
                                    batch.set(docRef, data);
                                }
                            }
                            
                            if (backup.data.settings) {
                                batch.set(firebaseService.settingsRef(), backup.data.settings);
                            }
                            
                            await batch.commit();
                            
                            await dataLoader.loadAll();
                            this.markSectionsDirty(['dashboard', 'sales', 'inventory', 'expenses', 'customers', 'analytics']);
                            this._refreshCurrentSectionIfDirty();
                            Utils.showToast('Data restored successfully', 'success');
                            document.getElementById('restore-file-input').value = '';
                        } catch (error) {
                            Utils.showToast('Restore failed: ' + error.message, 'error');
                        } finally {
                            Utils.hideSpinner();
                        }
                    };
                    
                    reader.onerror = () => {
                        Utils.showToast('Failed to read backup file', 'error');
                        Utils.hideSpinner();
                    };
                    
                    reader.readAsText(file);
                } catch (error) {
                    Utils.showToast('Restore failed: ' + error.message, 'error');
                    Utils.hideSpinner();
                }
            }

            async checkLowStockAndNotify() {
                try {
                    const settingsDoc = await getDoc(firebaseService.settingsRef());
                    if (!settingsDoc.exists()) return;

                    const settings = settingsDoc.data();

                    if (!settings.emailNotifications || !settings.notificationEmail) {
                        return;
                    }

                    const lowStockProducts = state.allProducts.filter(p =>
                        p.quantity <= (p.minStock || settings.lowStockThreshold || 10) && p.quantity > 0
                    );

                    const outOfStockProducts = state.allProducts.filter(p => p.quantity === 0);

                    if (lowStockProducts.length === 0 && outOfStockProducts.length === 0) {
                        return;
                    }

                    const allProblem = [...outOfStockProducts, ...lowStockProducts];
                    const BACKEND_URL = window.BACKEND_URL || '';
                    const payload = {
                        products: allProblem.map(p => ({
                            id: p.id,
                            name: p.name,
                            category: p.category || '',
                            quantity: parseFloat(p.quantity) || 0,
                            minStock: parseFloat(p.minStock) || 10,
                            price: parseFloat(p.price) || 0
                        })),
                        recipient: settings.notificationEmail,
                        business_name: settings.name || 'Ultimate Bookkeeping'
                    };

                    await fetch(`${BACKEND_URL}/api/email/stock-alert`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    console.log('Low stock notification sent via backend');
                } catch (error) {
                    console.error('Failed to send low stock notification:', error);
                }
            }

            async sendStockAlertEmail() {
                try {
                    const settingsDoc = await getDoc(firebaseService.settingsRef());
                    if (!settingsDoc.exists()) {
                        Utils.showToast('Please configure notification settings first', 'warning');
                        return;
                    }
                    const settings = settingsDoc.data();
                    if (!settings.notificationEmail) {
                        Utils.showToast('No notification email set — go to Settings', 'warning');
                        return;
                    }

                    const lowStock = state.allProducts.filter(p =>
                        (parseFloat(p.quantity) || 0) <= (parseFloat(p.minStock) || 10) && (parseFloat(p.quantity) || 0) > 0
                    );
                    const outOfStock = state.allProducts.filter(p => (parseFloat(p.quantity) || 0) <= 0);
                    const allProblem = [...outOfStock, ...lowStock];

                    if (allProblem.length === 0) {
                        Utils.showToast('All stock levels are healthy — no alert to send', 'info');
                        return;
                    }

                    Utils.showSpinner();
                    const BACKEND_URL = window.BACKEND_URL || '';
                    const resp = await fetch(`${BACKEND_URL}/api/email/stock-alert`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            products: allProblem.map(p => ({
                                id: p.id,
                                name: p.name,
                                category: p.category || '',
                                quantity: parseFloat(p.quantity) || 0,
                                minStock: parseFloat(p.minStock) || 10,
                                price: parseFloat(p.price) || 0
                            })),
                            recipient: settings.notificationEmail,
                            business_name: settings.name || 'Ultimate Bookkeeping'
                        })
                    });

                    if (resp.ok) {
                        Utils.showToast(`Stock alert emailed to ${settings.notificationEmail}`, 'success');
                    } else {
                        const err = await resp.json().catch(() => ({}));
                        Utils.showToast(err.detail || 'Failed to send stock alert email', 'error');
                    }
                } catch (error) {
                    Utils.showToast('Failed to send: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }
        }

        // ==================== UI TEMPLATE BUILDER ====================
        class TemplateBuilder {
            static buildDashboardSection() {
                return `
                    <section id="dashboard" class="active">
                        <div class="card">
                            <h3><i class="fas fa-filter"></i> Date Filter</h3>
                            <select id="date-filter">
                                <option value="all">All Time</option>
                                <option value="week">Last Week</option>
                                <option value="month">Last Month</option>
                                <option value="quarter">Last Quarter</option>
                                <option value="year">Last Year</option>
                            </select>
                        </div>
                        
                        <div class="dashboard-metrics">
                            <div class="metric">
                                <h3>Total Sales</h3>
                                <p id="total-sales">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3 id="label-id">Total Expenses</h3>
                                <p id="total-expenses">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Net Profit</h3>
                                <p id="net-profit">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Inventory Value</h3>
                                <p id="inventory-value">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Daily Profit</h3>
                                <p id="daily-profit">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Weekly Profit</h3>
                                <p id="weekly-profit">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Monthly Profit</h3>
                                <p id="monthly-profit">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Quarterly Profit</h3>
                                <p id="quarterly-profit">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Yearly Profit</h3>
                                <p id="yearly-profit">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Gross Margin</h3>
                                <p id="gross-margin">0%</p>
                            </div>
                            <div class="metric">
                                <h3>Turnover</h3>
                                <p id="turnover">0x</p>
                            </div>
                            <div class="metric">
                                <h3>Repeat Rate</h3>
                                <p id="repeat-rate">0%</p>
                            </div>
                        </div>

                        ${state.userRole === 'outlet_manager' ? `
                            <div class="metric-card" style="border-left: 4px solid #17a2b8;">
                                <h3 id="outlet-commission">GH₵0.00</h3>
                                <p>Your Commission (${outlet.commissionRate}%)</p>
                            </div>
                            <div class="metric-card" style="border-left: 4px solid #6c757d;">
                                <h3 id="main-shop-share">GH₵0.00</h3>
                                <p>Main Shop Share</p>
                            </div>
                        ` : ''}
                        
                        <div class="widget">
                            <div class="widget-header">
                                <h3><i class="fas fa-clock"></i> Recent Sales (Last 10)</h3>
                                <button onclick="appController.navigateToSection('sales')" style="padding: 0.5rem 1rem; font-size: 0.9rem;">
                                    View All
                                </button>
                            </div>
                            <div id="recent-sales-widget"></div>
                        </div>
                        
                        <!-- ENHANCED WIDGETS (Priority 1, 2, 3) -->
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
                            <div class="card">
                                <h3><i class="fas fa-exclamation-triangle"></i> Stock Alerts</h3>
                                <div id="stock-alerts-widget">
                                    <p class="loading">Loading alerts...</p>
                                </div>
                            </div>
                            
                            <div id="customer-credit-widget">
                                <!-- Customer credit widget rendered here -->
                            </div>
                        </div>
                        
                        <div class="card" style="margin-top: 1rem;">
                            <h3><i class="fas fa-chart-line"></i> Quick Profit View</h3>
                            <div id="profit-quick-view">
                                <p class="loading">Loading profit data...</p>
                            </div>
                            <div style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button onclick="appController.showProfitAnalysis()" style="background: #28a745;">
                                    <i class="fas fa-chart-pie"></i> Full Profit Analysis
                                </button>
                                <button onclick="appController.showPDFExportModal()" style="background: #dc3545;">
                                    <i class="fas fa-file-pdf"></i> Export Reports
                                </button>
                                <button onclick="appController.showBarcodeScanner()" style="background: #667eea;">
                                    <i class="fas fa-barcode"></i> Scan Barcode
                                </button>
                            </div>
                        </div>

                        <div class="widget">
                            <div class="widget-header">
                                <h3><i class="fas fa-chart-pie"></i> Product Performance</h3>
                            </div>
                            <canvas id="product-performance-chart" style="max-height: 300px;"></canvas>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-star"></i> Performance Metrics</h3>
                            <h4>Best-Selling Products</h4>
                            <ul id="best-products" class="metrics-list"></ul>
                            <h4>Top Customers</h4>
                            <ul id="top-customers" class="metrics-list"></ul>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-list"></i> Recent Activity</h3>
                            <div class="table-container">
                            <table id="recent-activity">
                                <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead>
                                <tbody></tbody>
                            </table>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildSalesSection() {
                return `
                    <section id="sales">
                        <div class="card">
                            <button id="export-sales-btn" class="mb-2"><i class="fas fa-download"></i> Export CSV</button>
                            <button id="print-sales-by-date-btn" class="mb-2"><i class="fas fa-print"></i> Print Sales by Date</button>
                            <button id="add-sale-btn" class="mb-2"><i class="fas fa-plus"></i> Add Sale</button>
                            <button id="bulk-sale-btn" class="mb-2" style="background: #28a745;"><i class="fas fa-shopping-basket"></i> Bulk Purchase</button>
                            <button id="invoice-btn" class="mb-2"><i class="fas fa-file-invoice"></i> Generate Invoice</button>
                            <button onclick="appController.showBarcodeScanner()" class="mb-2" style="background: #667eea;"><i class="fas fa-barcode"></i> Scan</button>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-list-alt"></i> Sales Records</h3>
                            <div class="filters">
                                <select id="sales-date-filter">
                                    <option value="all">All Time</option>
                                    <option value="today">Today</option>
                                    <option value="week">This Week</option>
                                    <option value="month">This Month</option>
                                    <option value="year">This Year</option>
                                </select>
                                <input type="text" id="sales-customer-search" placeholder="🔍 Search by Customer">
                                <input type="text" id="sales-product-search-table" placeholder="🔍 Search by Product">
                            </div>
                            <div id="sales-list"></div>
                        </div>
                        
                        <div class="card" style="margin-top: 1rem;">
                            <h3><i class="fas fa-undo"></i> Sales Returns</h3>
                            <p style="color: #666; margin-bottom: 1rem;">Process product returns by clicking <strong>Return</strong> on a sale above.</p>
                            <div id="returns-list">
                                <p class="loading">Click "Return" on a sale to process...</p>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildInventorySection() {
                return `
                    <section id="inventory">
                        <div class="card">
                            <button id="export-inventory-btn" class="mb-2"><i class="fas fa-download"></i> Export CSV</button>
                            <button id="print-all-barcodes-btn" class="mb-2"><i class="fas fa-print"></i> Print All Barcodes</button>
                            <button id="add-product-btn"><i class="fas fa-plus"></i> Add Product</button>
                            <button id="send-stock-alert-btn" class="mb-2" style="background:#dc3545;" onclick="window.appController?.sendStockAlertEmail()"><i class="fas fa-envelope-exclamation"></i> Email Stock Alert</button>
                        </div>
                        <div class="card">
                            <h3><i class="fas fa-boxes"></i> Inventory Management</h3>
                            <div class="filters">
                                <input type="text" id="inventory-search" placeholder="🔍 Search Products">
                                <select id="inventory-category-filter">
                                    <option value="">All Categories</option>
                                    <option value="Braid">Braid</option>
                                    <option value="Weave">Weave</option>
                                    <option value="Loc">Loc</option>
                                    <option value="Pony">Pony</option>
                                    <option value="Twist">Twist</option>
                                    <option value="WigCap">WigCap</option>
                                    <option value="Yarn">Yarn</option>
                                    <option value="Other">Other</option>
                                </select>
                                <select id="inventory-stock-filter">
                                    <option value="">All Items</option>
                                    <option value="in-stock">In Stock</option>
                                    <option value="low-stock">Low Stock</option>
                                    <option value="out-of-stock">Out of Stock</option>
                                </select>
                            </div>
                           <div class="items-per-page">
                                <label>Items per page:</label>
                                <select id="inventory-items-per-page">
                                    <option value="10">10</option>
                                    <option value="25">25</option>
                                    <option value="50">50</option>
                                    <option value="100">100</option>
                                </select>
                            </div>

                            <div class="table-container">
                            <table id="inventory-table">
                                <thead>
                                    <tr>
                                        <th>Product</th>
                                        <th>Category</th>
                                        <th>Cost</th>
                                        <th>Price</th>
                                        <th>Stock</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                            </div>

                            <div id="inventory-pagination" class="pagination"></div>
                        </div>
                    </section>
                `;
            }

            static buildSuppliersSection() {
                return `
                    <section id="suppliers" style="display:none;">
                        <div class="card">
                            <button id="add-supplier-btn" class="btn"><i class="fas fa-plus"></i> Add Supplier</button>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-truck-loading"></i> Suppliers Directory</h3>
                            
                            <div class="dashboard-metrics">
                                <div class="metric">
                                    <h4>Total Suppliers</h4>
                                    <p id="total-suppliers-count">0</p>
                                </div>
                                <div class="metric">
                                    <h4>Active Suppliers</h4>
                                    <p id="active-suppliers-count">0</p>
                                </div>
                                <div class="metric">
                                    <h4>Outstanding Balance</h4>
                                    <p id="suppliers-outstanding-balance">₵0.00</p>
                                </div>
                            </div>

                            <div style="margin: 0.5rem 0 1rem 0; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button id="export-supplier-payments-csv-btn" class="btn" style="background: #28a745;">
                                    <i class="fas fa-file-csv"></i> Export Supplier Payments (CSV)
                                </button>
                                <button id="export-supplier-payments-pdf-btn" class="btn" style="background: #dc3545;">
                                    <i class="fas fa-file-pdf"></i> Export Supplier Payments (PDF)
                                </button>
                            </div>
                            
                            <div class="filters" style="display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap;">
                                <select id="supplier-status-filter" style="padding: 0.5rem;">
                                    <option value="">All Status</option>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                                <input type="text" id="supplier-search" placeholder="🔍 Search suppliers..." style="padding: 0.5rem; flex: 1; min-width: 200px;">
                            </div>
                            
                            <div class="table-container">
                                <table id="suppliers-table">
                                    <thead>
                                        <tr>
                                            <th>Supplier Name</th>
                                            <th>Phone</th>
                                            <th>Email</th>
                                            <th>Payment Terms</th>
                                            <th>Outstanding</th>
                                            <th>Status</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td colspan="7" style="text-align:center; padding: 2rem; color: #666;">
                                                Loading suppliers...
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildPurchaseOrdersSection() {
                return `
                    <section id="purchase-orders" style="display:none;">
                        <div class="card">
                            <button id="add-po-btn" class="btn"><i class="fas fa-plus"></i> Create Purchase Order</button>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-file-invoice"></i> Purchase Orders</h3>
                            
                            <div class="dashboard-metrics">
                                <div class="metric">
                                    <h4>Total POs</h4>
                                    <p id="total-pos-count">0</p>
                                </div>
                                <div class="metric">
                                    <h4>Pending POs</h4>
                                    <p id="pending-pos-count">0</p>
                                </div>
                                <div class="metric">
                                    <h4>Pending Value</h4>
                                    <p id="pending-pos-value">₵0.00</p>
                                </div>
                            </div>
                            
                            <div class="filters" style="display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap;">
                                <select id="po-status-filter" style="padding: 0.5rem;">
                                    <option value="">All Status</option>
                                    <option value="pending">Pending</option>
                                    <option value="received">Received</option>
                                    <option value="cancelled">Cancelled</option>
                                </select>
                                <input type="text" id="po-search" placeholder="🔍 Search PO number..." style="padding: 0.5rem; flex: 1; min-width: 200px;">
                            </div>
                            
                            <div class="table-container">
                                <table id="purchase-orders-table">
                                    <thead>
                                        <tr>
                                            <th>PO Number</th>
                                            <th>Supplier</th>
                                            <th>Order Date</th>
                                            <th>Total Amount</th>
                                            <th>Status</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td colspan="6" style="text-align:center; padding: 2rem; color: #666;">
                                                Loading purchase orders...
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildAnalyticsSection() {
                return `
                    <section id="analytics">
                        <div class="card">
                            <h2><i class="fas fa-chart-line"></i> Analytics Dashboard</h2>
                        </div>
                        
                        <!-- Date Range Selector -->
                        <div class="date-range-selector">
                            <div class="date-range-presets">
                                <button class="preset-btn" data-range="today">Today</button>
                                <button class="preset-btn" data-range="7days">7 Days</button>
                                <button class="preset-btn active" data-range="30days">30 Days</button>
                                <button class="preset-btn" data-range="90days">90 Days</button>
                                <button class="preset-btn" data-range="6months">6 Months</button>
                                <button class="preset-btn" data-range="1year">1 Year</button>
                                <button class="preset-btn" data-range="custom">Custom</button>
                            </div>
                            
                            <div class="custom-date-range" style="display: none;">
                                <label>From:</label>
                                <input type="date" id="date-range-start">
                                <label>To:</label>
                                <input type="date" id="date-range-end">
                                <button id="apply-custom-range"><i class="fas fa-check"></i> Apply</button>
                            </div>
                            
                            <div class="comparison-toggle">
                                <label>
                                    <input type="checkbox" id="compare-previous">
                                    Compare to previous period
                                </label>
                            </div>
                            
                            <div class="date-range-display">
                                <i class="fas fa-calendar-alt"></i>
                                <span id="current-range-display">Last 30 Days</span>
                            </div>
                        </div>
                        
                        <div class="analytics-grid">
                            <div class="analytics-card">
                                <h3>Daily Revenue Trend</h3>
                                <canvas id="daily-revenue-chart"></canvas>
                            </div>
                            <div class="analytics-card">
                                <h3>Profit Analysis</h3>
                                <canvas id="profit-analysis-chart"></canvas>
                            </div>
                            <div class="analytics-card">
                                <h3>Top Categories</h3>
                                <canvas id="top-categories-chart"></canvas>
                            </div>
                            <div class="analytics-card">
                                <h3>Monthly Comparison</h3>
                                <canvas id="monthly-comparison-chart"></canvas>
                            </div>
                            <div class="analytics-card">
                                <h3>Operating Expenses Breakdown</h3>
                                <canvas id="expenses-breakdown-chart"></canvas>
                            </div>
                
                            
                        </div>
                    </section>
                `;
            }

            static buildExpensesSection() {
                return `
                    <section id="expenses">
                        <div class="card">
                            <button id="add-expense-btn" class="mb-2"><i class="fas fa-plus"></i> Add Expense</button>
                            <button id="export-expenses-btn" class="mb-2"><i class="fas fa-download"></i> Export CSV</button>
                            <button onclick="recurringExpenses.renderAddModal()" class="mb-2" style="background: #17a2b8;"><i class="fas fa-sync"></i> Add Recurring</button>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-credit-card"></i> Expense Records</h3>
                            <div class="filters">
                                <select id="expense-date-filter">
                                    <option value="all">All Time</option>
                                    <option value="today">Today</option>
                                    <option value="week">This Week</option>
                                    <option value="month">This Month</option>
                                    <option value="year">This Year</option>
                                </select>
                                <input type="text" id="expense-search" placeholder="🔍 Search expenses">
                            </div>
                            <div class="table-container">
                            <table id="expenses-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Description</th>
                                        <th>Category</th>
                                        <th>Amount</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                            </div>
                        </div>
                        
                        <div class="card" style="margin-top: 1rem;">
                            <div id="recurring-expenses-container">
                                <!-- Recurring expenses table renders here -->
                            </div>
                        </div>
                    </section>
                `;
            }
            static buildAccountingSection() {
                return `
                    <section id="accounting">
                        <div class="card">
                            <h2><i class="fas fa-calculator"></i> Accounting & Reports</h2>
                        </div>
                        
                        <div class="dashboard-metrics">
                            <div class="metric">
                                <h3>Assets</h3>
                                <p id="total-assets">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Liabilities</h3>
                                <p id="total-liabilities">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Equity</h3>
                                <p id="total-equity">₵0.00</p>
                            </div>
                            <div class="metric">
                                <h3>Cash Flow</h3>
                                <p id="cash-flow">₵0.00</p>
                            </div>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-file-alt"></i> Financial Reports</h3>
                            <button id="generate-income-statement"><i class="fas fa-chart-bar"></i> Income Statement</button>
                            <button id="generate-balance-sheet" class="ml-2"><i class="fas fa-balance-scale"></i> Balance Sheet</button>
                            <button id="generate-cashflow-statement" class="ml-2"><i class="fas fa-money-bill-wave"></i> Cash Flow</button>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-receipt"></i> Tax Summary</h3>
                            <div id="tax-summary">
                                <p>Total Tax Collected: <strong id="tax-collected">₵0.00</strong></p>
                                <p>Tax Payable: <strong id="tax-payable">₵0.00</strong></p>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildLiabilitiesSection() {
                return `
                    <section id="liabilities">
                        <div class="card">
                            <button id="add-liability-btn"><i class="fas fa-plus"></i> Add Liability</button>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-file-invoice-dollar"></i> Liabilities Management</h3>
                            
                            <!-- Summary Cards -->
                            <div class="liabilities-summary">
                                <div class="summary-card">
                                    <h4>Total Liabilities</h4>
                                    <p id="total-liabilities-amount">₵0.00</p>
                                </div>
                                <div class="summary-card">
                                    <h4>Current (Due < 30 days)</h4>
                                    <p id="current-liabilities">₵0.00</p>
                                </div>
                                <div class="summary-card">
                                    <h4>Overdue</h4>
                                    <p id="overdue-liabilities" class="text-danger">₵0.00</p>
                                </div>
                            </div>
                            
                            <!-- Filters -->
                            <div class="filters">
                                <select id="liability-type-filter">
                                    <option value="">All Types</option>
                                    <option value="accounts_payable">Accounts Payable</option>
                                    <option value="loan">Loans</option>
                                    <option value="credit_card">Credit Cards</option>
                                    <option value="other">Other</option>
                                </select>
                                
                                <select id="liability-status-filter">
                                    <option value="">All Status</option>
                                    <option value="active">Active</option>
                                    <option value="paid">Paid</option>
                                    <option value="overdue">Overdue</option>
                                </select>
                                
                                <input type="text" id="liability-search" placeholder="🔍 Search...">
                            </div>
                            
                            <div class="table-container">
                            <table id="liabilities-table">
                                <thead>
                                    <tr>
                                        <th>Creditor</th>
                                        <th>Type</th>
                                        <th>Description</th>
                                        <th>Balance</th>
                                        <th>Due Date</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildForecastingSection() {
                return `
                    <section id="forecasting">
                        <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
                            <h2 style="margin:0;"><i class="fas fa-chart-line"></i> Sales Forecasting & Predictive Analytics</h2>
                            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                                <select id="forecast-period-select" style="padding:0.5rem;border-radius:6px;border:1px solid #ddd;">
                                    <option value="7">Next 7 Days</option>
                                    <option value="14">Next 14 Days</option>
                                    <option value="30" selected>Next 30 Days</option>
                                    <option value="60">Next 60 Days</option>
                                    <option value="90">Next 90 Days</option>
                                </select>
                                <button id="refresh-forecast-btn" style="padding:0.5rem 1rem;border-radius:6px;background:#007bff;color:white;border:none;cursor:pointer;">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                        </div>

                        <div id="forecast-kpi-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem;">
                            <div class="forecast-card" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:1.5rem;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
                                <div style="font-size:0.85rem;opacity:0.9;">Predicted Daily Average</div>
                                <div id="fc-daily-avg" style="font-size:1.75rem;font-weight:bold;margin:0.5rem 0;">₵0.00</div>
                                <div id="fc-trend-badge" style="display:inline-block;padding:0.2rem 0.6rem;border-radius:12px;font-size:0.75rem;background:rgba(255,255,255,0.2);">—</div>
                            </div>
                            <div class="forecast-card" style="background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:white;padding:1.5rem;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
                                <div style="font-size:0.85rem;opacity:0.9;">Period Total Forecast</div>
                                <div id="fc-period-total" style="font-size:1.75rem;font-weight:bold;margin:0.5rem 0;">₵0.00</div>
                                <div id="fc-confidence" style="font-size:0.8rem;opacity:0.9;">Confidence: —</div>
                            </div>
                            <div class="forecast-card" style="background:linear-gradient(135deg,#43e97b 0%,#38f9d7 100%);color:#1a1a2e;padding:1.5rem;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
                                <div style="font-size:0.85rem;opacity:0.8;">Strongest Day</div>
                                <div id="fc-best-day" style="font-size:1.75rem;font-weight:bold;margin:0.5rem 0;">—</div>
                                <div id="fc-best-day-mult" style="font-size:0.8rem;opacity:0.8;">—</div>
                            </div>
                            <div class="forecast-card" style="background:linear-gradient(135deg,#fa709a 0%,#fee140 100%);color:#1a1a2e;padding:1.5rem;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
                                <div style="font-size:0.85rem;opacity:0.8;">Data Points</div>
                                <div id="fc-data-points" style="font-size:1.75rem;font-weight:bold;margin:0.5rem 0;">0</div>
                                <div id="fc-data-quality" style="font-size:0.8rem;opacity:0.8;">—</div>
                            </div>
                        </div>

                        <div id="fc-ai-summary" style="display:none;background:#1a1a2e;border:1px solid #2a2a4a;border-radius:8px;padding:1.25rem;margin-bottom:1.5rem;color:#e1e8ed;">
                            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;">
                                <i class="fas fa-robot" style="color:#007bff;"></i>
                                <strong style="color:#fff;">AI Analysis</strong>
                            </div>
                            <p id="fc-ai-summary-text" style="margin:0;line-height:1.6;font-size:0.95rem;"></p>
                        </div>

                        <div class="card">
                            <h3><i class="fas fa-chart-area"></i> Revenue Forecast with Confidence Interval</h3>
                            <canvas id="forecast-trend-chart" style="max-height:400px;"></canvas>
                        </div>

                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;">
                            <div class="card">
                                <h3><i class="fas fa-calendar-week"></i> Weekly Sales Pattern</h3>
                                <canvas id="weekly-pattern-chart" style="max-height:300px;"></canvas>
                            </div>
                            <div class="card">
                                <h3><i class="fas fa-chart-bar"></i> Monthly Revenue History</h3>
                                <canvas id="monthly-history-chart" style="max-height:300px;"></canvas>
                            </div>
                        </div>

                        <div class="card">
                            <h3><i class="fas fa-boxes"></i> Product Demand Forecast</h3>
                            <div id="product-forecast-table" style="overflow-x:auto;">
                                <p style="color:#888;text-align:center;padding:2rem;">Loading product forecasts...</p>
                            </div>
                        </div>

                        <div class="card" style="margin-bottom:1.5rem;">
                            <h3><i class="fas fa-lightbulb"></i> Forecast Factors</h3>
                            <div id="forecast-factors" style="display:flex;flex-wrap:wrap;gap:0.75rem;"></div>
                        </div>

                        <div class="card">
                            <h3><i class="fas fa-exclamation-triangle"></i> Inventory Alerts</h3>
                            <div id="inventory-alerts"></div>
                        </div>
                    </section>
                `;
            }

            static buildCustomersSection() {
                return `
                    <section id="customers">
                        <div class="card">
                            <button id="add-customer-btn" class="mb-2"><i class="fas fa-user-plus"></i> Add Customer</button>
                            <button id="export-customers-btn" class="mb-2"><i class="fas fa-download"></i> Export CSV</button>
                        </div>
                        
                        <!-- Customer Credit Summary Widget -->
                        <div class="card" style="margin-bottom: 1rem;">
                            <h3><i class="fas fa-hand-holding-usd"></i> Customer Credit Summary</h3>
                            <div id="customer-credit-summary">
                                <!-- Credit summary renders here -->
                            </div>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-users"></i> Customer Database</h3>
                            <div class="filters">
                                <input type="text" id="customer-search" placeholder="🔍 Search customers">
                                <select id="customer-balance-filter" style="margin-left: 0.5rem;">
                                    <option value="all">All Customers</option>
                                    <option value="with-balance">With Balance Due</option>
                                    <option value="with-credit">With Store Credit</option>
                                </select>
                            </div>
                            <div class="table-container">
                            <table id="customers-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Email</th>
                                        <th>Phone</th>
                                        <th>Total Purchases</th>
                                        <th>Balance</th>
                                        <th>Last Purchase</th>
                                        <th>Actions</th>
                                        </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildOutletsSection() {
                return `
                    <section id="outlets">
                        <div class="card">
                            <h2><i class="fas fa-store"></i> Outlets Management</h2>
                            <button id="add-outlet-btn" class="mb-2"><i class="fas fa-plus"></i> Add New Outlet</button>
                            <button onclick="stockTransfer.renderTransferModal()" class="mb-2" style="background: #17a2b8;"><i class="fas fa-exchange-alt"></i> Stock Transfer</button>
                        </div>
                        
                        <div id="outlets-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
                            <!-- Outlet cards will be rendered here -->
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-list"></i> All Outlets</h3>
                            <div class="table-container">
                            <table id="outlets-table">
                                <thead>
                                    <tr>
                                        <th>Outlet Name</th>
                                        <th>Location</th>
                                        <th>Manager</th>
                                        <th>Phone</th>
                                        <th>Stock Value</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                            </div>
                        </div>
                        
                        <div class="card" style="margin-top: 1rem;">
                            <h3><i class="fas fa-exchange-alt"></i> Stock Transfers</h3>
                            <div id="stock-transfers-container">
                                <!-- Stock transfers table renders here -->
                            </div>
                        </div>
                    </section>
                `;
            }
            
            static buildConsignmentsSection() {
                return `
                    <section id="consignments">
                        <div class="card">
                            <h2><i class="fas fa-truck"></i> <span id="consignments-header-text">Consignments</span></h2>
                            <div id="consignments-info-banner" style="display: none; background: #d1ecf1; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; border-left: 4px solid #17a2b8;">
                                <h4 style="margin: 0 0 0.5rem 0; color: #0c5460;">
                                    <i class="fas fa-info-circle"></i> Receive Consignments
                                </h4>
                                <p style="margin: 0; color: #0c5460; font-size: 0.9rem;">
                                    Inventory sent to your outlet appears here. Click <strong>"Confirm Receipt"</strong> on pending consignments to add items to your inventory.
                                </p>
                            </div>
                            <button id="send-consignment-btn" class="mb-2"><i class="fas fa-paper-plane"></i> Send Consignment</button>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-filter"></i> Filter</h3>
                            <div class="filters">
                                <select id="consignment-outlet-filter">
                                    <option value="">All Outlets</option>
                                </select>
                                <select id="consignment-status-filter">
                                    <option value="">All Status</option>
                                    <option value="pending">Pending</option>
                                    <option value="confirmed">Confirmed</option>
                                </select>
                            </div>
                        </div>
                        
                        <div id="consignments-list">
                            <!-- Consignments will be rendered here -->
                        </div>
                    </section>
                `;
            }
            
            static buildSettlementsSection() {
                return `
                    <section id="settlements">
                        <div class="card">
                            <h2><i class="fas fa-file-invoice-dollar"></i> Monthly Settlements</h2>
                            <button id="generate-settlement-btn" class="mb-2"><i class="fas fa-calculator"></i> Generate Settlement</button>
                            <button id="record-payment-btn" class="mb-2" style="background: #28a745;"><i class="fas fa-money-bill-wave"></i> Record Payment</button>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-filter"></i> Filter</h3>
                            <div class="filters">
                                <select id="settlement-outlet-filter">
                                    <option value="">All Outlets</option>
                                </select>
                                <select id="settlement-period-filter">
                                    <option value="">All Periods</option>
                                </select>
                                <select id="settlement-status-filter">
                                    <option value="">All Status</option>
                                    <option value="pending">Pending</option>
                                    <option value="partial">Partial</option>
                                    <option value="paid">Paid</option>
                                </select>
                            </div>
                        </div>
                        
                        <div id="settlements-summary" class="dashboard-metrics" style="margin-bottom: 2rem;">
                            <!-- Summary metrics -->
                        </div>
                        
                        <div id="settlements-list">
                            <!-- Settlements will be rendered here -->
                        </div>
                    </section>
                `;
            }

            static buildSettingsSection() {
                return `
                    <section id="settings">
                        <div class="card">
                            <h2><i class="fas fa-cog"></i> Business Settings</h2>
                            <form id="settings-form">
                                <label>Business Name</label>
                                <input type="text" id="business-name" placeholder="My Business" required>
                                
                                <label>Default Tax Rate (%)</label>
                                <input type="number" id="default-tax" step="0.1" value="0" min="0">
                                
                                <label>Currency</label>
                                <select id="currency-select">
                                    <option value="GHS (₵)">GHS (₵)</option>
                                    <option value="USD ($)">USD ($)</option>
                                    <option value="EUR (€)">EUR (€)</option>
                                    <option value="GBP (£)">GBP (£)</option>
                                </select>
                                
                                <label>App Theme</label>
                                <select id="theme-select">
                                    <option value="classic">Classic</option>
                                    <option value="modern">Modern</option>
                                    <option value="corporate">Corporate</option>
                                    <option value="minimal">Minimal</option>
                                    <option value="ocean">Ocean</option>
                                    <option value="forest">Forest</option>
                                    <option value="sunset">Sunset</option>
                                    <option value="dark">Dark</option>
                                </select>
                                
                                <label>Low Stock Alert Threshold</label>
                                <input type="number" id="low-stock-threshold" value="10" min="0">
                                
                                <button type="submit"><i class="fas fa-save"></i> Save Settings</button>
                            </form>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-bell"></i> Notification Settings</h3>
                            <label><input type="checkbox" id="email-notifications"> Email notifications for low stock</label><br>
                            <label><input type="checkbox" id="daily-reports"> Daily sales reports</label><br>
                            <input type="email" id="notification-email" placeholder="Email address">
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-database"></i> Data Management</h3>
                            <p style="color: #666; margin-bottom: 1rem;">
                                Backup your business data or restore from a previous backup.
                            </p>
                            
                            <button id="backup-data-btn" style="margin-right: 1rem;">
                                <i class="fas fa-download"></i> Backup All Data
                            </button>
                            
                            <button id="restore-data-btn" style="background: #ffc107;">
                                <i class="fas fa-upload"></i> Restore from Backup
                            </button>
                            
                            <input type="file" id="restore-file-input" accept=".json" style="display: none;">
                            
                            <div style="margin-top: 1rem; padding: 1rem; background: #fff3cd; border-radius: 4px;">
                                <p style="margin: 0; color: #856404;">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <strong>Warning:</strong> Restoring data will overwrite all existing data. 
                                    Make sure to backup your current data first.
                                </p>
                            </div>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-history"></i> Activity Log</h3>
                            <p style="color: #666; margin-bottom: 1rem;">
                                Recent system activities and changes
                            </p>
                            
                            <div class="table-container" style="max-height: 400px; overflow: auto;">
                                <table id="activity-log-table">
                                    <thead>
                                        <tr>
                                            <th>Timestamp</th>
                                            <th>Action</th>
                                            <th>Details</th>
                                        </tr>
                                    </thead>
                                    <tbody></tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildUserManagementSection() {
                return `
                    <section id="user-management">
                        <div class="card">
                            <h2><i class="fas fa-users-cog"></i> User Management</h2>
                            <p style="color: #666; margin-bottom: 1rem;">Manage user accounts and assign roles to outlet managers.</p>
                            
                            <div style="background: #e7f3ff; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; border-left: 4px solid #007bff;">
                                <h4 style="margin: 0 0 0.5rem 0; color: #004085;">
                                    <i class="fas fa-info-circle"></i> How User Management Works
                                </h4>
                                <ul style="margin: 0; padding-left: 1.5rem; color: #004085; font-size: 0.9rem;">
                                    <li>You (admin) have full access to all features</li>
                                    <li>Create outlet manager accounts and assign them to specific outlets</li>
                                    <li>Outlet managers can only manage their assigned outlet (sales, inventory, consignments)</li>
                                    <li>Outlet managers cannot access admin features (user management, expenses, settings)</li>
                                </ul>
                            </div>
                            
                            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button id="create-outlet-manager-btn" class="mb-2">
                                    <i class="fas fa-user-plus"></i> Create Outlet Manager Account
                                </button>
                                <button id="refresh-users-btn" class="mb-2" style="background: #17a2b8;">
                                    <i class="fas fa-sync"></i> Refresh Users
                                </button>
                            </div>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-list"></i> All Users</h3>
                            <div class="table-container">
                            <table id="users-table">
                                <thead>
                                    <tr>
                                        <th>Email</th>
                                        <th>Role</th>
                                        <th>Assigned Outlet</th>
                                        <th>Created</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td colspan="6" class="no-data">
                                            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #007bff;"></i>
                                            <p>Loading users...</p>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildLoanSection() {
                return `
                    <section id="loans">
                        <div class="card">
                            <h2><i class="fas fa-hand-holding-usd"></i> Loan Calculator</h2>
                            <form id="loan-form">
                                <label>Loan Amount (₵)</label>
                                <input type="number" id="loan-amount" step="0.01" required>
                                
                                <label>Interest Rate (% per year)</label>
                                <input type="number" id="loan-rate" step="0.1" required>
                                
                                <label>Loan Term (months)</label>
                                <input type="number" id="loan-term" required>
                                
                                <button type="button" id="calculate-loan"><i class="fas fa-calculator"></i> Calculate</button>
                            </form>
                            
                            <div id="loan-results" style="display: none; margin-top: 1rem;">
                                <h4>Loan Summary</h4>
                                <p>Monthly Payment: <strong id="monthly-payment">₵0.00</strong></p>
                                <p>Total Interest: <strong id="total-interest">₵0.00</strong></p>
                                <p>Total Repayment: <strong id="total-repayment">₵0.00</strong></p>
                            </div>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-tags"></i> Pricing Calculator</h3>
                            <form id="pricing-form">
                                <label>Cost Price (₵)</label>
                                <input type="number" id="cost-price" step="0.01" required>
                                
                                <label>Desired Profit Margin (%)</label>
                                <input type="number" id="profit-margin" step="0.1" required>
                                
                                <label>Tax Rate (%)</label>
                                <input type="number" id="pricing-tax" step="0.1" value="0">
                                
                                <button type="button" id="calculate-price"><i class="fas fa-calculator"></i> Calculate Price</button>
                            </form>
                            
                            <div id="pricing-results" style="display: none; margin-top: 1rem;">
                                <h4>Recommended Pricing</h4>
                                <p>Selling Price (before tax): <strong id="selling-price">₵0.00</strong></p>
                                <p>Selling Price (with tax): <strong id="selling-price-tax">₵0.00</strong></p>
                                <p>Profit per Unit: <strong id="profit-per-unit">₵0.00</strong></p>
                            </div>
                        </div>
                    </section>
                `;
            }

            static buildReportsSection() {
                return `
                    <section id="reports" style="display:none;">
                        <div class="card">
                            <h3><i class="fas fa-file-alt"></i> Report Center</h3>
                            <p style="color:#8899a6;margin-bottom:1rem;">Generate, preview and download professional reports. All amounts in Ghana Cedi (GHS).</p>

                            <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:0.75rem;align-items:end;margin-bottom:1.5rem;" class="reports-date-row">
                                <div>
                                    <label style="font-size:0.85rem;">Start Date</label>
                                    <input type="date" id="reports-start-date">
                                </div>
                                <div>
                                    <label style="font-size:0.85rem;">End Date</label>
                                    <input type="date" id="reports-end-date">
                                </div>
                                <div>
                                    <select id="reports-quick-period" style="min-width:130px;">
                                        <option value="">Quick select...</option>
                                        <option value="today">Today</option>
                                        <option value="week">This Week</option>
                                        <option value="month">This Month</option>
                                        <option value="quarter">This Quarter</option>
                                        <option value="year">This Year</option>
                                        <option value="all">All Time</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <!-- Financial Reports -->
                        <div class="card">
                            <h3 style="margin-bottom:1rem;"><i class="fas fa-balance-scale" style="color:#007bff;"></i> Financial Reports</h3>
                            <div class="reports-grid" id="reports-financial-grid">
                                <div class="report-card" data-report="financial">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#007bff,#0056b3);"><i class="fas fa-file-invoice-dollar"></i></div>
                                    <div class="report-info">
                                        <h4>Financial Statement</h4>
                                        <p>Income statement with revenue, COGS, expenses, and net profit</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('financial','pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                                        <button onclick="appController.generateReport('financial','csv')" title="CSV"><i class="fas fa-file-csv"></i></button>
                                    </div>
                                </div>
                                <div class="report-card" data-report="pnl">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#28a745,#1e7e34);"><i class="fas fa-chart-bar"></i></div>
                                    <div class="report-info">
                                        <h4>Profit & Loss</h4>
                                        <p>Revenue, cost of goods sold, gross margin, operating expenses</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('pnl','pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                                    </div>
                                </div>
                                <div class="report-card" data-report="cashflow">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#17a2b8,#117a8b);"><i class="fas fa-money-bill-wave"></i></div>
                                    <div class="report-info">
                                        <h4>Cash Flow Statement</h4>
                                        <p>Operating, investing, and financing cash flows with monthly breakdown</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('cashflow','pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                                    </div>
                                </div>
                                <div class="report-card" data-report="tax">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#ffc107,#d39e00);"><i class="fas fa-percentage"></i></div>
                                    <div class="report-info">
                                        <h4>Tax / VAT Summary</h4>
                                        <p>Output tax collected, input tax on expenses, net payable, rate breakdown</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('tax','pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Sales & Inventory Reports -->
                        <div class="card">
                            <h3 style="margin-bottom:1rem;"><i class="fas fa-shopping-cart" style="color:#28a745;"></i> Sales & Inventory</h3>
                            <div class="reports-grid">
                                <div class="report-card" data-report="sales">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#007bff,#0056b3);"><i class="fas fa-chart-line"></i></div>
                                    <div class="report-info">
                                        <h4>Sales Report</h4>
                                        <p>All transactions with product, customer, quantity, and totals</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('sales','pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                                        <button onclick="appController.generateReport('sales','csv')" title="CSV"><i class="fas fa-file-csv"></i></button>
                                        <button onclick="appController.generateReport('sales','excel')" title="Excel"><i class="fas fa-file-excel"></i></button>
                                    </div>
                                </div>
                                <div class="report-card" data-report="inventory">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#28a745,#1e7e34);"><i class="fas fa-boxes"></i></div>
                                    <div class="report-info">
                                        <h4>Inventory Report</h4>
                                        <p>Current stock levels, cost and retail values by product</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('inventory','pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                                        <button onclick="appController.generateReport('inventory','csv')" title="CSV"><i class="fas fa-file-csv"></i></button>
                                    </div>
                                </div>
                                <div class="report-card" data-report="expenses">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#dc3545,#bd2130);"><i class="fas fa-credit-card"></i></div>
                                    <div class="report-info">
                                        <h4>Expenses Report</h4>
                                        <p>Operating expenses by category with detailed transaction list</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('expenses','pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                                        <button onclick="appController.generateReport('expenses','csv')" title="CSV"><i class="fas fa-file-csv"></i></button>
                                    </div>
                                </div>
                                <div class="report-card" data-report="stock-valuation">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#6f42c1,#563d7c);"><i class="fas fa-warehouse"></i></div>
                                    <div class="report-info">
                                        <h4>Stock Valuation</h4>
                                        <p>Category breakdown, cost vs. retail values, stock status alerts</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('stock-valuation','pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Receivables & Customer Reports -->
                        <div class="card">
                            <h3 style="margin-bottom:1rem;"><i class="fas fa-users" style="color:#dc3545;"></i> Receivables & Customers</h3>
                            <div class="reports-grid">
                                <div class="report-card" data-report="ar-aging">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#dc3545,#bd2130);"><i class="fas fa-user-clock"></i></div>
                                    <div class="report-info">
                                        <h4>AR Aging Report</h4>
                                        <p>Outstanding balances by aging bucket (current, 30, 60, 90+ days)</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('ar-aging','pdf')" title="PDF"><i class="fas fa-file-pdf"></i></button>
                                    </div>
                                </div>
                                <div class="report-card" data-report="customers">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#17a2b8,#117a8b);"><i class="fas fa-address-book"></i></div>
                                    <div class="report-info">
                                        <h4>Customer List</h4>
                                        <p>All customers with contact info, total purchases, and last activity</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('customers','csv')" title="CSV"><i class="fas fa-file-csv"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Comprehensive Report -->
                        <div class="card">
                            <h3 style="margin-bottom:1rem;"><i class="fas fa-layer-group" style="color:#6f42c1;"></i> Comprehensive</h3>
                            <div class="reports-grid">
                                <div class="report-card" data-report="comprehensive">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#6f42c1,#563d7c);"><i class="fas fa-file-excel"></i></div>
                                    <div class="report-info">
                                        <h4>Comprehensive Report (Excel)</h4>
                                        <p>Multi-sheet workbook with Sales, Expenses, Inventory, and Summary</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('comprehensive','excel')" title="Excel"><i class="fas fa-file-excel"></i></button>
                                    </div>
                                </div>
                                <div class="report-card" data-report="period-comparison">
                                    <div class="report-icon" style="background:linear-gradient(135deg,#fd7e14,#dc6502);"><i class="fas fa-exchange-alt"></i></div>
                                    <div class="report-info">
                                        <h4>Period Comparison</h4>
                                        <p>Compare current period vs. previous equivalent (revenue, expenses, profit)</p>
                                    </div>
                                    <div class="report-actions">
                                        <button onclick="appController.generateReport('period-comparison','view')" title="View"><i class="fas fa-eye"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Period Comparison Results -->
                        <div class="card" id="period-comparison-results" style="display:none;">
                            <h3><i class="fas fa-exchange-alt"></i> Period Comparison</h3>
                            <div id="period-comparison-content"></div>
                        </div>
                    </section>
                `;
            }

            static buildPOSEmbeddedSection() {
                // Embedded POS uses the existing module-based POS (`js/pos/*`).
                // POS modules rely on specific DOM IDs; keep these stable.
                return `
                    <div id="pos-modal" class="pos-modal" role="dialog" aria-modal="true" aria-hidden="true">
                        <div id="pos-embedded-root">
                            <div class="pos-header">
                                <div class="pos-header-left">
                                    <button
                                        type="button"
                                        id="pos-close-btn"
                                        class="pos-close-btn"
                                        onclick="window.appController && window.appController.closePOSModal && window.appController.closePOSModal()"
                                    >
                                        <i class="fas fa-times"></i> Close
                                    </button>
                                    <span class="pos-header-title">
                                        <i class="fas fa-cash-register"></i> Point of Sale
                                    </span>
                                </div>
                                <div class="pos-header-right">
                                    <span id="user-email" class="pos-user-email">POS Mode</span>
                                    <button id="dark-mode-toggle" class="pos-dark-toggle" type="button" aria-label="Toggle POS theme">
                                        <i class="fas fa-moon"></i> Dark Mode
                                    </button>
                                </div>
                            </div>

                            <div class="pos-container">
                                <div class="pos-left-panel">
                                    <div class="quick-products-section">
                                        <h3><i class="fas fa-boxes"></i> Products</h3>
                                        <div class="pos-search-container">
                                            <input type="text" id="product-search" class="pos-search-input" placeholder="Search products..." />
                                            <input type="text" id="barcode-scan" class="pos-barcode-input" placeholder="Scan Barcode..." />
                                            <button id="open-scanner-btn" class="btn btn-inventory" type="button">
                                                <i class="fas fa-qrcode"></i> Scan with Camera
                                            </button>
                                        </div>
                                        <div id="product-list" class="pos-product-list"></div>
                                    </div>
                                </div>

                                <div class="pos-right-panel">
                                    <h2><i class="fas fa-shopping-cart"></i> Shopping Cart</h2>
                                    <div class="cart" id="cart">
                                        <p>Your cart is empty.</p>
                                    </div>
                                    <div class="total total-display">Total: ₵0.00</div>

                                    <div class="action-buttons">
                                        <button class="btn btn-clear" id="clear-cart" type="button">
                                            <i class="fas fa-trash"></i> Clear
                                        </button>
                                        <button class="btn btn-inventory" id="view-inventory" type="button">
                                            <i class="fas fa-list"></i> Inventory
                                        </button>
                                        <button class="btn btn-checkout" id="checkout" type="button" disabled>
                                            <i class="fas fa-dollar-sign"></i> Checkout
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- Checkout Modal -->
                            <div id="checkout-modal" class="modal" aria-hidden="true">
                                <div class="modal-content" style="max-width: 500px; display: flex; flex-direction: column; gap: 0.5rem;">
                                    <h2><i class="fas fa-receipt"></i> Checkout</h2>
                                    <label for="customer-name">Customer Name:</label>
                                    <input type="text" id="customer-name" placeholder="Customer Name" />
                                    <h3>Invoice Preview</h3>
                                    <div class="invoice-scroll-container">
                                        <pre class="invoice" id="invoice-preview">Loading...</pre>
                                    </div>
                                    <div style="margin-top: auto; display: flex; gap: 1rem; justify-content: center;">
                                        <button class="btn btn-clear" id="cancel-checkout" type="button">
                                            <i class="fas fa-times"></i> Cancel
                                        </button>
                                        <button class="btn btn-checkout" id="confirm-sale" type="button">
                                            <i class="fas fa-check"></i> Confirm Sale
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- Inventory Modal -->
                            <div id="inventory-modal" class="modal" aria-hidden="true">
                                <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                                    <h2><i class="fas fa-warehouse"></i> Inventory</h2>
                                    <table border="1" cellpadding="8" style="width: 100%; border-collapse: collapse; margin-top: 1rem;">
                                        <thead>
                                            <tr style="background: #f1f1f1;">
                                                <th>Product</th>
                                                <th>Price</th>
                                                <th>Stock</th>
                                            </tr>
                                        </thead>
                                        <tbody id="inventory-list"></tbody>
                                    </table>
                                    <button class="btn btn-clear" id="close-inventory" type="button" style="margin-top: 1rem;">Close</button>
                                </div>
                            </div>

                            <!-- Quantity Input Modal -->
                            <div id="quantity-modal" class="modal" aria-hidden="true">
                                <div class="modal-content" style="max-width: 400px;">
                                    <h3><i class="fas fa-box"></i> Enter Quantity</h3>
                                    <p id="product-name-display"></p>
                                    <input type="number" id="quantity-input" min="1" value="1" />
                                    <label id="discount-checkbox-container" style="display:none; margin: 1rem 0; cursor: pointer;">
                                        <input type="checkbox" id="apply-discount-checkbox" checked>
                                        <span id="discount-label-text"></span>
                                    </label>
                                    <div style="margin-top: 1.5rem; display: flex; gap: 1rem; justify-content: center;">
                                        <button id="cancel-quantity" class="btn btn-clear" type="button">
                                            <i class="fas fa-times"></i> Cancel
                                        </button>
                                        <button id="add-quantity" class="btn btn-checkout" type="button">
                                            <i class="fas fa-plus"></i> Add to Cart
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- Scanner Overlay -->
                            <div id="scanner-container" class="scanner-overlay" aria-hidden="true">
                                <div id="scanner-viewport"></div>
                                <button id="close-scanner" type="button" class="btn btn-clear" style="margin-top: 1rem;">Close Scanner</button>
                            </div>

                            <!-- Notification Toast -->
                            <div id="notification" class="notification">Item added!</div>
                        </div>
                    </div>
                `;
            }

            static buildAllSections() {
                return `
                    ${this.buildDashboardSection()}
                    ${this.buildPOSEmbeddedSection()}
                    ${this.buildSalesSection()}
                    ${this.buildInventorySection()}
                    ${this.buildSuppliersSection()}
                    ${this.buildPurchaseOrdersSection()}
                    ${this.buildAnalyticsSection()}
                    ${this.buildExpensesSection()}
                    ${this.buildAccountingSection()}
                    ${this.buildLiabilitiesSection()}
                    ${this.buildForecastingSection()}
                    ${this.buildReportsSection()}
                    ${this.buildOutletsSection()}
                    ${this.buildConsignmentsSection()}
                    ${this.buildSettlementsSection()}
                    ${this.buildCustomersSection()}
                    ${this.buildSettingsSection()}
                    ${this.buildLoanSection()}
                    ${this.buildUserManagementSection()}
                `;
            }
        }

export { AppController };
