// ==================== OFFLINE SYNC SERVICE ====================

/**
 * Offline Sync Service
 * Manages offline data storage, queuing operations, and syncing when online
 */

import { Utils } from '../utils/utils.js';

class OfflineSyncService {
    constructor() {
        this.db = null;
        this.isOnline = navigator.onLine;
        this.pendingOperations = [];
        this.syncInProgress = false;
        
        this.init();
    }

    async init() {
        // Setup online/offline listeners
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // Initialize IndexedDB
        await this.initDB();
        
        // Load pending operations
        await this.loadPendingOperations();
        
        // Register service worker if online
        if ('serviceWorker' in navigator && this.isOnline) {
            await this.registerServiceWorker();
        }
        
        console.log('✅ Offline Sync Service initialized');
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('bookkeeping-offline', 2);
            
            request.onerror = () => {
                console.error('IndexedDB error:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                console.log('📦 IndexedDB opened successfully');
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Pending operations store
                if (!db.objectStoreNames.contains('pendingOperations')) {
                    const store = db.createObjectStore('pendingOperations', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('type', 'type', { unique: false });
                }
                
                // Offline data store (for reading when offline)
                if (!db.objectStoreNames.contains('offlineData')) {
                    const dataStore = db.createObjectStore('offlineData', {
                        keyPath: 'key'
                    });
                    dataStore.createIndex('collection', 'collection', { unique: false });
                }
                
                console.log('📦 IndexedDB schema upgraded');
            };
        });
    }

    async registerServiceWorker() {
        if (!('serviceWorker' in navigator) || !window.isSecureContext) {
            console.warn('Service Worker unavailable (requires HTTPS). Offline caching via IndexedDB only.');
            return null;
        }
        try {
            const registration = await navigator.serviceWorker.register('/bookkeeping/sw.js');
            console.log('Service Worker registered:', registration.scope);

            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        Utils.showToast('App update available! Refresh to update.', 'info');
                    }
                });
            });

            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleServiceWorkerMessage(event.data);
            });

            return registration;
        } catch (error) {
            console.warn('Service Worker registration skipped:', error.message);
            return null;
        }
    }

    handleServiceWorkerMessage(data) {
        if (data.type === 'SYNC_COMPLETE') {
            console.log('✅ Background sync completed:', data.count, 'operations');
            Utils.showToast(`Synced ${data.count} offline changes`, 'success');
            this.loadPendingOperations();
        }
    }

    async loadPendingOperations() {
        if (!this.db) return;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['pendingOperations'], 'readonly');
            const store = transaction.objectStore('pendingOperations');
            const request = store.getAll();
            
            request.onsuccess = () => {
                this.pendingOperations = request.result;
                console.log('📥 Loaded', this.pendingOperations.length, 'pending operations');
                this.updateUI();
                resolve(this.pendingOperations);
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async queueOperation(operation) {
        if (!this.db) {
            console.warn('IndexedDB not initialized, operation will be lost!');
            return null;
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['pendingOperations'], 'readwrite');
            const store = transaction.objectStore('pendingOperations');
            
            const operationData = {
                ...operation,
                timestamp: new Date().toISOString(),
                status: 'pending'
            };
            
            const request = store.add(operationData);
            
            request.onsuccess = () => {
                operationData.id = request.result;
                this.pendingOperations.push(operationData);
                console.log('💾 Operation queued:', operationData.type);
                this.updateUI();
                resolve(operationData);
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async removePendingOperation(id) {
        if (!this.db) return;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['pendingOperations'], 'readwrite');
            const store = transaction.objectStore('pendingOperations');
            const request = store.delete(id);
            
            request.onsuccess = () => {
                this.pendingOperations = this.pendingOperations.filter(op => op.id !== id);
                console.log('✅ Operation removed:', id);
                this.updateUI();
                resolve();
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async syncPendingOperations() {
        if (this.syncInProgress || !this.isOnline) {
            console.log('⏸️ Sync skipped:', this.syncInProgress ? 'in progress' : 'offline');
            return;
        }
        
        if (this.pendingOperations.length === 0) {
            console.log('✅ No pending operations to sync');
            return;
        }
        
        this.syncInProgress = true;
        console.log('🔄 Syncing', this.pendingOperations.length, 'operations...');
        
        const results = {
            success: 0,
            failed: 0,
            errors: []
        };
        
        for (const operation of [...this.pendingOperations]) {
            try {
                await this.executeOperation(operation);
                await this.removePendingOperation(operation.id);
                results.success++;
            } catch (error) {
                console.error('❌ Failed to sync operation:', operation, error);
                results.failed++;
                results.errors.push({ operation, error: error.message });
            }
        }
        
        this.syncInProgress = false;
        
        console.log('✅ Sync complete:', results);
        
        if (results.success > 0) {
            Utils.showToast(`Synced ${results.success} offline changes`, 'success');
        }
        
        if (results.failed > 0) {
            Utils.showToast(`${results.failed} operations failed to sync`, 'error');
        }
        
        return results;
    }

    async executeOperation(operation) {
        // This will be implemented by the app controller
        // to actually perform the Firebase operations
        if (window.appController && window.appController.executeOfflineOperation) {
            return await window.appController.executeOfflineOperation(operation);
        }
        
        throw new Error('App controller not available to execute operation');
    }

    async cacheData(collection, key, data) {
        if (!this.db) return;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['offlineData'], 'readwrite');
            const store = transaction.objectStore('offlineData');
            
            const request = store.put({
                key: `${collection}_${key}`,
                collection,
                data,
                cachedAt: new Date().toISOString()
            });
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getCachedData(collection, key) {
        if (!this.db) return null;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['offlineData'], 'readonly');
            const store = transaction.objectStore('offlineData');
            const request = store.get(`${collection}_${key}`);
            
            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.data : null);
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    async getAllCachedData(collection) {
        if (!this.db) return [];
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['offlineData'], 'readonly');
            const store = transaction.objectStore('offlineData');
            const index = store.index('collection');
            const request = index.getAll(collection);
            
            request.onsuccess = () => {
                resolve(request.result.map(item => item.data));
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    handleOnline() {
        console.log('🌐 Connection restored - going online');
        this.isOnline = true;
        this.updateUI();
        
        Utils.showToast('Back online! Syncing changes...', 'success');
        
        // Sync pending operations
        setTimeout(() => {
            this.syncPendingOperations();
        }, 1000);
    }

    handleOffline() {
        console.log('📴 Connection lost - going offline');
        this.isOnline = false;
        this.updateUI();
        
        Utils.showToast('You are offline. Changes will sync when online.', 'warning');
    }

    updateUI() {
        // Update connection status
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            if (this.isOnline) {
                statusElement.textContent = this.pendingOperations.length > 0 
                    ? `Online (${this.pendingOperations.length} pending)`
                    : 'Online';
                statusElement.style.color = '#28a745';
            } else {
                statusElement.textContent = 'Offline Mode';
                statusElement.style.color = '#ffc107';
            }
        }
        
        // Show offline indicator if needed
        this.showOfflineIndicator(!this.isOnline || this.pendingOperations.length > 0);
    }

    showOfflineIndicator(show) {
        let indicator = document.getElementById('offline-indicator');
        
        if (show && !indicator) {
            indicator = document.createElement('div');
            indicator.id = 'offline-indicator';
            indicator.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: ${this.isOnline ? '#17a2b8' : '#ffc107'};
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 14px;
                cursor: pointer;
            `;
            
            indicator.innerHTML = `
                <i class="fas fa-${this.isOnline ? 'sync' : 'wifi-slash'}"></i>
                <span>${this.isOnline 
                    ? `${this.pendingOperations.length} changes pending` 
                    : 'Working offline'}</span>
            `;
            
            indicator.addEventListener('click', () => {
                if (this.isOnline && this.pendingOperations.length > 0) {
                    this.syncPendingOperations();
                }
            });
            
            document.body.appendChild(indicator);
        } else if (!show && indicator) {
            indicator.remove();
        } else if (show && indicator) {
            // Update existing indicator
            indicator.innerHTML = `
                <i class="fas fa-${this.isOnline ? 'sync' : 'wifi-slash'}"></i>
                <span>${this.isOnline 
                    ? `${this.pendingOperations.length} changes pending` 
                    : 'Working offline'}</span>
            `;
            indicator.style.background = this.isOnline ? '#17a2b8' : '#ffc107';
        }
    }

    getStatus() {
        return {
            isOnline: this.isOnline,
            pendingCount: this.pendingOperations.length,
            syncInProgress: this.syncInProgress
        };
    }
}

// Create and export singleton
export const offlineSyncService = new OfflineSyncService();
