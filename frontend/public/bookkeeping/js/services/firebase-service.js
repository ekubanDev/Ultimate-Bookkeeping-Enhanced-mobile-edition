// ==================== FIREBASE SERVICE ====================

/**
 * Firebase Service
 * Handles Firebase database operations and collection references
 */

import { db, CONFIG, auth } from '../config/firebase.js';
import { collection, doc, getDoc, setDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot } from '../config/firebase.js';
import { state } from '../utils/state.js';

export class FirebaseService {
    constructor() {
        this.db = db;
        this.auth = auth;
    }

    getUserCollection(name) {
        if (!state.authInitialized || !state.currentUser) {
            throw new Error('Authentication required');
        }
        return collection(db, name);
    }

    // Get collection reference
    getCollection(collectionName) {
        return collection(db, collectionName);
    }

    // Get all documents from collection
    async getAllDocuments(collectionName) {
        try {
            const snapshot = await getDocs(collection(db, collectionName));
            const docs = [];
            snapshot.forEach(doc => {
                docs.push({ id: doc.id, ...doc.data() });
            });
            return docs;
        } catch (error) {
            console.error(`Error getting ${collectionName}:`, error);
            throw error;
        }
    }

    // Get single document
    async getDocument(collectionName, docId) {
        try {
            const docRef = doc(db, collectionName, docId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                return { id: docSnap.id, ...docSnap.data() };
            }
            return null;
        } catch (error) {
            console.error(`Error getting document ${docId}:`, error);
            throw error;
        }
    }

    // Add document
    async addDocument(collectionName, data) {
        try {
            const docRef = await addDoc(collection(db, collectionName), data);
            return docRef.id;
        } catch (error) {
            console.error(`Error adding document to ${collectionName}:`, error);
            throw error;
        }
    }

    // Update document
    async updateDocument(collectionName, docId, data) {
        try {
            const docRef = doc(db, collectionName, docId);
            await updateDoc(docRef, data);
            return true;
        } catch (error) {
            console.error(`Error updating document ${docId}:`, error);
            throw error;
        }
    }

    // Delete document
    async deleteDocument(collectionName, docId) {
        try {
            const docRef = doc(db, collectionName, docId);
            await deleteDoc(docRef);
            return true;
        } catch (error) {
            console.error(`Error deleting document ${docId}:`, error);
            throw error;
        }
    }

    // Listen to collection changes
    onCollectionChange(collectionName, callback) {
        return onSnapshot(collection(db, collectionName), (snapshot) => {
            const docs = [];
            snapshot.forEach(doc => {
                docs.push({ id: doc.id, ...doc.data() });
            });
            callback(docs);
        });
    }

    // Get current user
    getCurrentUser() {
        return this.auth.currentUser || state.currentUser;
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
                
                state.userRole = userData.role;
                // Used by outlet-manager POS + dashboard listeners.
                state.parentAdminId = userData.createdBy || null;
                console.log('UserDataRole:', state.userRole);
                return {
                    role: userData.role || 'admin',
                    assignedOutlet: userData.assignedOutlet || null,
                    parentAdminId: state.parentAdminId
                };
            }
            // Default to admin if no user document
            state.parentAdminId = null;
            return { role: 'admin', assignedOutlet: null, parentAdminId: null };
        } catch (error) {
            console.error('Error getting user role:', error);
            // Default to admin on error
            state.parentAdminId = null;
            return { role: 'admin', assignedOutlet: null, parentAdminId: null };
        }
    }
    
    getOutletsCollection() {
        return collection(db, 'outlets');
    }
    
    getOutletCollection(outletId) {
        return collection(db, 'outlets', outletId);
    }
    
    // Get outlet sub-collection (e.g., outlet_sales, outlet_inventory, outlet_expenses)
    getOutletSubCollection(outletId, subCollectionName) {
        return collection(db, 'outlets', outletId, subCollectionName);
    }
    
    // Get all documents from outlet sub-collection
    async getAllOutletDocuments(outletId, subCollectionName) {
        try {
            const snapshot = await getDocs(this.getOutletSubCollection(outletId, subCollectionName));
            const docs = [];
            snapshot.forEach(doc => {
                docs.push({ id: doc.id, ...doc.data() });
            });
            return docs;
        } catch (error) {
            console.error(`Error getting outlet ${outletId} ${subCollectionName}:`, error);
            throw error;
        }
    }
    
    // Listen to outlet sub-collection changes
    onOutletSubCollectionChange(outletId, subCollectionName, callback) {
        return onSnapshot(this.getOutletSubCollection(outletId, subCollectionName), (snapshot) => {
            const docs = [];
            snapshot.forEach(doc => {
                docs.push({ id: doc.id, ...doc.data() });
            });
            callback(docs);
        });
    }
    
    getConsignmentsCollection(outletId) {
        return collection(db, 'outlets', outletId, 'consignments');
    }
    
    getSettlementsCollection(outletId) {
        return collection(db, 'outlets', outletId, 'settlements');
    }
}

// Create and export singleton instance
export const firebaseService = new FirebaseService();
