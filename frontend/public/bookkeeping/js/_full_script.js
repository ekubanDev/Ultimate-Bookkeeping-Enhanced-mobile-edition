
        // ==================== FIREBASE IMPORTS ====================
        emailjs.init("2JkO3-Ju6GCVuteLC");

        import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
        import { 
            getFirestore, collection, doc, getDoc, setDoc, addDoc, 
            updateDoc, deleteDoc, getDocs, onSnapshot, query, 
            orderBy, limit, where, writeBatch, enableIndexedDbPersistence 
        } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
        import { 
            getAuth, onAuthStateChanged, signInWithEmailAndPassword, 
            createUserWithEmailAndPassword, signOut 
        } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

        // ==================== CONFIGURATION ====================
        const CONFIG = {
            firebase: {
                apiKey: "AIzaSyDY7rPoNA6MzVKHE6obBj-tr4HMUpIdOPI",
                authDomain: "bookkeeping-211e6.firebaseapp.com",
                projectId: "bookkeeping-211e6",
                storageBucket: "bookkeeping-211e6.firebasestorage.app",
                messagingSenderId: "572507957762",
                appId: "1:572507957762:web:1537249285d8af025d151b"
            },
            defaults: {
                currency: 'GHS (₵)',
                currencySymbol: '₵'
            }
        };

        // ==================== FIREBASE INITIALIZATION ====================
        const DATABASE_NAME = localStorage.getItem('selectedFirebaseProject') || 'tempbd2';
        const firebaseApp = initializeApp(CONFIG.firebase);
        const db = getFirestore(firebaseApp, DATABASE_NAME);
        const auth = getAuth(firebaseApp);

        // Initialize Secondary App (for creating users without logging them in)
        const secondaryApp = initializeApp(CONFIG.firebase, 'Secondary');
        const secondaryAuth = getAuth(secondaryApp);

        enableIndexedDbPersistence(db, { synchronizeTabs: true })
            .catch(err => console.warn('Persistence:', err.code));

        // ==================== STATE MANAGEMENT ====================
        class AppState {
            constructor() {
                this.currentUser = null;
                this.authInitialized = false;
                this.currencySymbol = CONFIG.defaults.currencySymbol;
                this.allProducts = [];
                this.allSales = [];
                this.allExpenses = [];
                this.allCustomers = [];
                this.charts = {};
                this.inventoryCurrentPage = 1;
                this.inventoryItemsPerPage = 10;

                // ADD THESE NEW PROPERTIES
                this.userRole = null; // 'admin' or 'outlet_manager'
                this.assignedOutlet = null; // for outlet managers
                this.allOutlets = [];
                this.currentOutletView = 'main'; // 'main' or outlet_id
                this.managedUsers = [];
            }

            reset() {
                this.allProducts = [];
                this.allSales = [];
                this.allExpenses = [];
                this.allCustomers = [];
                this.allOutlets = []; 
                this.managedUsers = [];
                Object.values(this.charts).forEach(chart => chart?.destroy());
                this.charts = {};


            }
        }

        const state = new AppState();

        // ==================== UTILITY FUNCTIONS ====================
        const Utils = {
            showToast(message, type = 'info') {
                const container = document.getElementById('toast-container');
                const toast = document.createElement('div');
                toast.className = `toast ${type}`;
                
                const icons = {
                    success: 'fa-check-circle',
                    error: 'fa-exclamation-circle',
                    warning: 'fa-exclamation-triangle',
                    info: 'fa-info-circle'
                };
                
                toast.innerHTML = `
                    <i class="fas ${icons[type]} toast-icon"></i>
                    <div>${message}</div>
                `;
                
                container.appendChild(toast);
                setTimeout(() => {
                    toast.style.animation = 'slideOut 0.3s ease-out';
                    setTimeout(() => toast.remove(), 300);
                }, 3000);
            },

            showSpinner() {
                document.getElementById('spinner-overlay').classList.add('active');
            },

            hideSpinner() {
                document.getElementById('spinner-overlay').classList.remove('active');
            },

            formatCurrency(amount) {
                return state.currencySymbol + (amount || 0).toFixed(2);
            },

            debounce(func, wait) {
                let timeout;
                return function(...args) {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func(...args), wait);
                };
            },

            getDateRange(period) {
                const now = new Date();
                let startDate = new Date(0);
                let endDate = now;
                
                switch (period) {
                    case 'day':
                        startDate = new Date(now);
                        startDate.setHours(0, 0, 0, 0);
                        endDate = new Date(now);
                        endDate.setHours(23, 59, 59, 999);
                        break;
                    case 'week':
                        startDate = new Date(now);
                        startDate.setDate(now.getDate() - now.getDay());
                        startDate.setHours(0, 0, 0, 0);
                        break;
                    case 'month':
                        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                        break;
                    case 'quarter':
                        const quarter = Math.floor(now.getMonth() / 3);
                        startDate = new Date(now.getFullYear(), quarter * 3, 1);
                        break;
                    case 'year':
                        startDate = new Date(now.getFullYear(), 0, 1);
                        break;
                }
                
                return {
                    start: startDate.toISOString().split('T')[0],
                    end: endDate.toISOString().split('T')[0]
                };
            },

            exportToCSV(data, filename) {
                const csv = data.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
                const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                link.setAttribute('href', url);
                link.setAttribute('download', filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                this.showToast(`${filename} exported`, 'success');
            },

            generateBarcode() {
                // Generate random 12-digit barcode
                return Math.floor(100000000000 + Math.random() * 900000000000).toString();
            },

            validateEmail(email) {
                const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return re.test(email);
            },

            validatePhone(phone) {
                const re = /^[\d\s\-\+\(\)]+$/;
                return phone.length >= 10 && re.test(phone);
            },

            validatePositiveNumber(value) {
                return !isNaN(value) && parseFloat(value) > 0;
            },

            validatePercentage(value) {
                const num = parseFloat(value);
                return !isNaN(num) && num >= 0 && num <= 100;
            }
        };

        // ==================== FIREBASE SERVICE ====================
        class FirebaseService {
            getUserCollection(name) {
                if (!state.authInitialized || !state.currentUser) {
                    throw new Error('Authentication required');
                }
                return collection(db, name);
            }

            settingsRef() {
                return doc(db, 'settings', 'business');
            }

            async ensureUserData() {
                if (!state.currentUser) return;
                
                const userDocRef = doc(db, 'users', state.currentUser.uid);
                const userDocSnap = await getDoc(userDocRef);
                
                if (!userDocSnap.exists()) {
                    await setDoc(userDocRef, {
                        email: state.currentUser.email,
                        createdAt: new Date().toISOString(),
                        initialized: true
                    });
                    
                    await setDoc(this.settingsRef(), {
                        name: 'My Business',
                        tax: 0,
                        currency: CONFIG.defaults.currency
                    });
                }
            }
    
            async getUserRole() {
                if (!state.currentUser) return { role: 'admin', assignedOutlet: null };
                
                try {
                    const userDoc = await getDoc(doc(db, 'users', state.currentUser.uid));
                    if (userDoc.exists()) {
                        const userData = userDoc.data();
                        
                        
                        state.userRole = userData.role
                        console.log('UserDataRole:', state.userRole);
                        return {
                            role: userData.role || 'admin',
                            assignedOutlet: userData.assignedOutlet || null
                        };
                    }
                    // Default to admin if no user document
                    return { role: 'admin', assignedOutlet: null };
                } catch (error) {
                    console.error('Error getting user role:', error);
                    // Default to admin on error
                    return { role: 'admin', assignedOutlet: null };
                }
            }
            
            getOutletsCollection() {
                return collection(db, 'outlets');
            }
            
            getOutletCollection(outletId) {
                return collection(db, 'outlets', outletId);
            }
            
            getConsignmentsCollection(outletId) {
                return collection(db, 'outlets', outletId, 'consignments');
            }
            
            getSettlementsCollection(outletId) {
                return collection(db, 'outlets', outletId, 'settlements');
            }
        }

        const firebaseService = new FirebaseService();

        // ==================== ACTIVITY LOGGER SERVICE ====================
        class ActivityLogger {
            static async log(action, details) {
                try {
                    const activityData = {
                        action,
                        details,
                        timestamp: new Date().toISOString(),
                        user: state.currentUser?.email || 'Unknown'
                    };
                    
                    await addDoc(firebaseService.getUserCollection('activity_log'), activityData);
                } catch (error) {
                    console.error('Failed to log activity:', error);
                }
            }
            
            static async getRecentActivities(limit = 50) {
                try {
                    const snapshot = await getDocs(
                        query(
                            firebaseService.getUserCollection('activity_log'),
                            orderBy('timestamp', 'desc'),
                            limit(limit)
                        )
                    );
                    
                    const activities = [];
                    snapshot.forEach(doc => {
                        activities.push({ ...doc.data(), id: doc.id });
                    });
                    
                    return activities;
                } catch (error) {
                    console.error('Failed to load activities:', error);
                    return [];
                }
            }
        }

        // ==================== DATA LOADER SERVICE ====================
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
                        const snapshot = await getDocs(inventoryRef);
                        
                        snapshot.forEach(doc => {
                            state.allProducts.push({
                                id: doc.id,
                                ...doc.data()
                            });
                        });
                        
                        console.log('✓ Loaded outlet products:', state.allProducts.length);
                        
                    } else {
                        // ADMIN: Load from main inventory
                        console.log('📦 Loading main inventory from:', `users/${state.currentUser.uid}/inventory`);
                        
                        const productsRef = collection(db, 'inventory');
                        const snapshot = await getDocs(productsRef);
                        
                        snapshot.forEach(doc => {
                            state.allProducts.push({
                                id: doc.id,
                                ...doc.data()
                            });
                        });
                        
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
                        const snapshot = await getDocs(salesRef);
                        
                        snapshot.forEach(doc => {
                            state.allSales.push({
                                id: doc.id,
                                ...doc.data()
                            });
                        });
                        
                        console.log('✓ Loaded outlet sales:', state.allSales.length);
                        
                    } else {
                        // ADMIN: Load from main sales
                        console.log('💰 Loading main sales from:', `users/${state.currentUser.uid}/sales`);
                        
                        const salesRef = collection(db, 'sales');
                        const snapshot = await getDocs(salesRef);
                        
                        snapshot.forEach(doc => {
                            state.allSales.push({
                                id: doc.id,
                                ...doc.data()
                            });
                        });
                        
                        console.log('✓ Loaded main sales:', state.allSales.length);
                    }
                    
                } catch (error) {
                    console.error('❌ Error loading sales:', error);
                }
            }

            async loadExpenses() {
                try {
                    const snapshot = await getDocs(
                        query(firebaseService.getUserCollection('expenses'), orderBy('date', 'desc'))
                    );
                    state.allExpenses = [];
                    snapshot.forEach(doc => {
                        state.allExpenses.push({ ...doc.data(), id: doc.id });
                    });
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

            async loadOutlets() {
                try {
                    const snapshot = await getDocs(firebaseService.getOutletsCollection());
                    state.allOutlets = [];
                    
                    for (const outletDoc of snapshot.docs) {
                        const outletData = { ...outletDoc.data(), id: outletDoc.id };
                        


                        // Load outlet inventory
                        const inventorySnapshot = await getDocs(
                            collection(db, 'users', state.currentUser.uid, 'outlets', outletDoc.id, 'inventory')
                        );
                        let inventoryValue = 0;
                        inventorySnapshot.forEach(doc => {
                            const item = doc.data();
                            inventoryValue += (item.quantity || 0) * (item.cost || 0);
                        });
                        outletData.inventoryValue = inventoryValue;
                        
                        state.allOutlets.push(outletData);
                    }
                    console.log("Outlets: ", state.allOutlets)
                    
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
                            this.loadCustomers()
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
                            this.loadOutlets()
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

        const dataLoader = new DataLoaderService();
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
                            <table id="recent-activity">
                                <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </section>
                `;
            }

            static buildSalesSection() {
                return `
                    <section id="sales">
                        <div class="card">
                            <button id="export-sales-btn" class="mb-2"><i class="fas fa-download"></i> Export CSV</button>
                            <button id="add-sale-btn" class="mb-2"><i class="fas fa-plus"></i> Add Sale</button>
                            <button id="bulk-sale-btn" class="mb-2" style="background: #28a745;"><i class="fas fa-shopping-basket"></i> Bulk Purchase</button>
                            <button id="invoice-btn" class="mb-2"><i class="fas fa-file-invoice"></i> Generate Invoice</button>
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

                            <div id="inventory-pagination" class="pagination"></div>
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
                        
                        <div class="analytics-grid">
                            <div class="analytics-card">
                                <h3>Daily Revenue Trend (30 Days)</h3>
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
                                <h3>Expenses Breakdown</h3>
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

            static buildForecastingSection() {
                return `
                    <section id="forecasting">
                        <div class="card">
                            <h2><i class="fas fa-chart-line"></i> Sales Forecasting</h2>
                        </div>
                        
                        <div class="forecast-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; border-radius: 8px; margin-bottom: 1.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                            <h3>Next Month Forecast</h3>
                            <div class="forecast-value" id="next-month-forecast" style="font-size: 2rem; font-weight: bold; margin: 1rem 0;">₵0.00</div>
                            <small>Based on historical trends</small>
                        </div>
                        
                        <div class="forecast-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 2rem; border-radius: 8px; margin-bottom: 1.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                            <h3>Next Quarter Forecast</h3>
                            <div class="forecast-value" id="next-quarter-forecast" style="font-size: 2rem; font-weight: bold; margin: 1rem 0;">₵0.00</div>
                            <small>Projected revenue for next 3 months</small>
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-chart-area"></i> Trend Analysis</h3>
                            <canvas id="forecast-trend-chart"></canvas>
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
                        
                        <div class="card">
                            <h3><i class="fas fa-users"></i> Customer Database</h3>
                            <div class="filters">
                                <input type="text" id="customer-search" placeholder="🔍 Search customers">
                            </div>
                            <table id="customers-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Email</th>
                                        <th>Phone</th>
                                        <th>Total Purchases</th>
                                        <th>Last Purchase</th>
                                        <th>Actions</th>
                                        </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
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
                        </div>
                        
                        <div id="outlets-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
                            <!-- Outlet cards will be rendered here -->
                        </div>
                        
                        <div class="card">
                            <h3><i class="fas fa-list"></i> All Outlets</h3>
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
                            
                            <div style="max-height: 400px; overflow-y: auto;">
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

            static buildAllSections() {
                return `
                    ${this.buildDashboardSection()}
                    ${this.buildSalesSection()}
                    ${this.buildInventorySection()}
                    ${this.buildAnalyticsSection()}
                    ${this.buildExpensesSection()}
                    ${this.buildAccountingSection()}
                    ${this.buildForecastingSection()}
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
        // ==================== APPLICATION CONTROLLER ====================
        class AppController {
            constructor() {
                this.currentInvoiceData = null;
                this.initializeUI();
                this.setupEventListeners();
                this.setupAuthObserver();
            }

            initializeUI() {
                document.getElementById('sections-container').innerHTML = TemplateBuilder.buildAllSections();
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
                    const debouncedRender = Utils.debounce(() => this.renderExpenses(), 300);
                    expenseDateFilter.addEventListener('change', debouncedRender);
                    if (expenseSearch) expenseSearch.addEventListener('input', debouncedRender);
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
                    const debouncedRender = Utils.debounce(() => this.renderCustomers(), 300);
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
                    recordPaymentForm.addEventListener('submit', (e) => this.handleRecordPayment(e));
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
                        state.currentUser = user;
                        state.authInitialized = true;
                        
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
                       await dataLoader.loadAll();
                        
                        // Apply role-based restrictions
                        this.applyRoleBasedUI();
                        
                        this.showSection('dashboard');
                        //this.renderDashboard();
                        
                        Utils.hideSpinner();
                    } else {
                        state.currentUser = null;
                        state.authInitialized = true;

                        state.userRole = null;
                        state.assignedOutlet = null;
                        state.authInitialized = true;
                        this.showLoginUI();
                        state.reset();
                        
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

            showSection(sectionName) {
                document.querySelectorAll('section').forEach(s => s.style.display = 'none');
                document.querySelectorAll('nav li').forEach(li => li.classList.remove('active'));
                
                const section = document.getElementById(sectionName);
                const navItem = document.querySelector(`nav li[data-section="${sectionName}"]`);
                
                if (section) section.style.display = 'block';
                if (navItem) navItem.classList.add('active');
                
                // Render content based on section
                switch(sectionName) {
                    case 'dashboard':
                        this.renderDashboard();
                        break;
                    case 'sales':
                        this.renderSales();
                        break;
                    case 'inventory':
                        this.renderInventoryTable();
                        break;
                    case 'outlets':
                       if (state.userRole === 'admin') {
                            this.renderOutlets();
                        }
                        break;
                    case 'forecasting':
                        if (state.userRole === 'admin') {
                            this.renderForecasting()
                        }
                        break;
                    case 'accounting':
                        if (state.userRole === 'admin') {
                            this.renderAccounting();
                        }
                        break;
                    case 'consignments':
                        this.renderConsignments();
                        break;
                    case 'settlements':
                        this.renderSettlements();
                        break;
                    case 'expenses':
                        this.renderExpenses();
                        break;
                    case 'customers':
                        this.renderCustomers();
                        break;
                    case 'analytics':
                        this.renderAnalytics();
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

            applyRoleBasedUI() {
                const roleDisplay = document.getElementById('user-role-display');
                if (state.userRole === 'outlet_manager' && state.assignedOutlet) {
                    // Show outlet manager badge
                    const outlet = state.allOutlets.find(o => o.id === state.assignedOutlet);
                    if (roleDisplay) {
                        roleDisplay.innerHTML = `
                            <span class="role-badge" style="background: #6f42c1;">Outlet Manager</span> 
                            <span class="location-badge">${outlet?.name || 'Unknown Outlet'}</span>
                        `;
                    }
                    
                    // Hide admin-only sections (CONSIGNMENTS REMOVED FROM LIST)
                    const restrictedSections = [
                        'outlets',           // Can't manage outlets
                        'expenses',          // Can't manage expenses
                        'accounting',        // Can't view accounting
                        'forecasting',       // Can't view forecasting
                        'loans',             // Can't manage loans
                        'user-management'    // Can't manage users
                    ];
                    
                    restrictedSections.forEach(section => {
                        const navItem = document.querySelector(`nav li[data-section="${section}"]`);
                        if (navItem) {
                            navItem.style.display = 'none';
                        }
                    });
                    
                    // Update consignments nav text to clarify it's for receiving
                    const consignmentsNav = document.querySelector('nav li[data-section="consignments"]');
                    if (consignmentsNav) {
                        consignmentsNav.innerHTML = '<i class="fas fa-truck"></i> Receive Consignments';
                    }
                    
                    // Rename settlements to "My Settlements"
                    const settlementsNav = document.querySelector('nav li[data-section="settlements"]');
                    if (settlementsNav) {
                        settlementsNav.innerHTML = '<i class="fas fa-file-invoice-dollar"></i> My Settlements';
                    }
                    
                    // Hide admin-specific buttons
                    const sendConsignmentBtn = document.getElementById('send-consignment-btn');
                    if (sendConsignmentBtn) sendConsignmentBtn.style.display = 'none';
                    
                    const generateSettlementBtn = document.getElementById('generate-settlement-btn');
                    if (generateSettlementBtn) generateSettlementBtn.style.display = 'none';
                    
                    const addProductBtn = document.getElementById('add-product-btn');
                    if (addProductBtn) addProductBtn.style.display = 'none';
                    
                    console.log('✓ Outlet Manager restrictions applied (Consignments visible for receiving)');
                    this.renderConsignments();
                }else if (state.userRole === 'admin') {
                    // Show admin badge
                    if (roleDisplay) {
                        roleDisplay.innerHTML = `<span class="role-badge" style="background: #dc3545;">Admin</span>`;
                    }
                    
                    // Show all sections
                    document.querySelectorAll('nav li').forEach(item => {
                        item.style.display = 'block';
                    });
                } else {
                    // Default to admin if role not set
                    state.userRole = 'admin';
                    if (roleDisplay) {
                        roleDisplay.innerHTML = `<span class="role-badge" style="background: #dc3545;">Admin</span>`;
                    }
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
                onSnapshot(firebaseService.getUserCollection('inventory'), () => {
                    dataLoader.loadProducts().then(() => {
                        this.renderInventoryTable();
                        this.renderDashboard();
                        this.checkLowStockAndNotify();
                        this.renderOutlets();
                        this.renderConsignments();
                        this.renderActivityLog();
                        this.renderSettlements();
                        if (state.userRole === 'admin') {
                            this.renderUsers();
                        }
                    });
                });
                
                onSnapshot(firebaseService.getUserCollection('sales'), () => {
                    dataLoader.loadSales().then(() => {
                        this.renderSales();
                        this.renderDashboard();
                    });
                });
                
                onSnapshot(firebaseService.getUserCollection('expenses'), () => {
                    dataLoader.loadExpenses().then(() => {
                        this.renderDashboard();
                    });
                });

                onSnapshot(firebaseService.getUserCollection('customers'), () => {
                    dataLoader.loadCustomers().then(() => {
                        this.renderCustomers();
                    });
                });
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
                    const barcodeInput = document.getElementById('product-barcode-input');
                    const barcode = barcodeInput?.value || Utils.generateBarcode();

                    const productData = {
                        name: document.getElementById('product-name').value,
                        category: document.getElementById('product-category').value,
                        cost: parseFloat(document.getElementById('product-cost').value),
                        price: parseFloat(document.getElementById('product-price').value),
                        quantity: parseInt(document.getElementById('product-quantity').value),
                        minStock: parseInt(document.getElementById('product-min-stock').value),
                        barcode: barcode,
                        createdAt: new Date().toISOString()
                    };
                    
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
                        minStock: parseInt(document.getElementById('edit-product-min-stock').value),
                        updatedAt: new Date().toISOString()
                    };
                    
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
                            <svg id="barcode-${product.id}"></svg>
                        `;
                        container.appendChild(itemDiv);
                        
                        // Generate barcode
                        printWindow.JsBarcode(`#barcode-${product.id}`, product.barcode, {
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
                                <button onclick="appController.editProduct('${product.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                <button class="danger" onclick="appController.deleteProduct('${product.id}')" title="Delete"><i class="fas fa-trash"></i></button>
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
                
                const searchQuery = query.toLowerCase().trim();
                
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
                
                const searchQuery = query.toLowerCase().trim();
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
                    
                    // Reload data
                    await dataLoader.loadAll();
                    this.renderSales();
                    this.renderInventoryTable();
                    
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
                    this.renderSales();
                    this.renderInventoryTable();
                    
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
                    this.renderSales();
                    this.renderInventoryTable();
                    
                } catch (error) {
                    console.error('❌ Error editing sale:', error);
                    Utils.showToast('Failed to update sale: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            editSale(saleId) {
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
                    
                    console.log('Deleting sale with paths:', paths);
                    
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
                    this.renderSales();
                    this.renderInventoryTable();
                    
                } catch (error) {
                    console.error('❌ Error deleting sale:', error);
                    Utils.showToast('Failed to delete sale: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            renderSales() {
                const container = document.getElementById('sales-list');
                if (!container) return;
                
                container.innerHTML = '';
                
                const dateFilter = document.getElementById('sales-date-filter')?.value || 'all';
                const customerSearch = document.getElementById('sales-customer-search')?.value.toLowerCase() || '';
                const productSearch = document.getElementById('sales-product-search-table')?.value.toLowerCase() || '';
                
                let filteredSales = [...state.allSales];
                
                if (dateFilter !== 'all') {
                    const { start, end } = Utils.getDateRange(dateFilter === 'today' ? 'day' : dateFilter);
                    filteredSales = filteredSales.filter(s => s.date >= start && s.date <= end);
                }
                
                if (customerSearch) {
                    filteredSales = filteredSales.filter(s => 
                        s.customer.toLowerCase().includes(customerSearch)
                    );
                }
                
                if (productSearch) {
                    filteredSales = filteredSales.filter(s => 
                        s.product.toLowerCase().includes(productSearch)
                    );
                }
                
                const grouped = {};
                filteredSales.forEach(sale => {
                    if (!grouped[sale.date]) grouped[sale.date] = [];
                    grouped[sale.date].push(sale);
                });
                
                Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a)).forEach(date => {
                    const sales = grouped[date];
                    
                    let dailyRevenue = 0;
                    let dailyCost = 0;
                    
                    sales.forEach(sale => {
                        const subtotal = sale.quantity * sale.price;
                        const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                        const revenue = discounted * (1 + (sale.tax || 0) / 100);
                        dailyRevenue += revenue;
                        
                        const product = state.allProducts.find(p => p.name === sale.product);
                        if (product) {
                            dailyCost += sale.quantity * product.cost;
                        }
                    });
                    
                    const dailyProfit = dailyRevenue - dailyCost;
                    
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
                            <i class="fas fa-chevron-down toggle-icon"></i>
                        </div>
                        <div class="sales-group-content">
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
                                        const subtotal = sale.quantity * sale.price;
                                        const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                                        const total = discounted * (1 + (sale.tax || 0) / 100);
                                        return `
                                            <tr>
                                                <td>${sale.customer}</td>
                                                <td>${sale.product}</td>
                                                <td>${sale.quantity}</td>
                                                <td>${Utils.formatCurrency(sale.price)}</td>
                                                <td>${Utils.formatCurrency(total)}</td>
                                                <td class="actions">
                                                    <button onclick="appController.printReceipt('${sale.id}')" title="Print Receipt"><i class="fas fa-print"></i></button>
                                                    <button onclick="appController.editSale('${sale.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                                    <button class="danger" onclick="appController.deleteSale('${sale.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                    
                    container.appendChild(group);
                });
                
                if (Object.keys(grouped).length === 0) {
                    container.innerHTML = '<div class="no-data">No sales found</div>';
                }
            }
            async handleAddExpense(e) {
                e.preventDefault();
                Utils.showSpinner();
                
                try {
                    const expenseData = {
                        date: document.getElementById('expense-date').value,
                        description: document.getElementById('expense-description').value,
                        category: document.getElementById('expense-category').value,
                        amount: parseFloat(document.getElementById('expense-amount').value),
                        createdAt: new Date().toISOString()
                    };
                    
                    await addDoc(firebaseService.getUserCollection('expenses'), expenseData);
                    await ActivityLogger.log('Expense Added', `Added expense: ${expenseData.description}`);
                    
                    Utils.showToast('Expense added successfully', 'success');
                    document.getElementById('add-expense-modal').style.display = 'none';
                    document.getElementById('add-expense-form').reset();
                } catch (error) {
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
                    await deleteDoc(doc(firebaseService.getUserCollection('expenses'), expenseId));
                    await ActivityLogger.log('Expense Deleted', `Deleted expense: ${expense?.description || 'Unknown'}`);
                    
                    Utils.showToast('Expense deleted successfully', 'success');
                } catch (error) {
                    Utils.showToast('Failed to delete expense: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            renderExpenses() {
                const tbody = document.querySelector('#expenses-table tbody');
                if (!tbody) return;
                
                tbody.innerHTML = '';
                
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
                    return;
                }
                
                filtered.forEach(expense => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${expense.date}</td>
                        <td>${expense.description}</td>
                        <td>${expense.category}</td>
                        <td>${Utils.formatCurrency(expense.amount)}</td>
                        <td class="actions">
                            <button class="danger" onclick="appController.deleteExpense('${expense.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
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
                const tbody = document.querySelector('#customers-table tbody');
                if (!tbody) return;
                
                tbody.innerHTML = '';
                
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
                
                filtered.forEach(customer => {
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
                            <button onclick="appController.editCustomer('${customer.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                            <button class="danger" onclick="appController.deleteCustomer('${customer.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            }

            renderDashboard() {
                console.log('=== RENDERING DASHBOARD ===');
                console.log('User role:', state.userRole);
                console.log('Sales:', state.allSales.length);
                console.log('Expenses:', state.allExpenses.length);
                console.log('Products:', state.allProducts.length);
                
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
                    console.log('Calculating metrics for outlet manager');
                    
                    // Outlet managers typically don't manage expenses centrally
                    // Expenses are handled by main shop
                    expensesTotal = 0;
                    
                    // Profit for outlet = Sales Revenue - COGS
                    // (Commission is paid to main shop, not an expense for the outlet)
                    const grossProfit = salesTotal - totalCOGS;
                    profit = grossProfit;
                    
                    console.log('Sales Total:', salesTotal);
                    console.log('COGS:', totalCOGS);
                    console.log('Gross Profit:', grossProfit);
                    
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
                        
                        console.log('Outlet Commission:', outletCommission);
                        console.log('Main Shop Share:', mainShopShare);
                        
                        // You could add additional metrics here:
                        this.updateElement('outlet-commission', Utils.formatCurrency(outletCommission));
                        this.updateElement('main-shop-share', Utils.formatCurrency(mainShopShare));
                    }
                    
                } else {
                    // ═══════════════════════════════════════════════════════════
                    // ADMIN: Show all metrics including expenses
                    // ═══════════════════════════════════════════════════════════
                    console.log('Calculating metrics for admin');
                    
                    const filteredExpenses = state.allExpenses.filter(e => e.date >= start && e.date <= end);
                    expensesTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
                    
                    // Profit for admin = Sales Revenue - COGS - Operating Expenses
                    profit = salesTotal - totalCOGS - expensesTotal;
                    
                    console.log('Sales Total:', salesTotal);
                    console.log('COGS:', totalCOGS);
                    console.log('Expenses:', expensesTotal);
                    console.log('Net Profit:', profit);
                    
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
                    // ADMIN: Profit = Revenue - COGS - Expenses
                    const filteredExpenses = state.allExpenses.filter(e => e.date >= start && e.date <= end);
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
                
                const today = new Date();
                const last30Days = [];
                const revenueData = [];
                
                for (let i = 29; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(date.getDate() - i);
                    const dateStr = date.toISOString().split('T')[0];
                    last30Days.push(dateStr);
                    
                    const daySales = state.allSales.filter(s => s.date === dateStr);
                    const dayRevenue = daySales.reduce((sum, s) => {
                        const subtotal = s.quantity * s.price;
                        const discounted = subtotal * (1 - (s.discount || 0) / 100);
                        return sum + discounted * (1 + (s.tax || 0) / 100);
                    }, 0);
                    revenueData.push(dayRevenue);
                }
                
                const ctx = canvas.getContext('2d');
                state.charts.dailyRevenue = new Chart(ctx, {
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
                if (!canvas) return;
                
                if (state.charts.profitAnalysis) {
                    state.charts.profitAnalysis.destroy();
                }
                
                const totalRevenue = state.allSales.reduce((sum, s) => {
                    const subtotal = s.quantity * s.price;
                    const discounted = subtotal * (1 - (s.discount || 0) / 100);
                    return sum + discounted * (1 + (s.tax || 0) / 100);
                }, 0);
                
                const totalCOGS = state.allSales.reduce((sum, s) => {
                    const product = state.allProducts.find(p => p.name === s.product);
                    return sum + (product ? s.quantity * product.cost : 0);
                }, 0);
                
                const totalExpenses = state.allExpenses.reduce((sum, e) => sum + e.amount, 0);
                const grossProfit = totalRevenue - totalCOGS;
                const netProfit = grossProfit - totalExpenses;
                
                const ctx = canvas.getContext('2d');
                state.charts.profitAnalysis = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['Revenue', 'COGS', 'Gross Profit', 'Expenses', 'Net Profit'],
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
                
                state.allExpenses.forEach(expense => {
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
                                label: 'Expenses',
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
                
                const categoryExpenses = {};
                state.allExpenses.forEach(expense => {
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
                let filteredExpenses = state.allExpenses;
                
                if (cutoffDate) {
                    filteredSales = state.allSales.filter(s => s.date >= cutoffDate);
                    filteredExpenses = state.allExpenses.filter(e => e.date >= cutoffDate);
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
                        labels: ['Revenue', 'COGS', 'Gross Profit', 'Expenses', 'Net Profit'],
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
                let filteredExpenses = state.allExpenses;
                
                if (cutoffDate) {
                    filteredSales = state.allSales.filter(s => s.date >= cutoffDate);
                    filteredExpenses = state.allExpenses.filter(e => e.date >= cutoffDate);
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
                                label: 'Expenses',
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
                    'Total Expenses': Utils.formatCurrency(totalExpenses),
                    'Total Profit': Utils.formatCurrency(totalProfit),
                    'Avg Monthly Revenue': Utils.formatCurrency(avgMonthlyRevenue),
                    'Avg Monthly Profit': Utils.formatCurrency(avgMonthlyProfit),
                    'Number of Months': months.length
                });
            }

            renderExpandedExpensesBreakdown(canvas, days) {
                const cutoffDate = days ? this.getDateDaysAgo(days) : null;
                
                let filteredExpenses = state.allExpenses;
                if (cutoffDate) {
                    filteredExpenses = state.allExpenses.filter(e => e.date >= cutoffDate);
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
                const inventoryValue = state.allProducts.reduce((sum, p) => sum + (p.quantity * p.cost), 0);
                const totalRevenue = state.allSales.reduce((sum, s) => {
                    const subtotal = s.quantity * s.price;
                    const discounted = subtotal * (1 - (s.discount || 0) / 100);
                    return sum + discounted * (1 + (s.tax || 0) / 100);
                }, 0);
                const totalExpenses = state.allExpenses.reduce((sum, e) => sum + e.amount, 0);
                const cashBalance = totalRevenue - totalExpenses;
                const totalAssets = cashBalance + inventoryValue;
                const totalLiabilities = 0;
                const totalEquity = totalAssets - totalLiabilities;
                const cashFlow = cashBalance;
                
                this.updateElement('total-assets', Utils.formatCurrency(totalAssets));
                this.updateElement('total-liabilities', Utils.formatCurrency(totalLiabilities));
                this.updateElement('total-equity', Utils.formatCurrency(totalEquity));
                this.updateElement('cash-flow', Utils.formatCurrency(cashFlow));
                
                const totalTaxCollected = state.allSales.reduce((sum, s) => {
                    const subtotal = s.quantity * s.price;
                    const discounted = subtotal * (1 - (s.discount || 0) / 100);
                    const taxAmount = discounted * (s.tax || 0) / 100;
                    return sum + taxAmount;
                }, 0);
                
                this.updateElement('tax-collected', Utils.formatCurrency(totalTaxCollected));
                this.updateElement('tax-payable', Utils.formatCurrency(totalTaxCollected));
            }

            generateIncomeStatement() {
                const period = prompt('Enter period (e.g., "January 2025" or "2025"):', 
                    new Date().toLocaleString('default', { month: 'long', year: 'numeric' }));
                if (!period) return;
                
                const totalRevenue = state.allSales.reduce((sum, s) => {
                    const subtotal = s.quantity * s.price;
                    const discounted = subtotal * (1 - (s.discount || 0) / 100);
                    return sum + discounted * (1 + (s.tax || 0) / 100);
                }, 0);
                
                const totalCOGS = state.allSales.reduce((sum, s) => {
                    const product = state.allProducts.find(p => p.name === s.product);
                    return sum + (product ? s.quantity * product.cost : 0);
                }, 0);
                
                const grossProfit = totalRevenue - totalCOGS;
                const operatingExpenses = state.allExpenses.reduce((sum, e) => sum + e.amount, 0);
                const netIncome = grossProfit - operatingExpenses;
                
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
                        </style>
                    </head>
                    <body>
                        <h1>Income Statement</h1>
                        <h2>${period}</h2>
                        <table>
                            <tr>
                                <th>Item</th>
                                <th class="amount">Amount</th>
                            </tr>
                            <tr>
                                <td>Revenue</td>
                                <td class="amount">${Utils.formatCurrency(totalRevenue)}</td>
                            </tr>
                            <tr>
                                <td>Cost of Goods Sold</td>
                                <td class="amount">(${Utils.formatCurrency(totalCOGS)})</td>
                            </tr>
                            <tr class="total-row">
                                <td>Gross Profit</td>
                                <td class="amount">${Utils.formatCurrency(grossProfit)}</td>
                            </tr>
                            <tr>
                                <td>Operating Expenses</td>
                                <td class="amount">(${Utils.formatCurrency(operatingExpenses)})</td>
                                </tr>
                            <tr class="total-row">
                                <td>Net Income</td>
                                <td class="amount ${netIncome >= 0 ? 'positive' : 'negative'}">
                                    ${Utils.formatCurrency(netIncome)}
                                </td>
                            </tr>
                        </table>
                        <p style="text-align: center; margin-top: 40px; color: #666;">
                            Generated on ${new Date().toLocaleDateString()}
                        </p>
                    </body>
                    </html>
                `;
                
                const printWindow = window.open('', '_blank');
                printWindow.document.write(reportHTML);
                printWindow.document.close();
                Utils.showToast('Income statement generated', 'success');
            }

            generateBalanceSheet() {
                const inventoryValue = state.allProducts.reduce((sum, p) => sum + (p.quantity * p.cost), 0);
                const totalRevenue = state.allSales.reduce((sum, s) => {
                    const subtotal = s.quantity * s.price;
                    const discounted = subtotal * (1 - (s.discount || 0) / 100);
                    return sum + discounted * (1 + (s.tax || 0) / 100);
                }, 0);
                const totalExpenses = state.allExpenses.reduce((sum, e) => sum + e.amount, 0);
                const cash = totalRevenue - totalExpenses;
                const totalAssets = cash + inventoryValue;
                const totalLiabilities = 0;
                const totalEquity = totalAssets - totalLiabilities;
                
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
                            .total-row { font-weight: bold; background: #f8f9fa; }
                            .amount { text-align: right; }
                            .indent { padding-left: 30px; }
                        </style>
                    </head>
                    <body>
                        <h1>Balance Sheet</h1>
                        <h2>As of ${new Date().toLocaleDateString()}</h2>
                        <table>
                            <tr class="section-header">
                                <td colspan="2">ASSETS</td>
                            </tr>
                            <tr>
                                <td class="indent">Cash</td>
                                <td class="amount">${Utils.formatCurrency(cash)}</td>
                            </tr>
                            <tr>
                                <td class="indent">Inventory</td>
                                <td class="amount">${Utils.formatCurrency(inventoryValue)}</td>
                            </tr>
                            <tr class="total-row">
                                <td>Total Assets</td>
                                <td class="amount">${Utils.formatCurrency(totalAssets)}</td>
                            </tr>
                            <tr><td colspan="2">&nbsp;</td></tr>
                            <tr class="section-header">
                                <td colspan="2">LIABILITIES</td>
                            </tr>
                            <tr>
                                <td class="indent">Accounts Payable</td>
                                <td class="amount">${Utils.formatCurrency(0)}</td>
                            </tr>
                            <tr class="total-row">
                                <td>Total Liabilities</td>
                                <td class="amount">${Utils.formatCurrency(totalLiabilities)}</td>
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
                                <td>Total Equity</td>
                                <td class="amount">${Utils.formatCurrency(totalEquity)}</td>
                            </tr>
                            <tr><td colspan="2">&nbsp;</td></tr>
                            <tr class="total-row">
                                <td>Total Liabilities & Equity</td>
                                <td class="amount">${Utils.formatCurrency(totalLiabilities + totalEquity)}</td>
                            </tr>
                        </table>
                        <p style="text-align: center; margin-top: 40px; color: #666;">
                            Generated on ${new Date().toLocaleDateString()}
                        </p>
                    </body>
                    </html>
                `;
                
                const printWindow = window.open('', '_blank');
                printWindow.document.write(reportHTML);
                printWindow.document.close();
                Utils.showToast('Balance sheet generated', 'success');
            }

            generateCashflowStatement() {
                const monthlyData = {};
                
                state.allSales.forEach(sale => {
                    const month = sale.date.substring(0, 7);
                    if (!monthlyData[month]) {
                        monthlyData[month] = { operating: 0, investing: 0, financing: 0 };
                    }
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    const total = discounted * (1 + (sale.tax || 0) / 100);
                    monthlyData[month].operating += total;
                });
                
                state.allExpenses.forEach(expense => {
                    const month = expense.date.substring(0, 7);
                    if (!monthlyData[month]) {
                        monthlyData[month] = { operating: 0, investing: 0, financing: 0 };
                    }
                    monthlyData[month].operating -= expense.amount;
                });
                
                const months = Object.keys(monthlyData).sort();
                let runningBalance = 0;
                
                const rowsHTML = months.map(month => {
                    const data = monthlyData[month];
                    const netCashFlow = data.operating + data.investing + data.financing;
                    runningBalance += netCashFlow;
                    
                    return `
                        <tr>
                            <td>${new Date(month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</td>
                            <td class="amount">${Utils.formatCurrency(data.operating)}</td>
                            <td class="amount">${Utils.formatCurrency(data.investing)}</td>
                            <td class="amount">${Utils.formatCurrency(data.financing)}</td>
                            <td class="amount">${Utils.formatCurrency(netCashFlow)}</td>
                            <td class="amount">${Utils.formatCurrency(runningBalance)}</td>
                        </tr>
                    `;
                }).join('');
                
                const reportHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Cash Flow Statement</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 40px; }
                            h1 { text-align: center; color: #007bff; }
                            h2 { text-align: center; color: #666; margin-bottom: 30px; }
                            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                            th { background: #f8f9fa; font-weight: bold; }
                            .amount { text-align: right; }
                        </style>
                    </head>
                    <body>
                        <h1>Cash Flow Statement</h1>
                        <h2>All Periods</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>Period</th>
                                    <th class="amount">Operating</th>
                                    <th class="amount">Investing</th>
                                    <th class="amount">Financing</th>
                                    <th class="amount">Net Cash Flow</th>
                                    <th class="amount">Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHTML}
                            </tbody>
                        </table>
                        <p style="text-align: center; margin-top: 40px; color: #666;">
                            Generated on ${new Date().toLocaleDateString()}
                        </p>
                    </body>
                    </html>
                `;
                
                const printWindow = window.open('', '_blank');
                printWindow.document.write(reportHTML);
                printWindow.document.close();
                Utils.showToast('Cash flow statement generated', 'success');
            }

            renderForecasting() {
                const monthlyRevenues = {};
                
                state.allSales.forEach(sale => {
                    const month = sale.date.substring(0, 7);
                    if (!monthlyRevenues[month]) {
                        monthlyRevenues[month] = 0;
                    }
                    const subtotal = sale.quantity * sale.price;
                    const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                    monthlyRevenues[month] += discounted * (1 + (sale.tax || 0) / 100);
                });
                
                const revenues = Object.values(monthlyRevenues);
                const avgMonthlyRevenue = revenues.length > 0 
                    ? revenues.reduce((a, b) => a + b, 0) / revenues.length 
                    : 0;
                
                let trend = 0;
                if (revenues.length >= 2) {
                    const recentRevenues = revenues.slice(-3);
                    const olderRevenues = revenues.slice(-6, -3);
                    const recentAvg = recentRevenues.reduce((a, b) => a + b, 0) / recentRevenues.length;
                    const olderAvg = olderRevenues.length > 0 
                        ? olderRevenues.reduce((a, b) => a + b, 0) / olderRevenues.length 
                        : recentAvg;
                    trend = recentAvg - olderAvg;
                }
                
                const nextMonthForecast = avgMonthlyRevenue + trend;
                const nextQuarterForecast = (avgMonthlyRevenue + trend) * 3;
                
                this.updateElement('next-month-forecast', Utils.formatCurrency(Math.max(0, nextMonthForecast)));
                this.updateElement('next-quarter-forecast', Utils.formatCurrency(Math.max(0, nextQuarterForecast)));
                
                this.renderForecastTrendChart(monthlyRevenues);
                this.renderInventoryAlerts();
            }

            renderForecastTrendChart(monthlyRevenues) {
                const canvas = document.getElementById('forecast-trend-chart');
                if (!canvas) return;
                
                if (state.charts.forecastTrend) {
                    state.charts.forecastTrend.destroy();
                }
                
                const months = Object.keys(monthlyRevenues).sort();
                const revenues = months.map(m => monthlyRevenues[m]);
                
                if (months.length === 0) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.font = '14px Roboto';
                    ctx.fillStyle = '#888';
                    ctx.textAlign = 'center';
                    ctx.fillText('Not enough data for forecast', canvas.width / 2, canvas.height / 2);
                    return;
                }
                
                const n = revenues.length;
                let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
                
                revenues.forEach((y, x) => {
                    sumX += x;
                    sumY += y;
                    sumXY += x * y;
                    sumX2 += x * x;
                });
                
                const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
                const intercept = (sumY - slope * sumX) / n;
                
                const forecastMonths = [];
                const forecastValues = [];
                
                for (let i = 1; i <= 3; i++) {
                    const lastDate = new Date(months[months.length - 1]);
                    lastDate.setMonth(lastDate.getMonth() + i);
                    forecastMonths.push(lastDate.toISOString().substring(0, 7));
                    forecastValues.push(Math.max(0, slope * (n + i - 1) + intercept));
                }
                
                const allMonths = [...months, ...forecastMonths];
                
                const ctx = canvas.getContext('2d');
                state.charts.forecastTrend = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: allMonths.map(m => new Date(m).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })),
                        datasets: [
                            {
                                label: 'Actual Revenue',
                                data: [...revenues, ...Array(3).fill(null)],
                                borderColor: '#007bff',
                                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                                tension: 0.4,
                                fill: true
                            },
                            {
                                label: 'Forecast',
                                data: [...Array(n).fill(null), ...forecastValues],
                                borderColor: '#28a745',
                                backgroundColor: 'rgba(40, 167, 69, 0.1)',
                                borderDash: [5, 5],
                                tension: 0.4,
                                fill: true
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: (context) => `${context.dataset.label}: ${Utils.formatCurrency(context.parsed.y || 0)}`
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

            async loadSettings() {
                try {
                    const settingsDoc = await getDoc(firebaseService.settingsRef());
                    if (settingsDoc.exists()) {
                        const settings = settingsDoc.data();
                        document.getElementById('business-name').value = settings.name || '';
                        document.getElementById('default-tax').value = settings.tax || 0;
                        document.getElementById('currency-select').value = settings.currency || 'GHS (₵)';
                        document.getElementById('low-stock-threshold').value = settings.lowStockThreshold || 10;
                        document.getElementById('email-notifications').checked = settings.emailNotifications || false;
                        document.getElementById('daily-reports').checked = settings.dailyReports || false;
                        document.getElementById('notification-email').value = settings.notificationEmail || '';
                    }
                    
                    await this.renderActivityLog();
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
                        lowStockThreshold: parseInt(document.getElementById('low-stock-threshold').value),
                        emailNotifications: document.getElementById('email-notifications').checked,
                        dailyReports: document.getElementById('daily-reports').checked,
                        notificationEmail: document.getElementById('notification-email').value
                    };
                    
                    await setDoc(firebaseService.settingsRef(), settings);
                    
                    const currencyMap = {
                        'GHS (₵)': '₵',
                        'USD ($)': '$',
                        'EUR (€)': '€',
                        'GBP (£)': '£'
                    };
                    state.currencySymbol = currencyMap[settings.currency];
                    
                    await ActivityLogger.log('Settings Updated', 'Business settings updated');
                    
                    Utils.showToast('Settings saved successfully', 'success');
                    this.renderDashboard();
                } catch (error) {
                    Utils.showToast('Failed to save settings: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
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

            printReceipt(saleId) {
                const sale = state.allSales.find(s => s.id === saleId);
                if (!sale) {
                    Utils.showToast('Sale not found', 'error');
                    return;
                }
                
                const subtotal = sale.quantity * sale.price;
                const discountAmount = subtotal * (sale.discount || 0) / 100;
                const subtotalAfterDiscount = subtotal - discountAmount;
                const taxAmount = subtotalAfterDiscount * (sale.tax || 0) / 100;
                const total = subtotalAfterDiscount + taxAmount;
                
                const receiptHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Receipt</title>
                        <style>
                            body { margin: 0; padding: 0; }
                            .receipt {
                                width: 80mm;
                                font-family: 'Courier New', monospace;
                                font-size: 12px;
                                line-height: 1.4;
                                padding: 10mm;
                            }
                            .receipt-header {
                                text-align: center;
                                border-bottom: 1px dashed #000;
                                padding-bottom: 10px;
                                margin-bottom: 10px;
                            }
                            .receipt-item {
                                display: flex;
                                justify-content: space-between;
                                margin: 5px 0;
                            }
                            .receipt-total {
                                border-top: 1px dashed #000;
                                padding-top: 10px;
                                margin-top: 10px;
                                font-weight: bold;
                            }
                            @media print {
                                @page { size: 80mm auto; margin: 0; }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="receipt">
                            <div class="receipt-header">
                                <h2 style="margin: 0;">MY BUSINESS</h2>
                                <p style="margin: 5px 0;">Business Address</p>
                                <p style="margin: 5px 0;">Tel: (000) 000-0000</p>
                            </div>
                            
                            <div style="text-align: center; margin: 10px 0;">
                                <p style="margin: 0;"><strong>SALES RECEIPT</strong></p>
                                <p style="margin: 5px 0; font-size: 10px;">
                                    Date: ${sale.date}<br>
                                    Time: ${new Date().toLocaleTimeString()}
                                </p>
                            </div>
                            
                            <div style="border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px;">
                                <p style="margin: 0;"><strong>Customer:</strong> ${sale.customer}</p>
                            </div>
                            
                            <div>
                                <div class="receipt-item">
                                    <span>${sale.product}</span>
                                    <span></span>
                                </div>
                                <div class="receipt-item" style="font-size: 11px; margin-left: 10px;">
                                    <span>${sale.quantity} x ${Utils.formatCurrency(sale.price)}</span>
                                    <span>${Utils.formatCurrency(subtotal)}</span>
                                </div>
                                
                                ${sale.discount > 0 ? `
                                <div class="receipt-item" style="font-size: 11px; margin-left: 10px;">
                                    <span>Discount (${sale.discount}%)</span>
                                    <span>-${Utils.formatCurrency(discountAmount)}</span>
                                </div>
                                ` : ''}
                                
                                ${sale.tax > 0 ? `
                                <div class="receipt-item" style="font-size: 11px; margin-left: 10px;">
                                    <span>Tax (${sale.tax}%)</span>
                                    <span>${Utils.formatCurrency(taxAmount)}</span>
                                </div>
                                ` : ''}
                            </div>
                            
                            <div class="receipt-total">
                                <div class="receipt-item">
                                    <span>TOTAL</span>
                                    <span>${Utils.formatCurrency(total)}</span>
                                </div>
                            </div>
                            
                            <div style="text-align: center; margin-top: 20px; font-size: 10px;">
                                <p style="margin: 5px 0;">Thank you for your business!</p>
                                <p style="margin: 5px 0;">Please come again</p>
                            </div>
                            
                            <div style="text-align: center; margin-top: 10px; font-size: 9px; border-top: 1px dashed #000; padding-top: 10px;">
                                <p style="margin: 0;">Powered by Ultimate Bookkeeping</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `;
                
                const printWindow = window.open('', '_blank');
                printWindow.document.write(receiptHTML);
                printWindow.document.close();
                printWindow.focus();
                
                setTimeout(() => {
                    printWindow.print();
                }, 250);
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
                    this.renderInventoryTable();
                    
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
                                        ${consignment.products.map(p => `
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
                            const productsList = consignment.products.map(p => 
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
                                    ${consignment.products.map(product => `
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
                
                try {
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
                    
                    Utils.showToast('Settlement generated successfully', 'success');
                    document.getElementById('generate-settlement-modal').style.display = 'none';
                    
                    // View the generated settlement
                    this.viewSettlementDetails(outletId, period);
                    
                } catch (error) {
                    Utils.showToast('Failed to generate settlement: ' + error.message, 'error');
                } finally {
                    Utils.hideSpinner();
                }
            }

            async calculateSettlement(outletId, period) {
                try {
                    const outlet = state.allOutlets.find(o => o.id === outletId);
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
                            consignmentsReceivedValue += consignment.totalCostValue;
                            consignmentsList.push({
                                id: doc.id,
                                date: consignment.date,
                                value: consignment.totalCostValue,
                                items: consignment.totalQuantity
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
                            const subtotal = sale.quantity * sale.price;
                            const discounted = subtotal * (1 - (sale.discount || 0) / 100);
                            const saleTotal = discounted * (1 + (sale.tax || 0) / 100);
                            
                            totalSalesValue += saleTotal;
                            
                            // Get COGS for this sale
                            const product = state.allProducts.find(p => p.name === sale.product);
                            if (product) {
                                costOfGoodsSold += sale.quantity * product.cost;
                            }
                            
                            salesList.push({
                                id: doc.id,
                                date: sale.date,
                                customer: sale.customer,
                                product: sale.product,
                                quantity: sale.quantity,
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
                        const itemValue = item.quantity * item.cost;
                        closingInventoryValue += itemValue;
                        closingInventoryList.push({
                            name: item.name,
                            quantity: item.quantity,
                            cost: item.cost,
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
                    const commissionRate = outlet.commissionRate / 100;
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
                        commissionRate: outlet.commissionRate,
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
                        generatedBy: state.currentUser.email
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
                            
                            const colors = statusColors[settlement.paymentStatus];
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
                                            ${settlement.paymentStatus.toUpperCase()}
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
                            
                            const colors = statusColors[settlement.paymentStatus];
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
                                            ${settlement.paymentStatus.toUpperCase()}
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
                
                if (results.expenses.length > 0) {
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
                            customers: state.allCustomers
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
                            
                            const collections = ['inventory', 'sales', 'expenses', 'customers'];
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
                            
                            if (backup.data.settings) {
                                batch.set(firebaseService.settingsRef(), backup.data.settings);
                            }
                            
                            await batch.commit();
                            
                            await dataLoader.loadAll();
                            this.renderDashboard();
                            
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
                    
                    let productList = '';
                    
                    if (outOfStockProducts.length > 0) {
                        productList += '<h3 style="color: #dc3545;">Out of Stock:</h3><ul>';
                        outOfStockProducts.forEach(p => {
                            productList += `<li><strong>${p.name}</strong> - Category: ${p.category}</li>`;
                        });
                        productList += '</ul>';
                    }
                    
                    if (lowStockProducts.length > 0) {
                        productList += '<h3 style="color: #ffc107;">Low Stock Warning:</h3><ul>';
                        lowStockProducts.forEach(p => {
                            productList += `<li><strong>${p.name}</strong> - Current: ${p.quantity}, Min: ${p.minStock || 10}</li>`;
                        });
                        productList += '</ul>';
                    }
                    
                    const templateParams = {
                        to_email: settings.notificationEmail,
                        business_name: settings.name || 'Your Business',
                        product_list: productList,
                        total_alerts: lowStockProducts.length + outOfStockProducts.length
                    };

                    console.log("Low Stock Mail: ", templateParams)
                    
                    await emailjs.send('service_x4hgyq2', 'template_xf12d5d', templateParams);
                    
                    console.log('Low stock notification sent');
                } catch (error) {
                    console.error('Failed to send low stock notification:', error);
                }
            }
        }

        // ==================== GLOBAL ERROR HANDLERS ====================
        window.addEventListener('error', (event) => {
            console.error('Global error:', event.error);
            Utils.showToast('An unexpected error occurred', 'error');
        });

        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            Utils.showToast('An unexpected error occurred', 'error');
        });

        // ==================== INITIALIZE APPLICATION ====================
        const app = new AppController();
        window.appController = app;
    