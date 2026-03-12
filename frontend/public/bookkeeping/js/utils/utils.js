// ==================== UTILITY FUNCTIONS ====================

/**
 * Common utility functions used throughout the application
 */

import { state } from './state.js';
import { CONFIG } from '../config/firebase.js';

export const Utils = {
    /**
     * Show toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type of toast (success, error, warning, info)
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const MAX_TOASTS = 4;
        while (container.children.length >= MAX_TOASTS) {
            container.removeChild(container.firstChild);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        const dismiss = () => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 280);
        };

        toast.innerHTML = `
            <i class="fas ${icons[type] || icons.info} toast-icon"></i>
            <div style="flex:1">${message}</div>
            <button class="toast-dismiss" aria-label="Dismiss">&times;</button>
            <div class="toast-progress"></div>
        `;
        toast.setAttribute('role', 'alert');

        toast.querySelector('.toast-dismiss').addEventListener('click', dismiss);
        container.appendChild(toast);
        setTimeout(dismiss, 3500);
    },

    showSpinner() {
        document.getElementById('spinner-overlay').classList.add('active');
    },

    hideSpinner() {
        document.getElementById('spinner-overlay').classList.remove('active');
    },

    formatCurrency(amount) {
        const symbol = state.currencySymbol ?? CONFIG.defaults.currencySymbol ?? '₵';
        return symbol + (amount || 0).toFixed(2);
    },

    /** Format amount in Ghana Cedis (₵) for export reports - always uses GHS regardless of app settings */
    formatCurrencyGHS(amount) {
        return '₵' + (parseFloat(amount) || 0).toFixed(2);
    },

    /** Format amount for PDFs using "GHS" (jsPDF does not render ₵ correctly). */
    formatGHS(amount) {
        return 'GHS ' + (parseFloat(amount) || 0).toFixed(2);
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

    /**
     * Format a date value (string, Date, or Firestore Timestamp-like) as YYYY-MM-DD.
     */
    formatDate(value) {
        if (!value) return '';

        // Already a simple date string
        if (typeof value === 'string') {
            // If includes time, strip at 'T'
            const iso = value.indexOf('T') !== -1 ? value.split('T')[0] : value;
            return iso;
        }

        // Firestore Timestamp
        if (value && typeof value.toDate === 'function') {
            return value.toDate().toISOString().split('T')[0];
        }

        // Fallback: JS Date or date-like
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().split('T')[0];
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
