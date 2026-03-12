/**
 * Customer Credit System Service
 * Manages customer balances, credits, and payment tracking
 */

import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';
import { db, collection, doc, addDoc, updateDoc, getDocs, query, where, orderBy, serverTimestamp } from '../config/firebase.js';
import { firebaseService } from './firebase-service.js';

class CustomerCreditService {
    /**
     * Get customer balance (amount owed to business)
     */
    getCustomerBalance(customerId) {
        const customer = state.allCustomers.find(c => c.id === customerId);
        if (!customer) return 0;
        return parseFloat(customer.balance) || 0;
    }

    /**
     * Get all customers with outstanding balances
     */
    getCustomersWithBalances() {
        return state.allCustomers
            .filter(c => (parseFloat(c.balance) || 0) !== 0)
            .map(c => ({
                ...c,
                balance: parseFloat(c.balance) || 0,
                status: (parseFloat(c.balance) || 0) > 0 ? 'owes' : 'credit'
            }))
            .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    }

    /**
     * Get total receivables (money owed by customers)
     */
    getTotalReceivables() {
        return state.allCustomers.reduce((sum, c) => {
            const balance = parseFloat(c.balance) || 0;
            return sum + (balance > 0 ? balance : 0);
        }, 0);
    }

    /**
     * Get total credits (money owed to customers)
     */
    getTotalCredits() {
        return state.allCustomers.reduce((sum, c) => {
            const balance = parseFloat(c.balance) || 0;
            return sum + (balance < 0 ? Math.abs(balance) : 0);
        }, 0);
    }

    /**
     * Record a credit sale (customer owes money)
     */
    async recordCreditSale(customerId, amount, saleId, notes = '') {
        try {
            const customer = state.allCustomers.find(c => c.id === customerId);
            if (!customer) throw new Error('Customer not found');

            const currentBalance = parseFloat(customer.balance) || 0;
            const newBalance = currentBalance + parseFloat(amount);

            // Update customer balance
            const customerRef = doc(firebaseService.getUserCollection('customers'), customerId);
            await updateDoc(customerRef, {
                balance: newBalance,
                updatedAt: new Date().toISOString()
            });

            // Record transaction
            await this.recordTransaction({
                customerId,
                customerName: customer.name,
                type: 'credit_sale',
                amount: parseFloat(amount),
                saleId,
                notes,
                balanceBefore: currentBalance,
                balanceAfter: newBalance
            });

            // Update local state
            customer.balance = newBalance;

            Utils.showToast(`Credit sale recorded. ${customer.name} now owes ${Utils.formatCurrency(newBalance)}`, 'success');
            return true;
        } catch (error) {
            console.error('Error recording credit sale:', error);
            Utils.showToast('Failed to record credit sale: ' + error.message, 'error');
            return false;
        }
    }

    /**
     * Record customer payment
     */
    async recordCustomerPayment(customerId, amount, paymentMethod, reference = '', notes = '') {
        try {
            const customer = state.allCustomers.find(c => c.id === customerId);
            if (!customer) throw new Error('Customer not found');

            const currentBalance = parseFloat(customer.balance) || 0;
            const paymentAmount = parseFloat(amount);
            const newBalance = currentBalance - paymentAmount;

            // Update customer balance
            const customerRef = doc(firebaseService.getUserCollection('customers'), customerId);
            await updateDoc(customerRef, {
                balance: newBalance,
                lastPaymentDate: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            // Record transaction
            await this.recordTransaction({
                customerId,
                customerName: customer.name,
                type: 'payment',
                amount: paymentAmount,
                paymentMethod,
                reference,
                notes,
                balanceBefore: currentBalance,
                balanceAfter: newBalance
            });

            // Update local state
            customer.balance = newBalance;

            Utils.showToast(`Payment of ${Utils.formatCurrency(paymentAmount)} recorded. Balance: ${Utils.formatCurrency(newBalance)}`, 'success');
            return true;
        } catch (error) {
            console.error('Error recording payment:', error);
            Utils.showToast('Failed to record payment: ' + error.message, 'error');
            return false;
        }
    }

    /**
     * Add credit to customer account (customer credit/refund)
     */
    async addCustomerCredit(customerId, amount, reason = '') {
        try {
            const customer = state.allCustomers.find(c => c.id === customerId);
            if (!customer) throw new Error('Customer not found');

            const currentBalance = parseFloat(customer.balance) || 0;
            const creditAmount = parseFloat(amount);
            const newBalance = currentBalance - creditAmount;

            // Update customer balance
            const customerRef = doc(firebaseService.getUserCollection('customers'), customerId);
            await updateDoc(customerRef, {
                balance: newBalance,
                updatedAt: new Date().toISOString()
            });

            // Record transaction
            await this.recordTransaction({
                customerId,
                customerName: customer.name,
                type: 'credit_added',
                amount: creditAmount,
                notes: reason,
                balanceBefore: currentBalance,
                balanceAfter: newBalance
            });

            // Update local state
            customer.balance = newBalance;

            Utils.showToast(`Credit of ${Utils.formatCurrency(creditAmount)} added to ${customer.name}'s account`, 'success');
            return true;
        } catch (error) {
            console.error('Error adding credit:', error);
            Utils.showToast('Failed to add credit: ' + error.message, 'error');
            return false;
        }
    }

    /**
     * Record customer transaction for audit trail
     */
    async recordTransaction(transactionData) {
        try {
            await addDoc(firebaseService.getUserCollection('customer_transactions'), {
                ...transactionData,
                timestamp: new Date().toISOString(),
                userId: state.currentUser?.uid
            });
        } catch (error) {
            console.error('Error recording transaction:', error);
        }
    }

    /**
     * Get customer transaction history
     */
    async getCustomerTransactions(customerId, limit = 50) {
        try {
            const q = query(
                firebaseService.getUserCollection('customer_transactions'),
                where('customerId', '==', customerId),
                orderBy('timestamp', 'desc')
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).slice(0, limit);
        } catch (error) {
            console.error('Error getting transactions:', error);
            return [];
        }
    }

    /**
     * Get summary of customer credit status
     */
    getSummary() {
        const withBalances = this.getCustomersWithBalances();
        return {
            totalReceivables: this.getTotalReceivables(),
            totalCredits: this.getTotalCredits(),
            netReceivables: this.getTotalReceivables() - this.getTotalCredits(),
            customersOwing: withBalances.filter(c => c.status === 'owes').length,
            customersWithCredit: withBalances.filter(c => c.status === 'credit').length,
            topDebtors: withBalances.filter(c => c.status === 'owes').slice(0, 5)
        };
    }

    /**
     * Render customer credit widget for dashboard
     */
    renderCreditWidget() {
        const summary = this.getSummary();
        
        return `
            <div class="customer-credit-widget card">
                <h3><i class="fas fa-hand-holding-usd"></i> Customer Balances</h3>
                <div class="credit-summary">
                    <div class="credit-metric receivables">
                        <span class="label">Total Receivables</span>
                        <span class="amount">${Utils.formatCurrency(summary.totalReceivables)}</span>
                        <span class="count">${summary.customersOwing} customers</span>
                    </div>
                    <div class="credit-metric credits">
                        <span class="label">Customer Credits</span>
                        <span class="amount">${Utils.formatCurrency(summary.totalCredits)}</span>
                        <span class="count">${summary.customersWithCredit} customers</span>
                    </div>
                    <div class="credit-metric net ${summary.netReceivables >= 0 ? 'positive' : 'negative'}">
                        <span class="label">Net Receivables</span>
                        <span class="amount">${Utils.formatCurrency(summary.netReceivables)}</span>
                    </div>
                </div>
                ${summary.topDebtors.length > 0 ? `
                    <div class="top-debtors">
                        <h4>Top Debtors</h4>
                        <ul>
                            ${summary.topDebtors.map(c => `
                                <li>
                                    <span class="name">${c.name}</span>
                                    <span class="balance">${Utils.formatCurrency(c.balance)}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                ` : '<p class="no-debtors">No outstanding customer balances</p>'}
                <button onclick="window.appController.showSection('customers')" class="btn-link">
                    View All Customers <i class="fas fa-arrow-right"></i>
                </button>
            </div>
        `;
    }

    /**
     * Render payment modal
     */
    renderPaymentModal(customerId) {
        const customer = state.allCustomers.find(c => c.id === customerId);
        if (!customer) return '';

        return `
            <div id="customer-payment-modal" class="modal" style="display: block;">
                <div class="modal-content">
                    <span class="close" onclick="document.getElementById('customer-payment-modal').remove()">&times;</span>
                    <h3><i class="fas fa-money-bill-wave"></i> Record Payment</h3>
                    
                    <div class="customer-info" style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                        <p><strong>Customer:</strong> ${customer.name}</p>
                        <p><strong>Current Balance:</strong> <span class="${customer.balance > 0 ? 'text-danger' : 'text-success'}">${Utils.formatCurrency(customer.balance || 0)}</span></p>
                    </div>
                    
                    <form id="customer-payment-form" onsubmit="customerCredit.handlePaymentSubmit(event, '${customerId}')">
                        <label>Payment Amount *</label>
                        <input type="number" id="payment-amount" step="0.01" min="0.01" required 
                               placeholder="Enter amount" max="${Math.abs(customer.balance || 0) + 1000}">
                        
                        <label>Payment Method *</label>
                        <select id="payment-method" required>
                            <option value="">Select method...</option>
                            <option value="cash">Cash</option>
                            <option value="mobile_money">Mobile Money</option>
                            <option value="bank_transfer">Bank Transfer</option>
                            <option value="card">Card</option>
                            <option value="cheque">Cheque</option>
                        </select>
                        
                        <label>Reference Number</label>
                        <input type="text" id="payment-reference" placeholder="Transaction reference (optional)">
                        
                        <label>Notes</label>
                        <textarea id="payment-notes" placeholder="Additional notes (optional)" rows="2"></textarea>
                        
                        <button type="submit"><i class="fas fa-check"></i> Record Payment</button>
                    </form>
                </div>
            </div>
        `;
    }

    /**
     * Handle payment form submission
     */
    async handlePaymentSubmit(event, customerId) {
        event.preventDefault();
        
        const amount = document.getElementById('payment-amount').value;
        const method = document.getElementById('payment-method').value;
        const reference = document.getElementById('payment-reference').value;
        const notes = document.getElementById('payment-notes').value;

        const success = await this.recordCustomerPayment(customerId, amount, method, reference, notes);
        
        if (success) {
            document.getElementById('customer-payment-modal').remove();
            // Refresh customers view if visible
            if (window.appController) {
                window.appController.renderCustomers();
            }
        }
    }
}

export const customerCredit = new CustomerCreditService();
window.customerCredit = customerCredit;
