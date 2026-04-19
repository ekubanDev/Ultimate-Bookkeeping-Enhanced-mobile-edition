// ==================== STATE MANAGEMENT ====================

/**
 * Application State Management
 * Centralized state for the entire application
 */

import { CONFIG } from '../config/firebase.js';

export class AppState {
    constructor() {
        this.currentUser = null;
        this.authInitialized = false;
        this.dataReady = false; // true once loadAll() has resolved for the current user
        this.currencySymbol = CONFIG.defaults.currencySymbol;
        this.allProducts = [];
        this.allSales = [];
        this.allExpenses = [];
        this.allCustomers = [];
        this.allLiabilities = [];
        /** Liability/debt repayments from payment_transactions (not expenses). */
        this.allLiabilityPayments = [];
        this.allSuppliers = [];
        this.allPurchaseOrders = [];
        this.charts = {};
        this.inventoryCurrentPage = 1;
        this.inventoryItemsPerPage = 10;

        // Track which data sections failed to load so the UI can show error states
        // rather than an empty table that looks like "no data".
        this.loadErrors = {}; // e.g. { products: true, sales: true }

        // Multi-outlet/user management
        this.userRole = null; // 'admin' or 'outlet_manager'
        this.parentAdminId = null; 
        this.assignedOutlet = null; // for outlet managers
        this.allOutlets = [];
        this.currentOutletView = 'main'; // 'main' or outlet_id
        // Admin outlet filter for dashboards/analytics
        this.selectedOutletFilter = 'main'; // 'main' | 'all' | outlet_id
        this.managedUsers = [];
        
        // Date range for analytics
        this.dateRange = {
            start: this.getDateDaysAgo(30),
            end: this.getTodayDate(),
            preset: '30days'
        };
        this.compareMode = false;
    }

    getDateDaysAgo(days) {
        const date = new Date();
        date.setDate(date.getDate() - days);
        return date.toISOString().split('T')[0];
    }

    getTodayDate() {
        return new Date().toISOString().split('T')[0];
    }

    reset() {
        // Reset identity/context (critical on user switch)
        this.userRole = null;
        this.parentAdminId = null;
        this.assignedOutlet = null;
        this.currentOutletView = 'main';
        this.selectedOutletFilter = 'main';

        this.allProducts = [];
        this.allSales = [];
        this.allExpenses = [];
        this.allCustomers = [];
        this.allLiabilities = [];
        this.allLiabilityPayments = [];
        this.allOutlets = []; 
        this.managedUsers = [];
        
        this.dataReady = false;
        this.loadErrors = {};

        // Destroy all chart instances
        Object.values(this.charts).forEach(chart => chart?.destroy());
        this.charts = {};
    }
}

// Create singleton instance
export const state = new AppState();
