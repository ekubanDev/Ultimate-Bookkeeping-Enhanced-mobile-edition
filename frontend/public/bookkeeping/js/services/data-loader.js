// ==================== DATA LOADER SERVICE ====================

/**
 * Data Loader Service
 * Handles loading data from Firebase for products, sales, expenses, customers
 */

import { db } from '../config/firebase.js';
import { collection, doc, getDoc, getDocs } from '../config/firebase.js';
import { onSnapshot, query, orderBy, where, limit } from '../config/firebase.js';
import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';
import { firebaseService } from './firebase-service.js';

/** WebKit: empty local cache before server merge; retry with server source when online. */
async function fetchCollectionRows(colRef, label = 'collection') {
    const pull = async (getOpts) => {
        const snapshot = await colRef.get(getOpts);
        const rows = [];
        snapshot.forEach((docSnap) => {
            rows.push({ id: docSnap.id, ...docSnap.data() });
        });
        return { snapshot, rows };
    };
    let { rows } = await pull();
    if (rows.length === 0 && typeof navigator !== 'undefined' && navigator.onLine) {
        try {
            const second = await pull({ source: 'server' });
            if (second.rows.length > 0) {
                console.log(`[DataLoader] ${label}: ${second.rows.length} docs from server (cache was empty)`);
                return second.rows;
            }
        } catch (e) {
            console.warn(`[DataLoader] ${label}: server read failed`, e?.message || e);
        }
    }
    return rows;
}

/**
 * Stock value for Outlets Management: canonical data lives under
 * users/{ownerUid}/outlets/{outletId}/outlet_inventory (POS, transfers, consignment confirm).
 * Legacy consignments used subcollection name "inventory" — include those lines when not superseded by productId.
 */
async function computeOutletInventoryValue(db, ownerUid, outletId) {
    const lineValue = (item) => {
        const qty = parseFloat(item.quantity) || 0;
        let unit = parseFloat(item.cost);
        if (!Number.isFinite(unit) || unit <= 0) unit = parseFloat(item.unitCost) || 0;
        if (!Number.isFinite(unit) || unit <= 0) unit = parseFloat(item.price) || 0;
        if (!Number.isFinite(unit) || unit <= 0) unit = parseFloat(item.retail) || 0;
        return qty * unit;
    };

    const seenProductKeys = new Set();
    let total = 0;

    // Fetch both collections in parallel — they are independent reads
    const oiRef  = collection(db, 'users', ownerUid, 'outlets', outletId, 'outlet_inventory');
    const legRef = collection(db, 'users', ownerUid, 'outlets', outletId, 'inventory');
    const [snapOI, snapLeg] = await Promise.all([getDocs(oiRef), getDocs(legRef)]);

    snapOI.forEach((docSnap) => {
        const item = docSnap.data();
        const key = String(item.productId ?? docSnap.id);
        seenProductKeys.add(key);
        total += lineValue(item);
    });

    snapLeg.forEach((docSnap) => {
        const item = docSnap.data();
        const key = String(item.productId ?? docSnap.id);
        if (seenProductKeys.has(key)) return;
        total += lineValue(item);
    });

    return total;
}

class DataLoaderService {

            async loadProducts() {
                if (!state.currentUser) return;

                try {
                    state.allProducts = [];
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // OUTLET MANAGER: Load from outlet inventory
                        const outlet = state.allOutlets[0]; // Already loaded with parentAdminId
                        if (!outlet || !outlet.createdBy) {
                            console.error('[DataLoader] loadProducts: outlet not loaded or missing parentAdminId');
                            return;
                        }

                        const parentAdminId = outlet.createdBy;
                        const outletId = state.assignedOutlet;

                        const inventoryRef = collection(db, 'users', parentAdminId, 'outlets', outletId, 'outlet_inventory');
                        let rows = await fetchCollectionRows(inventoryRef, `outlet_inventory:${outletId}`);
                        if (rows.length === 0 && parentAdminId) {
                            const extra = await fetchCollectionRows(
                                collection(db, 'users', parentAdminId, 'inventory'),
                                'parent_inventory_fallback'
                            );
                            rows = rows.concat(extra);
                        }
                        state.allProducts = rows;

                    } else {
                        // ADMIN: same paths as POS — user-scoped inventory first, then legacy root
                        const uid = state.currentUser.uid;
                        let rows = await fetchCollectionRows(
                            collection(db, 'users', uid, 'inventory'),
                            `users/${uid}/inventory`
                        );
                        if (rows.length === 0) {
                            rows = await fetchCollectionRows(collection(db, 'inventory'), 'inventory_legacy');
                        }
                        state.allProducts = rows;
                    }

                } catch (error) {
                    console.error('[DataLoader] loadProducts error:', error);
                    state.loadErrors.products = true;
                    Utils.showToast('Failed to load inventory — check your connection and refresh', 'error');
                }
            }

            async loadSales() {
                if (!state.currentUser) return;

                try {
                    state.allSales = [];

                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // OUTLET MANAGER: Load from outlet sales
                        const outlet = state.allOutlets[0];
                        if (!outlet || !outlet.createdBy) {
                            console.error('[DataLoader] loadSales: outlet not loaded or missing parentAdminId');
                            return;
                        }

                        const parentAdminId = outlet.createdBy;
                        const outletId = state.assignedOutlet;

                        const salesRef = collection(db, 'users', parentAdminId, 'outlets', outletId, 'outlet_sales');
                        state.allSales = await fetchCollectionRows(salesRef, `outlet_sales:${outletId}`);

                    } else {
                        // ADMIN: load sales based on selected outlet filter (main vs all vs specific outlet)
                        const uid = state.currentUser.uid;
                        const selectedFilter = state.selectedOutletFilter || 'main';
                        const outlets = (state.allOutlets || []).filter(o => o && o.id);

                        const shouldLoadMain = selectedFilter === 'main' || selectedFilter === 'all' || !selectedFilter;
                        const outletIdsToLoad =
                            selectedFilter === 'all'
                                ? outlets.map(o => o.id)
                                : (selectedFilter && selectedFilter !== 'main') ? [selectedFilter] : [];

                        let mainRows = [];
                        if (shouldLoadMain) {
                            mainRows = await fetchCollectionRows(collection(db, 'sales'), 'sales');
                        }

                        let outletRows = [];
                        if (outletIdsToLoad.length > 0) {
                            // Fetch all outlet sales collections in parallel
                            const outletSalesFetches = outletIdsToLoad.map(outletId => {
                                const ref = collection(db, 'users', uid, 'outlets', outletId, 'outlet_sales');
                                return fetchCollectionRows(ref, `outlet_sales:${outletId}`)
                                    .then(rows => rows.map(r => ({
                                        ...r,
                                        outletId: r.outletId || outletId,
                                        location: r.location || outletId
                                    })));
                            });
                            const results = await Promise.all(outletSalesFetches);
                            outletRows = results.flat();
                        }

                        state.allSales = mainRows.concat(outletRows);
                    }

                } catch (error) {
                    console.error('[DataLoader] loadSales error:', error);
                    state.loadErrors.sales = true;
                    Utils.showToast('Failed to load sales — check your connection and refresh', 'error');
                }
            }

            async loadExpenses() {
                try {
                    state.allExpenses = [];
                    
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // Outlet manager: Load ONLY outlet expenses
                        const snapshot = await getDocs(
                            query(
                                firebaseService.getOutletSubCollection(state.assignedOutlet, 'outlet_expenses'),
                                orderBy('date', 'desc')
                            )
                        );
                        snapshot.forEach(doc => {
                            state.allExpenses.push({ ...doc.data(), id: doc.id });
                        });
                    } else if (state.userRole === 'admin') {
                        // Admin: Load based on selected outlet filter
                        const selectedFilter = state.selectedOutletFilter || 'main';
                        
                        if (selectedFilter === 'main') {
                            // Load only main office expenses
                            const snapshot = await getDocs(
                                query(firebaseService.getUserCollection('expenses'), orderBy('date', 'desc'))
                            );
                            snapshot.forEach(doc => {
                                state.allExpenses.push({ ...doc.data(), id: doc.id });
                            });
                        } else if (selectedFilter === 'all') {
                            // Load all expenses (main + all outlets) in parallel
                            const mainQuery = query(firebaseService.getUserCollection('expenses'), orderBy('date', 'desc'));
                            const outletQueries = state.allOutlets.map(outlet =>
                                getDocs(query(
                                    firebaseService.getOutletSubCollection(outlet.id, 'outlet_expenses'),
                                    orderBy('date', 'desc')
                                )).then(snap => ({ snap, outletId: outlet.id })).catch(() => null)
                            );

                            const [mainSnapshot, ...outletResults] = await Promise.all([
                                getDocs(mainQuery),
                                ...outletQueries
                            ]);

                            mainSnapshot.forEach(doc => {
                                state.allExpenses.push({ ...doc.data(), id: doc.id, source: 'main' });
                            });

                            for (const result of outletResults) {
                                if (!result) continue; // outlet had no expenses subcollection
                                result.snap.forEach(doc => {
                                    state.allExpenses.push({ ...doc.data(), id: doc.id, source: result.outletId });
                                });
                            }

                            // Sort by date
                            state.allExpenses.sort((a, b) => b.date.localeCompare(a.date));
                        } else {
                            // Load specific outlet expenses
                            const snapshot = await getDocs(
                                query(
                                    firebaseService.getOutletSubCollection(selectedFilter, 'outlet_expenses'),
                                    orderBy('date', 'desc')
                                )
                            );
                            snapshot.forEach(doc => {
                                state.allExpenses.push({ ...doc.data(), id: doc.id });
                            });
                        }
                    }
                    
                    return state.allExpenses;
                } catch (error) {
                    console.error('Load expenses error:', error);
                    Utils.showToast('Failed to load expenses', 'error');
                    return [];
                }
            }

            async loadCustomers() {
                try {
                    const snapshot = await getDocs(firebaseService.getUserCollection('customers'));
                    state.allCustomers = [];
                    snapshot.forEach(doc => {
                        state.allCustomers.push({ ...doc.data(), id: doc.id });
                    });
                    return state.allCustomers;
                } catch (error) {
                    console.error('Load customers error:', error);
                    Utils.showToast('Failed to load customers', 'error');
                    return [];
                }
            }

            async loadLiabilities() {
                try {
                    const snapshot = await getDocs(
                        query(
                            firebaseService.getUserCollection('liabilities'),
                            orderBy('dueDate', 'asc')
                        )
                    );
                    
                    state.allLiabilities = [];
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        
                        // Calculate status based on balance and due date
                        let calculatedStatus = 'active';
                        const balance = data.balance !== undefined ? data.balance : data.amount;
                        
                        if (balance === 0) {
                            // Fully paid
                            calculatedStatus = 'paid';
                        } else if (balance > 0) {
                            // Has outstanding balance
                            const dueDate = new Date(data.dueDate);
                            dueDate.setHours(0, 0, 0, 0);
                            
                            if (dueDate < today) {
                                calculatedStatus = 'overdue';
                            } else {
                                const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
                                if (daysUntilDue <= 7) {
                                    calculatedStatus = 'due_soon';
                                } else {
                                    calculatedStatus = 'unpaid';  // Active unpaid liability
                                }
                            }
                        }
                        
                        state.allLiabilities.push({
                            id: doc.id,
                            ...data,
                            balance: balance,  // Ensure balance is always present
                            calculatedStatus
                        });
                    });
                    
                    return state.allLiabilities;
                } catch (error) {
                    console.error('Load liabilities error:', error);
                    Utils.showToast('Failed to load liabilities', 'error');
                    return [];
                }
            }

            async loadOutlets() {
                try {
                    const snapshot = await getDocs(firebaseService.getOutletsCollection());
                    state.allOutlets = [];
                    
                    for (const outletDoc of snapshot.docs) {
                        const outletData = { ...outletDoc.data(), id: outletDoc.id };

                        // Inventory is stored under the admin who owns the outlet (createdBy), not always the signed-in uid
                        const ownerUid = outletData.createdBy || state.currentUser.uid;
                        outletData.inventoryValue = await computeOutletInventoryValue(db, ownerUid, outletDoc.id);
                        
                        state.allOutlets.push(outletData);
                    }
                    return state.allOutlets;
                } catch (error) {
                    console.error('Load outlets error:', error);
                    Utils.showToast('Failed to load outlets', 'error');
                    return [];
                }
            }

            async diagnoseOutletManager() {
                console.log('=== OUTLET MANAGER DIAGNOSIS ===');
                
                const managerUid = state.currentUser?.uid || auth.currentUser?.uid;
                console.log('1️⃣ Manager UID:', managerUid);
                
                if (!managerUid) {
                    console.error('❌ No user UID!');
                    return;
                }
                
                // Get manager's user document
                const managerRef = doc(db, 'users', managerUid);
                const managerDoc = await getDoc(managerRef);
                
                if (!managerDoc.exists()) {
                    console.error('❌ Manager document does NOT exist at:', `users/${managerUid}`);
                    return;
                }
                
                const managerData = managerDoc.data();
                console.log('2️⃣ Manager Document Data:');
                console.log(JSON.stringify(managerData, null, 2));
                
                const parentAdminId = managerData.createdBy;
                const assignedOutlet = managerData.assignedOutlet;
                
                console.log('\n3️⃣ Extracted Values:');
                console.log('Parent Admin ID:', parentAdminId);
                console.log('Assigned Outlet ID:', assignedOutlet);
                
                if (!parentAdminId) {
                    console.error('❌ createdBy field is MISSING or NULL!');
                    console.log('Manager needs to be recreated with createdBy field.');
                    return;
                }
                
                if (!assignedOutlet) {
                    console.error('❌ assignedOutlet field is MISSING or NULL!');
                    return;
                }
                
                // Try to fetch the outlet document
                console.log('\n4️⃣ Attempting to fetch outlet...');
                const outletPath = `users/${parentAdminId}/outlets/${assignedOutlet}`;
                console.log('Path:', outletPath);
                
                try {
                    const outletRef = doc(db, 'users', parentAdminId, 'outlets', assignedOutlet);
                    const outletDoc = await getDoc(outletRef);
                    
                    if (outletDoc.exists()) {
                        console.log('✅ OUTLET FOUND!');
                        console.log('Outlet Data:');
                        console.log(JSON.stringify(outletDoc.data(), null, 2));
                    } else {
                        console.error('❌ OUTLET NOT FOUND at path:', outletPath);
                        console.log('\n🔍 Possible reasons:');
                        console.log('1. Outlet was deleted by admin');
                        console.log('2. Wrong parent admin ID in manager document');
                        console.log('3. Wrong outlet ID in manager document');
                        
                        // List all outlets under this admin
                        console.log('\n5️⃣ Checking what outlets exist under this admin...');
                        const outletsRef = collection(db, 'users', parentAdminId, 'outlets');
                        const outletsSnap = await getDocs(outletsRef);
                        
                        console.log(`Found ${outletsSnap.size} outlet(s):`);
                        outletsSnap.forEach(doc => {
                            console.log(`  - ID: ${doc.id}, Name: ${doc.data().name}`);
                        });
                    }
                } catch (error) {
                    console.error('❌ ERROR fetching outlet:', error);
                    console.error('Error code:', error.code);
                    
                    if (error.code === 'permission-denied') {
                        console.log('🔒 PERMISSION DENIED!');
                        console.log('Firestore security rules are blocking access.');
                    }
                }
                
                console.log('\n===================================');
            }
            

            async checkLoadFlow() {
                console.log('=== CHECKING LOAD FLOW ===');
                
                console.log('1. Current User:', state.currentUser?.uid);
                console.log('2. User Role:', state.userRole);
                console.log('3. Assigned Outlet:', state.assignedOutlet);
                console.log('4. Auth Initialized:', state.authInitialized);
                console.log('5. Outlets in State:', state.allOutlets);
                console.log('6. Outlets Count:', state.allOutlets?.length || 0);
                
                if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                    console.log('\n✅ Should load single outlet');
                    console.log('Calling loadSingleOutlet manually...');
                    
                    await dataLoader.loadSingleOutlet(state.assignedOutlet);
                    
                    console.log('\nAfter manual load:');
                    console.log('Outlets in State:', state.allOutlets);
                    console.log('First Outlet:', state.allOutlets[0]);
                } else {
                    console.log('\n❌ Not outlet manager or no assigned outlet');
                }
            }

            async loadSingleOutlet(outletId) {
                if (!state.currentUser || !state.currentUser.uid) {
                    console.error('[DataLoader] loadSingleOutlet: no current user');
                    Utils.showToast('User session invalid. Please log in again.', 'error');
                    return;
                }

                try {
                    // Load outlet manager document to get parent admin reference
                    const userDocRef = doc(db, 'users', state.currentUser.uid);
                    const userDoc = await getDoc(userDocRef);

                    if (!userDoc.exists()) {
                        console.error('[DataLoader] loadSingleOutlet: manager document missing for uid', state.currentUser.uid);
                        Utils.showToast('Your user profile is missing. Please contact administrator.', 'error');
                        return;
                    }

                    const userData = userDoc.data();
                    const parentAdminId = userData.createdBy;

                    if (!parentAdminId) {
                        console.error('[DataLoader] loadSingleOutlet: createdBy field missing — account misconfigured');
                        Utils.showToast('Account configuration error. Missing parent admin reference. Please contact administrator.', 'error');
                        return;
                    }

                    // Load outlet document
                    const outletDocRef = doc(db, 'users', parentAdminId, 'outlets', outletId);
                    const outletDoc = await getDoc(outletDocRef);

                    if (!outletDoc.exists()) {
                        console.error(`[DataLoader] loadSingleOutlet: outlet ${outletId} not found under admin ${parentAdminId}`);
                        Utils.showToast('Your assigned outlet was not found. Please contact administrator.', 'error');
                        return;
                    }

                    const outletData = { ...outletDoc.data(), id: outletDoc.id };

                    // Load outlet inventory value
                    const inventoryRef = collection(db, 'users', parentAdminId, 'outlets', outletId, 'outlet_inventory');
                    const inventorySnapshot = await getDocs(inventoryRef);

                    let inventoryValue = 0;
                    inventorySnapshot.forEach(doc => {
                        const item = doc.data();
                        inventoryValue += (item.quantity || 0) * (item.cost || 0);
                    });

                    // Load consignments (count only — full data loaded on demand)
                    const consignmentsRef = collection(db, 'users', parentAdminId, 'outlets', outletId, 'consignments');
                    const consignmentsSnapshot = await getDocs(consignmentsRef);

                    outletData.inventoryValue = inventoryValue;
                    outletData.createdBy = parentAdminId;

                    state.allOutlets = [outletData];

                } catch (error) {
                    console.error('[DataLoader] loadSingleOutlet error:', error.code, error.message);
                    if (error.code === 'permission-denied') {
                        Utils.showToast('Access denied. Please contact administrator to check permissions.', 'error');
                    } else {
                        Utils.showToast('Failed to load outlet: ' + error.message, 'error');
                    }
                }
            }

            async loadSuppliers() {
                if (!state.currentUser) return;
                
                try {
                    state.allSuppliers = [];
                    const suppliersRef = collection(db, 'suppliers');
                    const snapshot = await getDocs(suppliersRef);
                    
                    snapshot.forEach(doc => {
                        state.allSuppliers.push({
                            id: doc.id,
                            ...doc.data()
                        });
                    });
                    
                } catch (error) {
                    console.error('[DataLoader] loadSuppliers error:', error);
                    state.loadErrors.suppliers = true;
                }
            }

            async loadPurchaseOrders() {
                if (!state.currentUser) return;
                
                try {
                    state.allPurchaseOrders = [];
                    const posRef = collection(db, 'purchase_orders');
                    const q = query(posRef, orderBy('createdAt', 'desc'));
                    const snapshot = await getDocs(q);
                    
                    snapshot.forEach(doc => {
                        state.allPurchaseOrders.push({
                            id: doc.id,
                            ...doc.data()
                        });
                    });
                    
                } catch (error) {
                    console.error('[DataLoader] loadPurchaseOrders error:', error);
                    state.loadErrors.purchaseOrders = true;
                }
            }

            async loadLiabilityPayments() {
                if (!state.currentUser) return;
                try {
                    state.allLiabilityPayments = [];
                    const snap = await getDocs(
                        query(
                            collection(db, 'payment_transactions'),
                            where('type', '==', 'liability_payment')
                        )
                    );
                    snap.forEach((docSnap) => {
                        state.allLiabilityPayments.push({ id: docSnap.id, ...docSnap.data() });
                    });
                    state.allLiabilityPayments.sort(
                        (a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || '')
                    );
                } catch (err) {
                    console.error('Load liability payments error:', err);
                }
            }

            async loadAll() {
                if (!state.currentUser || !state.currentUser.uid) {
                    console.error('[DataLoader] loadAll: no current user');
                    return;
                }

                // Reset error flags before each load attempt so a successful retry clears them.
                state.loadErrors = {};

                Utils.showSpinner();

                try {
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // Load outlet FIRST — products and sales depend on outlet.createdBy
                        await this.loadSingleOutlet(state.assignedOutlet);

                        if (!state.allOutlets || state.allOutlets.length === 0) {
                            Utils.showToast('Outlet data missing', 'error');
                            return;
                        }

                        await Promise.all([
                            this.loadProducts(),
                            this.loadSales(),
                            this.loadExpenses(),
                            this.loadCustomers(),
                            this.loadLiabilities(),
                            this.loadLiabilityPayments(),
                            this.loadSuppliers(),
                            this.loadPurchaseOrders()
                        ]);

                    } else if (state.userRole === 'admin') {
                        await Promise.all([
                            this.loadProducts(),
                            this.loadSales(),
                            this.loadExpenses(),
                            this.loadCustomers(),
                            this.loadOutlets(),
                            this.loadLiabilities(),
                            this.loadLiabilityPayments(),
                            this.loadSuppliers(),
                            this.loadPurchaseOrders()
                        ]);

                    } else {
                        console.warn('[DataLoader] loadAll: unknown role or missing outlet assignment', state.userRole);
                    }

                } catch (error) {
                    console.error('[DataLoader] loadAll error:', error.code, error.message);
                    Utils.showToast('Error loading data: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                    this._showLoadErrorBannerIfNeeded();
                }
            }

            /** Renders a dismissible top banner when critical data sections failed to load. */
            _showLoadErrorBannerIfNeeded() {
                const failed = Object.keys(state.loadErrors).filter(k => state.loadErrors[k]);
                if (failed.length === 0) return;

                // Remove any existing banner
                document.getElementById('data-load-error-banner')?.remove();

                const sectionNames = {
                    products: 'Inventory',
                    sales: 'Sales',
                    suppliers: 'Suppliers',
                    purchaseOrders: 'Purchase Orders',
                };
                const labels = failed.map(k => sectionNames[k] || k).join(', ');

                const banner = document.createElement('div');
                banner.id = 'data-load-error-banner';
                banner.style.cssText = [
                    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
                    'background:#dc3545', 'color:#fff',
                    'padding:0.6rem 1rem', 'font-size:0.9rem',
                    'display:flex', 'align-items:center', 'gap:0.75rem',
                    'box-shadow:0 2px 8px rgba(0,0,0,0.25)'
                ].join(';');

                banner.innerHTML = `
                    <i class="fas fa-exclamation-circle"></i>
                    <span>Failed to load: <strong>${labels}</strong>. Data shown may be incomplete.</span>
                    <button onclick="window.dataLoader?.loadAll().then(()=>document.getElementById('data-load-error-banner')?.remove())"
                            style="margin-left:auto;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.5);color:#fff;padding:0.25rem 0.75rem;border-radius:6px;cursor:pointer;font-size:0.85rem;">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                    <button onclick="this.parentElement.remove()"
                            style="background:transparent;border:none;color:#fff;font-size:1.1rem;cursor:pointer;padding:0 0.25rem;"
                            title="Dismiss">&times;</button>
                `;

                document.body.prepend(banner);
            }
        }

// Create and export singleton instance
export const dataLoader = new DataLoaderService();
window.dataLoader = dataLoader;
