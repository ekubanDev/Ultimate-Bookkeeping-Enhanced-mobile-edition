/**
 * Sales Returns Service
 * Handles product returns, refunds, and exchange processing
 */

import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';
import { db, collection, doc, addDoc, updateDoc, getDoc, getDocs, increment, serverTimestamp } from '../config/firebase.js';
import { firebaseService } from './firebase-service.js';
import ActivityLogger from './activity-logger.js';

class SalesReturnsService {
    /**
     * Process a product return
     */
    async processReturn(returnData) {
        try {
            Utils.showSpinner();

            const {
                saleId,
                productId,
                quantity,
                reason,
                returnType, // 'refund', 'exchange', 'credit'
                condition,  // 'resellable', 'damaged', 'defective'
                notes
            } = returnData;

            // Get original sale
            const sale = state.allSales.find(s => s.id === saleId);
            if (!sale) throw new Error('Original sale not found');

            // Get product
            const product = state.allProducts.find(p => p.id === productId || p.name === sale.product);
            if (!product) throw new Error('Product not found');

            // Calculate refund amount
            const unitPrice = parseFloat(sale.price) || parseFloat(product.price);
            const refundAmount = unitPrice * quantity;

            // Create return record
            const returnRecord = {
                saleId,
                productId: product.id,
                productName: product.name,
                quantity: parseInt(quantity),
                unitPrice,
                refundAmount,
                reason,
                returnType,
                condition,
                notes,
                originalSaleDate: sale.date,
                originalCustomer: sale.customer || sale.customerName,
                status: 'completed',
                processedBy: state.currentUser?.email,
                createdAt: new Date().toISOString()
            };

            // Save return record — capture ID for linked expense / downstream use
            const returnDocRef = await addDoc(firebaseService.getUserCollection('returns'), returnRecord);
            returnRecord.id = returnDocRef.id;

            // Update inventory if item is resellable
            if (condition === 'resellable') {
                const productRef = doc(firebaseService.getUserCollection('inventory'), product.id);
                await updateDoc(productRef, {
                    quantity: increment(quantity),
                    updatedAt: new Date().toISOString()
                });
                
                // Update local state
                product.quantity = (parseInt(product.quantity) || 0) + parseInt(quantity);
            }

            // Handle refund/credit based on return type
            if (returnType === 'refund') {
                // Record as expense (cash refund)
                await addDoc(firebaseService.getUserCollection('expenses'), {
                    date: new Date().toISOString().split('T')[0],
                    description: `Refund: ${product.name} x${quantity} - ${sale.customer || 'Customer'}`,
                    category: 'Refunds',
                    amount: refundAmount,
                    returnId: returnRecord.id,
                    createdAt: new Date().toISOString()
                });
            } else if (returnType === 'credit') {
                // Add to customer credit (if customer exists)
                const customer = state.allCustomers.find(c => 
                    c.name === sale.customer || c.id === sale.customerId
                );
                if (customer) {
                    const customerRef = doc(firebaseService.getUserCollection('customers'), customer.id);
                    await updateDoc(customerRef, {
                        balance: increment(-refundAmount),
                        updatedAt: new Date().toISOString()
                    });
                }
            }

            // Log activity
            await ActivityLogger.log('return_processed', {
                returnType,
                product: product.name,
                quantity,
                amount: refundAmount
            });

            Utils.hideSpinner();
            Utils.showToast(`Return processed successfully. ${returnType === 'refund' ? 'Refund: ' + Utils.formatCurrency(refundAmount) : 'Credit applied'}`, 'success');
            
            return { success: true, returnRecord };
        } catch (error) {
            Utils.hideSpinner();
            console.error('Error processing return:', error);
            Utils.showToast('Failed to process return: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all returns
     */
    async getReturns(filters = {}) {
        try {
            const snapshot = await getDocs(firebaseService.getUserCollection('returns'));
            let returns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Apply filters
            if (filters.startDate) {
                returns = returns.filter(r => r.createdAt >= filters.startDate);
            }
            if (filters.endDate) {
                returns = returns.filter(r => r.createdAt <= filters.endDate);
            }
            if (filters.returnType) {
                returns = returns.filter(r => r.returnType === filters.returnType);
            }

            return returns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } catch (error) {
            console.error('Error getting returns:', error);
            return [];
        }
    }

    /**
     * Get returns summary
     */
    async getReturnsSummary(period = 'month') {
        const returns = await this.getReturns();
        
        const now = new Date();
        let startDate;
        
        switch (period) {
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
            default:
                startDate = new Date(0);
        }

        const periodReturns = returns.filter(r => new Date(r.createdAt) >= startDate);

        return {
            totalReturns: periodReturns.length,
            totalRefundAmount: periodReturns.reduce((sum, r) => sum + (r.refundAmount || 0), 0),
            byType: {
                refund: periodReturns.filter(r => r.returnType === 'refund'),
                credit: periodReturns.filter(r => r.returnType === 'credit'),
                exchange: periodReturns.filter(r => r.returnType === 'exchange')
            },
            byReason: this.groupByField(periodReturns, 'reason'),
            byCondition: this.groupByField(periodReturns, 'condition')
        };
    }

    /**
     * Group returns by a field
     */
    groupByField(returns, field) {
        return returns.reduce((groups, r) => {
            const key = r[field] || 'Other';
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
            return groups;
        }, {});
    }

    /**
     * Render return modal for a sale
     */
    renderReturnModal(saleId) {
        const sale = state.allSales.find(s => s.id === saleId);
        if (!sale) {
            Utils.showToast('Sale not found', 'error');
            return;
        }

        const product = state.allProducts.find(p => p.id === sale.productId || p.name === sale.product);
        const maxQuantity = sale.quantity || 1;

        const modal = document.createElement('div');
        modal.id = 'return-modal';
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <span class="close" onclick="document.getElementById('return-modal').remove()">&times;</span>
                <h3><i class="fas fa-undo"></i> Process Return</h3>
                
                <div class="sale-info" style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                    <p><strong>Sale Date:</strong> ${sale.date}</p>
                    <p><strong>Customer:</strong> ${sale.customer || sale.customerName || 'Walk-in'}</p>
                    <p><strong>Product:</strong> ${sale.product || product?.name}</p>
                    <p><strong>Original Qty:</strong> ${sale.quantity}</p>
                    <p><strong>Unit Price:</strong> ${Utils.formatCurrency(sale.price || product?.price)}</p>
                </div>
                
                <form id="return-form" onsubmit="salesReturns.handleReturnSubmit(event, '${saleId}', '${product?.id || ''}')">
                    <label>Quantity to Return *</label>
                    <input type="number" id="return-quantity" min="1" max="${maxQuantity}" value="1" required>
                    <small>Maximum: ${maxQuantity}</small>
                    
                    <label>Return Type *</label>
                    <select id="return-type" required>
                        <option value="">Select type...</option>
                        <option value="refund">Cash Refund</option>
                        <option value="credit">Store Credit</option>
                        <option value="exchange">Exchange</option>
                    </select>
                    
                    <label>Reason for Return *</label>
                    <select id="return-reason" required>
                        <option value="">Select reason...</option>
                        <option value="defective">Defective Product</option>
                        <option value="wrong_item">Wrong Item</option>
                        <option value="not_as_described">Not as Described</option>
                        <option value="changed_mind">Customer Changed Mind</option>
                        <option value="size_issue">Size/Fit Issue</option>
                        <option value="damaged">Damaged in Transit</option>
                        <option value="other">Other</option>
                    </select>
                    
                    <label>Item Condition *</label>
                    <select id="return-condition" required>
                        <option value="">Select condition...</option>
                        <option value="resellable">Resellable (Add back to inventory)</option>
                        <option value="damaged">Damaged (Cannot resell)</option>
                        <option value="defective">Defective (For supplier return)</option>
                    </select>
                    
                    <label>Notes</label>
                    <textarea id="return-notes" rows="2" placeholder="Additional details..."></textarea>
                    
                    <div id="refund-preview" style="background: #e8f5e9; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                        <p><strong>Refund Amount:</strong> <span id="refund-amount">${Utils.formatCurrency(sale.price || product?.price || 0)}</span></p>
                    </div>
                    
                    <div style="display: flex; gap: 1rem;">
                        <button type="submit" style="flex: 1; background: #28a745;">
                            <i class="fas fa-check"></i> Process Return
                        </button>
                        <button type="button" onclick="document.getElementById('return-modal').remove()" style="flex: 1; background: #6c757d;">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // Update refund preview when quantity changes
        document.getElementById('return-quantity').addEventListener('input', (e) => {
            const qty = parseInt(e.target.value) || 0;
            const unitPrice = sale.price || product?.price || 0;
            document.getElementById('refund-amount').textContent = Utils.formatCurrency(unitPrice * qty);
        });
    }

    /**
     * Handle return form submission
     */
    async handleReturnSubmit(event, saleId, productId) {
        event.preventDefault();

        const returnData = {
            saleId,
            productId,
            quantity: document.getElementById('return-quantity').value,
            returnType: document.getElementById('return-type').value,
            reason: document.getElementById('return-reason').value,
            condition: document.getElementById('return-condition').value,
            notes: document.getElementById('return-notes').value
        };

        const result = await this.processReturn(returnData);
        
        if (result.success) {
            document.getElementById('return-modal').remove();
            // Refresh sales view
            if (window.appController) {
                window.appController.renderSales();
            }
        }
    }

    /**
     * Render returns history table
     */
    async renderReturnsTable() {
        const returns = await this.getReturns();
        
        if (returns.length === 0) {
            return '<p class="no-data">No returns recorded yet.</p>';
        }

        let html = `
            <div class="table-responsive">
                <table class="returns-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Product</th>
                            <th>Qty</th>
                            <th>Amount</th>
                            <th>Type</th>
                            <th>Reason</th>
                            <th>Condition</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        returns.forEach(r => {
            const typeClass = r.returnType === 'refund' ? 'type-refund' : 
                             r.returnType === 'credit' ? 'type-credit' : 'type-exchange';
            
            html += `
                <tr>
                    <td>${new Date(r.createdAt).toLocaleDateString()}</td>
                    <td>${r.productName}</td>
                    <td>${r.quantity}</td>
                    <td>${Utils.formatCurrency(r.refundAmount)}</td>
                    <td><span class="return-type ${typeClass}">${r.returnType}</span></td>
                    <td>${r.reason}</td>
                    <td>${r.condition}</td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        return html;
    }
}

export const salesReturns = new SalesReturnsService();
window.salesReturns = salesReturns;
