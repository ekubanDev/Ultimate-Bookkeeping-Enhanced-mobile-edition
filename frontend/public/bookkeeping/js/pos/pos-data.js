// ==================== POS DATA MANAGEMENT ====================
import { firebaseService } from '../services/firebase-service.js';
import { collection, getDocs, db, doc, addDoc, updateDoc } from '../config/firebase.js';
import { state } from '../utils/state.js';
import { POSUI } from './pos-ui.js';

export const POSData = {
    
    // Load products based on user role and outlet
    async loadProducts() {
        try {
            console.log('Loading products from Firebase...');
            
            // Get user role
            const userRole = await this.getUserRole();
            
            let products = [];
            
            if (userRole.role === 'outlet_manager' && userRole.assignedOutlet) {
                // Load only outlet-specific inventory
                console.log(`Loading inventory for outlet: ${userRole.assignedOutlet}`);
                products = await this.loadOutletInventory(userRole.assignedOutlet, userRole.parentAdminId);
            } else {
                // Load all inventory (admin view)
                console.log('Loading all inventory (admin mode)');
                products = await this.loadAdminInventory();
            }
            
            state.products = products || [];
            console.log(`✅ Loaded ${state.products.length} products`);
            return state.products;
            
        } catch (error) {
            console.error('Error loading products:', error);
            POSUI.showNotification('Failed to load products', 'error');
            return [];
        }
    },

    // Get user role and assigned outlet
    async getUserRole() {
        const role = await firebaseService.getUserRole();
        
        // ✅ NEW: Get parentAdminId from user document
        const userDoc = await firebaseService.getDocument('users', state.currentUser.uid);
        const parentAdminId = userDoc?.createdBy || null;
        
        state.userRole = role.role;
        state.assignedOutlet = role.assignedOutlet;
        state.parentAdminId = parentAdminId; // ✅ Store it!
        
        console.log('POS User Role:', {
            role: role.role,
            assignedOutlet: role.assignedOutlet,
            parentAdminId: parentAdminId  // ✅ Now available!
        });
        
        return {
            role: role.role,
            assignedOutlet: role.assignedOutlet,
            parentAdminId: parentAdminId
        };
    },

    // Load outlet-specific inventory
    async loadOutletInventory(outletId, parentAdminId) {
        // Use parentAdminId parameter if provided
        const adminId = parentAdminId || state.parentAdminId;
        
        if (!adminId) {
            console.warn('⚠️ No parentAdminId found, loading from user document...');
            const userDoc = await firebaseService.getDocument('users', state.currentUser.uid);
            state.parentAdminId = userDoc?.createdBy;
        }
        
        if (!state.parentAdminId) {
            console.error('❌ Cannot load outlet inventory: parentAdminId missing');
            throw new Error('Parent Admin ID not found');
        }
        
        // ✅ CORRECT PATH!
        console.log(`📦 Loading from: users/${state.parentAdminId}/outlets/${outletId}/outlet_inventory`);
        
        const inventoryRef = collection(db, 'users', state.parentAdminId, 'outlets', outletId, 'outlet_inventory');
        const snapshot = await getDocs(inventoryRef);
        
        const products = [];
        snapshot.forEach(doc => {
            products.push({ id: doc.id, ...doc.data() });
        });
        
        console.log(`✅ Loaded ${products.length} products from outlet inventory`);
        return products;
    },

    // Load admin inventory from main collection
    async loadAdminInventory() {
        try {
            console.log('📦 Loading from: inventory/ (admin main collection)');
            
            const inventoryRef = collection(db, 'inventory');
            const snapshot = await getDocs(inventoryRef);
            
            const products = [];
            snapshot.forEach(doc => {
                products.push({ id: doc.id, ...doc.data() });
            });
            
            console.log(`✅ Loaded ${products.length} products from admin inventory`);
            return products;
        } catch (error) {
            console.error('❌ Error loading admin inventory:', error);
            throw error;
        }
    },

    // Load customers
    async loadCustomers() {
        try {
            const customers = await firebaseService.getUserCollection('customers');
            state.customers = customers || [];
            return state.customers;
        } catch (error) {
            console.error('Error loading customers:', error);
            return [];
        }
    },

    // Save sale
    async saveSale(saleData) {
        let saleId;
        
        // Add outlet and parent admin info
        if (state.assignedOutlet) {
            saleData.outlet = state.assignedOutlet;
            saleData.parentAdminId = state.parentAdminId;
        }
        
        if (state.assignedOutlet && state.parentAdminId) {
            // ✅ CORRECT PATH for outlet manager!
            console.log(`Saving to: users/${state.parentAdminId}/outlets/${state.assignedOutlet}/outlet_sales`);
            
            //const { collection, addDoc, db } = await import('../../config/firebase.js');
            const salesRef = collection(db, 'users', state.parentAdminId, 'outlets', state.assignedOutlet, 'outlet_sales');
            const docRef = await addDoc(salesRef, saleData);
            saleId = docRef.id;
        } else {
            // Admin: Save to main sales
            saleId = await firebaseService.addDocument('sales', saleData);
        }
        
        console.log('✅ Sale saved:', saleId);
        return saleId;
    },

    // Update inventory
    async updateInventory(productId, newQuantity) {
        if (state.assignedOutlet && state.parentAdminId) {
            // ✅ CORRECT PATH!
            console.log(`Updating: users/${state.parentAdminId}/outlets/${state.assignedOutlet}/outlet_inventory/${productId}`);
            
            //const { doc, updateDoc, db } = await import('../../config/firebase.js');
            const productRef = doc(db, 'users', state.parentAdminId, 'outlets', state.assignedOutlet, 'outlet_inventory', productId);
            
            await updateDoc(productRef, {
                quantity: newQuantity,
                lastUpdated: new Date().toISOString()
            });
            
            // Update local state
            const product = state.products.find(p => p.id === productId);
            if (product) product.quantity = newQuantity;
        } else {
            // Admin: Update main inventory
            await firebaseService.updateDocument('inventory', productId, {
                quantity: newQuantity,
                lastUpdated: new Date().toISOString()
            });
        }
    },

    // Find product by barcode
    findProductByBarcode(barcode) {
        return state.products.find(p => 
            p.barcode === barcode || 
            p.barcode === String(barcode).trim()
        );
    },

    // Get product by ID
    getProductById(productId) {
        return state.products.find(p => p.id === productId);
    },

    // Load POS settings
    async loadPOSSettings() {
        try {
            const settings = await firebaseService.getDocument('settings', 'pos');
            return settings || {
                taxRate: 0,
                currency: 'GHS',
                businessName: 'My Store',
                autoPrint: false
            };
        } catch (error) {
            console.log('Using default POS settings');
            return {
                taxRate: 0,
                currency: 'GHS',
                businessName: 'My Store',
                autoPrint: false
            };
        }
    },
};
