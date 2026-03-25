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

class DataLoaderService {

            async loadProducts() {
                if (!state.currentUser) return;
                
                console.log('=== LOADING PRODUCTS ===');
                console.log('User role:', state.userRole);
                
                try {
                    state.allProducts = [];
                    //const outlet = state.allOutlets.find(o => o.id === state.assignedOutlet);
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // OUTLET MANAGER: Load from outlet inventory
                        const outlet = state.allOutlets[0]; // Already loaded with parentAdminId
                        console.log('OUTLETS:', outlet);
                        if (!outlet || !outlet.createdBy) {
                            console.error('❌ Outlet not loaded or missing parentAdminId');
                            return;
                        }
                        
                        const parentAdminId = outlet.createdBy;
                        const outletId = state.assignedOutlet;
                        
                        console.log('📦 Loading outlet inventory from:', `users/${parentAdminId}/outlets/${outletId}/inventory`);
                        
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
                        
                        console.log('✓ Loaded outlet products:', state.allProducts.length);
                        
                    } else {
                        // ADMIN: same paths as POS — user-scoped inventory first, then legacy root
                        const uid = state.currentUser.uid;
                        console.log('📦 Loading admin inventory (scoped then legacy):', `users/${uid}/inventory`);
                        let rows = await fetchCollectionRows(
                            collection(db, 'users', uid, 'inventory'),
                            `users/${uid}/inventory`
                        );
                        if (rows.length === 0) {
                            rows = await fetchCollectionRows(collection(db, 'inventory'), 'inventory_legacy');
                        }
                        state.allProducts = rows;
                        
                        console.log('✓ Loaded main products:', state.allProducts.length);
                    }
                    
                } catch (error) {
                    console.error('❌ Error loading products:', error);
                }
            }

            async loadSales() {
                if (!state.currentUser) return;
                
                
                console.log('=== LOADING SALES ===');
                console.log('User role:', state.userRole);
                console.log('Assigned Outlet:', state.assignedOutlet);
                
                try {
                    state.allSales = [];
                    
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // OUTLET MANAGER: Load from outlet sales
                        const outlet = state.allOutlets[0];
                        console.log('OUTLETS:', outlet);
                        if (!outlet || !outlet.createdBy) {
                            console.error('❌ Outlet not loaded or missing parentAdminId');
                            return;
                        }
                        
                        const parentAdminId = outlet.createdBy;
                        const outletId = state.assignedOutlet;
                        
                        console.log('💰 Loading outlet sales from:', `users/${parentAdminId}/outlets/${outletId}/sales`);
                        
                        const salesRef = collection(db, 'users', parentAdminId, 'outlets', outletId, 'outlet_sales');
                        state.allSales = await fetchCollectionRows(salesRef, `outlet_sales:${outletId}`);
                        
                        console.log('✓ Loaded outlet sales:', state.allSales.length);
                        
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
                            console.log('💰 Loading main sales from: sales/');
                            const mainSalesRef = collection(db, 'sales');
                            mainRows = await fetchCollectionRows(mainSalesRef, 'sales');
                            console.log('✓ Loaded main sales:', mainRows.length);
                        }

                        let outletRows = [];
                        if (outletIdsToLoad.length > 0) {
                            console.log(`💰 Loading outlet sales for ${outletIdsToLoad.length} outlet(s) under users/${uid}/outlets/*/outlet_sales`);
                            for (const outletId of outletIdsToLoad) {
                                const outletSalesRef = collection(db, 'users', uid, 'outlets', outletId, 'outlet_sales');
                                const rows = await fetchCollectionRows(outletSalesRef, `outlet_sales:${outletId}`);
                                outletRows = outletRows.concat(rows.map(r => ({
                                    ...r,
                                    outletId: r.outletId || outletId,
                                    // enhanced-dashboard filters main vs outlets using location/outletId
                                    location: r.location || outletId
                                })));
                            }
                        }

                        state.allSales = mainRows.concat(outletRows);
                        console.log(`✓ Loaded sales (${selectedFilter}):`, state.allSales.length);
                    }
                    
                } catch (error) {
                    console.error('❌ Error loading sales:', error);
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
                            // Load all expenses (main + all outlets)
                            // Load main expenses
                            const mainSnapshot = await getDocs(
                                query(firebaseService.getUserCollection('expenses'), orderBy('date', 'desc'))
                            );
                            mainSnapshot.forEach(doc => {
                                state.allExpenses.push({ ...doc.data(), id: doc.id, source: 'main' });
                            });
                            
                            // Load all outlet expenses
                            for (const outlet of state.allOutlets) {
                                try {
                                    const outletSnapshot = await getDocs(
                                        query(
                                            firebaseService.getOutletSubCollection(outlet.id, 'outlet_expenses'),
                                            orderBy('date', 'desc')
                                        )
                                    );
                                    outletSnapshot.forEach(doc => {
                                        state.allExpenses.push({ ...doc.data(), id: doc.id, source: outlet.id });
                                    });
                                } catch (err) {
                                    console.log(`No expenses for outlet ${outlet.name}`);
                                }
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
                        


                        // Load outlet inventory - FIXED: use 'outlet_inventory' not 'inventory'
                        const inventorySnapshot = await getDocs(
                            collection(db, 'users', state.currentUser.uid, 'outlets', outletDoc.id, 'outlet_inventory')
                        );
                        let inventoryValue = 0;
                        inventorySnapshot.forEach(doc => {
                            const item = doc.data();
                            inventoryValue += (item.quantity || 0) * (item.cost || 0);
                        });
                        outletData.inventoryValue = inventoryValue;
                        
                        state.allOutlets.push(outletData);
                    }
                    console.log("Outlets loaded with inventory values:", state.allOutlets.map(o => ({
                        name: o.name, 
                        inventoryValue: o.inventoryValue
                    })));
                    
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
                console.log('╔════════════════════════════════════════╗');
                console.log('║   LOADING SINGLE OUTLET (ENHANCED)     ║');
                console.log('╚════════════════════════════════════════╝');
                
                console.log('📋 Input Parameters:');
                console.log('  Outlet ID:', outletId);
                console.log('  Current User UID:', state.currentUser?.uid);
                console.log('  Current User Email:', state.currentUser?.email);
                
                if (!state.currentUser || !state.currentUser.uid) {
                    console.error('❌ FAILED: No current user');
                    Utils.showToast('User session invalid. Please log in again.', 'error');
                    return;
                }
                
                try {
                    // ═══════════════════════════════════════
                    // STEP 1: Load Outlet Manager Document
                    // ═══════════════════════════════════════
                    console.log('\n📄 STEP 1: Loading Outlet Manager Document');
                    const managerPath = `users/${state.currentUser.uid}`;
                    console.log('  Path:', managerPath);
                    
                    const userDocRef = doc(db, 'users', state.currentUser.uid);
                    const userDoc = await getDoc(userDocRef);
                    
                    if (!userDoc.exists()) {
                        console.error('❌ FAILED: Manager document not found');
                        console.log('  Expected path:', managerPath);
                        Utils.showToast('Your user profile is missing. Please contact administrator.', 'error');
                        return;
                    }
                    
                    console.log('✅ Manager document found');
                    
                    const userData = userDoc.data();
                    console.log('  Manager Data:', JSON.stringify(userData, null, 2));
                    
                    // ═══════════════════════════════════════
                    // STEP 2: Extract Parent Admin ID
                    // ═══════════════════════════════════════
                    console.log('\n🔑 STEP 2: Extracting Parent Admin ID');
                    const parentAdminId = userData.createdBy;
                    
                    if (!parentAdminId) {
                        console.error('❌ FAILED: No parent admin ID (createdBy field is missing)');
                        console.log('  Manager Data:', userData);
                        console.log('\n🔧 FIX REQUIRED:');
                        console.log('  The outlet manager account is misconfigured.');
                        console.log('  Admin needs to run the fixOutletManagerDocument() function.');
                        Utils.showToast('Account configuration error. Missing parent admin reference. Please contact administrator.', 'error');
                        return;
                    }
                    
                    console.log('✅ Parent Admin ID found:', parentAdminId);
                    console.log('  Created By Email:', userData.createdByEmail);
                    
                    // ═══════════════════════════════════════
                    // STEP 3: Load Outlet Document
                    // ═══════════════════════════════════════
                    console.log('\n🏪 STEP 3: Loading Outlet Document');
                    const outletPath = `users/${parentAdminId}/outlets/${outletId}`;
                    console.log('  Path:', outletPath);
                    
                    const outletDocRef = doc(db, 'users', parentAdminId, 'outlets', outletId);
                    const outletDoc = await getDoc(outletDocRef);
                    
                    if (!outletDoc.exists()) {
                        console.error('❌ FAILED: Outlet document not found');
                        console.log('  Expected path:', outletPath);
                        
                        // Debug: List all outlets under this admin
                        console.log('\n🔍 DEBUG: Checking what outlets exist...');
                        try {
                            const outletsRef = collection(db, 'users', parentAdminId, 'outlets');
                            const outletsSnap = await getDocs(outletsRef);
                            
                            console.log(`  Found ${outletsSnap.size} outlet(s) under admin ${parentAdminId}:`);
                            outletsSnap.forEach(doc => {
                                console.log(`    - ID: ${doc.id}`);
                                console.log(`      Name: ${doc.data().name}`);
                            });
                            
                            if (outletsSnap.size === 0) {
                                console.log('  ⚠️ No outlets found. Admin needs to create outlets first.');
                            } else {
                                console.log(`  ⚠️ Outlet ${outletId} does not exist under this admin.`);
                                console.log('  ⚠️ The outlet may have been deleted or the ID is wrong.');
                            }
                        } catch (debugError) {
                            console.error('  Debug query failed:', debugError);
                        }
                        
                        Utils.showToast('Your assigned outlet was not found. Please contact administrator.', 'error');
                        return;
                    }
                    
                    console.log('✅ Outlet document found');
                    const outletData = { ...outletDoc.data(), id: outletDoc.id };
                    console.log('  Outlet Name:', outletData.name);
                    console.log('  Outlet Location:', outletData.location);
                    
                    // ═══════════════════════════════════════
                    // STEP 4: Load Outlet Inventory
                    // ═══════════════════════════════════════
                    console.log('\n📦 STEP 4: Loading Outlet Inventory');
                    const inventoryPath = `users/${parentAdminId}/outlets/${outletId}/outlet_inventory`;
                    console.log('  Path:', inventoryPath);
                    
                    const inventoryRef = collection(db, 'users', parentAdminId, 'outlets', outletId, 'outlet_inventory');
                    const inventorySnapshot = await getDocs(inventoryRef);
                    
                    console.log(`✅ Found ${inventorySnapshot.size} inventory item(s)`);
                    
                    let inventoryValue = 0;
                    inventorySnapshot.forEach(doc => {
                        const item = doc.data();
                        const itemValue = (item.quantity || 0) * (item.cost || 0);
                        inventoryValue += itemValue;
                        console.log(`  - ${item.name}: ${item.quantity} @ ${item.cost} = ${itemValue}`);
                    });
                    
                    console.log('  Total Inventory Value:', inventoryValue);
                    
                    // ═══════════════════════════════════════
                    // STEP 5: Load Consignments
                    // ═══════════════════════════════════════
                    console.log('\n🚚 STEP 5: Loading Consignments');
                    const consignmentsPath = `users/${parentAdminId}/outlets/${outletId}/consignments`;
                    console.log('  Path:', consignmentsPath);
                    
                    const consignmentsRef = collection(db, 'users', parentAdminId, 'outlets', outletId, 'consignments');
                    const consignmentsSnapshot = await getDocs(consignmentsRef);
                    
                    console.log(`✅ Found ${consignmentsSnapshot.size} consignment(s)`);
                    
                    consignmentsSnapshot.forEach(doc => {
                        const consignment = doc.data();
                        console.log(`  - Consignment ${doc.id}:`);
                        console.log(`    Status: ${consignment.status}`);
                        console.log(`    Date: ${consignment.date}`);
                        console.log(`    Products: ${consignment.products?.length || 0}`);
                    });
                    
                    // ═══════════════════════════════════════
                    // STEP 6: Store Data in State
                    // ═══════════════════════════════════════
                    console.log('\n💾 STEP 6: Storing Data in Application State');
                    
                    outletData.inventoryValue = inventoryValue;
                    outletData.createdBy = parentAdminId;
                    
                    state.allOutlets = [outletData];
                    
                    console.log('✅ Data stored successfully');
                    console.log('  state.allOutlets:', state.allOutlets.length);
                    console.log('  Parent Admin ID:', outletData.parentAdminId);
                    
                    console.log('\n╔════════════════════════════════════════╗');
                    console.log('║     ✅ OUTLET LOADED SUCCESSFULLY      ║');
                    console.log('╚════════════════════════════════════════╝');
                    
                    console.log('Summary:');
                    console.log('  Outlet:', outletData.name);
                    console.log('  Manager:', state.currentUser.email);
                    console.log('  Parent Admin:', parentAdminId);
                    console.log('  Inventory Items:', inventorySnapshot.size);
                    console.log('  Inventory Value:', inventoryValue);
                    console.log('  Consignments:', consignmentsSnapshot.size);
                    
                } catch (error) {
                    console.error('\n╔════════════════════════════════════════╗');
                    console.error('║           ❌ ERROR OCCURRED            ║');
                    console.error('╚════════════════════════════════════════╝');
                    console.error('Error Name:', error.name);
                    console.error('Error Code:', error.code);
                    console.error('Error Message:', error.message);
                    console.error('Error Stack:', error.stack);
                    
                    if (error.code === 'permission-denied') {
                        console.error('\n🔒 PERMISSION DENIED');
                        console.error('Firestore security rules are blocking access.');
                        console.error('Check Firebase Console → Firestore → Rules');
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
                    
                    console.log('✓ Loaded suppliers:', state.allSuppliers.length);
                } catch (error) {
                    console.error('Error loading suppliers:', error);
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
                    
                    console.log('✓ Loaded purchase orders:', state.allPurchaseOrders.length);
                } catch (error) {
                    console.error('Error loading purchase orders:', error);
                }
            }

            async loadAll() {
                console.log('╔════════════════════════════════════════╗');
                console.log('║        LOADING ALL DATA (FIXED)        ║');
                console.log('╚════════════════════════════════════════╝');
                
                if (!state.currentUser || !state.currentUser.uid) {
                    console.error('❌ Cannot load data: No current user');
                    return;
                }
                
                console.log('User:', state.currentUser.email);
                console.log('Role:', state.userRole);
                console.log('Assigned Outlet:', state.assignedOutlet);
                
                Utils.showSpinner();
                
                try {
                    if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                        // ═══════════════════════════════════════════════════
                        // OUTLET MANAGER: Load outlet FIRST, then other data
                        // ═══════════════════════════════════════════════════
                        console.log('\n🏪 OUTLET MANAGER MODE');
                        console.log('Assigned outlet:', state.assignedOutlet);
                        
                        // STEP 1: Load outlet FIRST (critical!)
                        console.log('\n1️⃣ Loading outlet...');
                        await this.loadSingleOutlet(state.assignedOutlet);
                        
                        /*if (!outletLoaded) {
                            console.error('❌ Failed to load outlet');
                            Utils.showToast('Failed to load outlet data', 'error');
                            return;
                        }*/
                        
                        console.log('✅ Outlet loaded successfully');
                        console.log('   Outlet:', state.allOutlets[0]?.name);
                        console.log('   Parent Admin ID:', state.allOutlets[0]?.createdBy);
                        
                        // Verify outlet is in state
                        if (!state.allOutlets || state.allOutlets.length === 0) {
                            console.error('❌ state.allOutlets is empty!');
                            Utils.showToast('Outlet data missing', 'error');
                            return;
                        }
                        
                        // STEP 2: Now load other data (outlet is available)
                        console.log('\n2️⃣ Loading products, sales, customers, expenses...');
                        await Promise.all([
                            this.loadProducts(),   // ✅ Now outlet is available!
                            this.loadSales(),      // ✅ Now outlet is available!
                            this.loadExpenses(),
                            this.loadCustomers(),
                            this.loadLiabilities(),
                            this.loadSuppliers(),
                            this.loadPurchaseOrders()
                        ]);
                        
                        console.log('✅ All outlet manager data loaded');
                        console.log('   Products:', state.allProducts.length);
                        console.log('   Sales:', state.allSales.length);
                        
                    } else if (state.userRole === 'admin') {
                        // ═══════════════════════════════════════════════════
                        // ADMIN: Load all data in parallel
                        // ═══════════════════════════════════════════════════
                        console.log('\n👑 ADMIN MODE');
                        
                        await Promise.all([
                            this.loadProducts(),
                            this.loadSales(),
                            this.loadExpenses(),
                            this.loadCustomers(),
                            this.loadOutlets(),
                            this.loadLiabilities(),
                            this.loadSuppliers(),
                            this.loadPurchaseOrders()
                        ]);
                        
                        console.log('✅ All admin data loaded');
                        console.log('   Products:', state.allProducts.length);
                        console.log('   Sales:', state.allSales.length);
                        console.log('   Outlets:', state.allOutlets.length);
                        
                    } else {
                        console.warn('⚠️ Unknown role or missing outlet assignment');
                        console.log('Role:', state.userRole);
                        console.log('Assigned Outlet:', state.assignedOutlet);
                    }
                    
                    console.log('\n╔════════════════════════════════════════╗');
                    console.log('║       ✅ DATA LOADING COMPLETE         ║');
                    console.log('╚════════════════════════════════════════╝');
                    
                } catch (error) {
                    console.error('\n❌ ERROR LOADING DATA:', error);
                    console.error('Error code:', error.code);
                    console.error('Error message:', error.message);
                    console.error('Error stack:', error.stack);
                    Utils.showToast('Error loading data: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }
        }

// Create and export singleton instance
export const dataLoader = new DataLoaderService();
