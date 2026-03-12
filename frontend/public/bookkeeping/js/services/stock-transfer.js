/**
 * Stock Transfer Service
 * Manages inventory transfers between outlets
 */

import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';
import { db, collection, doc, addDoc, updateDoc, getDocs, increment, serverTimestamp } from '../config/firebase.js';
import { firebaseService } from './firebase-service.js';
import ActivityLogger from './activity-logger.js';

class StockTransferService {
    /**
     * Create a stock transfer between outlets
     */
    async createTransfer(transferData) {
        try {
            Utils.showSpinner();

            const {
                fromOutletId,
                toOutletId,
                items,  // Array of { productId, productName, quantity }
                notes,
                transferDate
            } = transferData;

            // Validate outlets
            if (fromOutletId === toOutletId) {
                throw new Error('Cannot transfer to the same outlet');
            }

            // Generate transfer number
            const transferNumber = `TRF-${Date.now().toString().slice(-8)}`;

            // Calculate total items and value
            let totalItems = 0;
            let totalValue = 0;

            const processedItems = items.map(item => {
                const product = state.allProducts.find(p => p.id === item.productId);
                const cost = parseFloat(product?.cost) || 0;
                const value = cost * parseInt(item.quantity);
                totalItems += parseInt(item.quantity);
                totalValue += value;

                return {
                    productId: item.productId,
                    productName: item.productName || product?.name,
                    quantity: parseInt(item.quantity),
                    unitCost: cost,
                    totalValue: value
                };
            });

            // Create transfer record
            const transfer = {
                transferNumber,
                fromOutletId,
                fromOutletName: this.getOutletName(fromOutletId),
                toOutletId,
                toOutletName: this.getOutletName(toOutletId),
                items: processedItems,
                totalItems,
                totalValue,
                status: 'pending', // pending, in_transit, received, cancelled
                notes,
                transferDate: transferDate || new Date().toISOString().split('T')[0],
                createdBy: state.currentUser?.email,
                createdAt: new Date().toISOString(),
                userId: state.currentUser?.uid
            };

            // Save transfer
            const docRef = await addDoc(firebaseService.getUserCollection('stock_transfers'), transfer);

            // Update source outlet inventory (deduct)
            for (const item of processedItems) {
                await this.updateOutletInventory(fromOutletId, item.productId, -item.quantity);
            }

            // Log activity
            await ActivityLogger.log('stock_transfer_created', {
                transferNumber,
                from: transfer.fromOutletName,
                to: transfer.toOutletName,
                items: totalItems,
                value: totalValue
            });

            Utils.hideSpinner();
            Utils.showToast(`Transfer ${transferNumber} created successfully`, 'success');
            
            return { success: true, transferId: docRef.id, transferNumber };
        } catch (error) {
            Utils.hideSpinner();
            console.error('Error creating transfer:', error);
            Utils.showToast('Failed to create transfer: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    }

    /**
     * Receive a transfer at destination outlet
     */
    async receiveTransfer(transferId, receivedItems = null) {
        try {
            Utils.showSpinner();

            // Get transfer details
            const transfers = await this.getTransfers();
            const transfer = transfers.find(t => t.id === transferId);
            
            if (!transfer) {
                throw new Error('Transfer not found');
            }

            if (transfer.status !== 'pending' && transfer.status !== 'in_transit') {
                throw new Error('Transfer has already been processed');
            }

            // Use provided received items or original items
            const itemsToReceive = receivedItems || transfer.items;

            // Update destination outlet inventory (add)
            for (const item of itemsToReceive) {
                const receivedQty = item.receivedQuantity !== undefined ? item.receivedQuantity : item.quantity;
                await this.updateOutletInventory(transfer.toOutletId, item.productId, receivedQty);
            }

            // Update transfer status
            const transferRef = doc(firebaseService.getUserCollection('stock_transfers'), transferId);
            await updateDoc(transferRef, {
                status: 'received',
                receivedAt: new Date().toISOString(),
                receivedBy: state.currentUser?.email,
                receivedItems: itemsToReceive
            });

            // Log activity
            await ActivityLogger.log('stock_transfer_received', {
                transferNumber: transfer.transferNumber,
                outlet: transfer.toOutletName
            });

            Utils.hideSpinner();
            Utils.showToast(`Transfer ${transfer.transferNumber} received successfully`, 'success');
            
            return { success: true };
        } catch (error) {
            Utils.hideSpinner();
            console.error('Error receiving transfer:', error);
            Utils.showToast('Failed to receive transfer: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel a pending transfer
     */
    async cancelTransfer(transferId, reason = '') {
        try {
            const transfers = await this.getTransfers();
            const transfer = transfers.find(t => t.id === transferId);
            
            if (!transfer) {
                throw new Error('Transfer not found');
            }

            if (transfer.status !== 'pending') {
                throw new Error('Can only cancel pending transfers');
            }

            // Return items to source outlet
            for (const item of transfer.items) {
                await this.updateOutletInventory(transfer.fromOutletId, item.productId, item.quantity);
            }

            // Update transfer status
            const transferRef = doc(firebaseService.getUserCollection('stock_transfers'), transferId);
            await updateDoc(transferRef, {
                status: 'cancelled',
                cancelledAt: new Date().toISOString(),
                cancelledBy: state.currentUser?.email,
                cancelReason: reason
            });

            Utils.showToast(`Transfer ${transfer.transferNumber} cancelled`, 'success');
            return { success: true };
        } catch (error) {
            console.error('Error cancelling transfer:', error);
            Utils.showToast('Failed to cancel transfer: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    }

    /**
     * Update outlet inventory
     */
    async updateOutletInventory(outletId, productId, quantityChange) {
        try {
            if (outletId === 'main') {
                // Update main inventory
                const productRef = doc(firebaseService.getUserCollection('inventory'), productId);
                await updateDoc(productRef, {
                    quantity: increment(quantityChange),
                    updatedAt: new Date().toISOString()
                });
                
                // Update local state
                const product = state.allProducts.find(p => p.id === productId);
                if (product) {
                    product.quantity = (parseInt(product.quantity) || 0) + quantityChange;
                }
            } else {
                // Update outlet inventory
                const outletInventoryRef = collection(db, 'users', state.currentUser?.uid, 'outlets', outletId, 'outlet_inventory');
                const snapshot = await getDocs(outletInventoryRef);
                const existingProduct = snapshot.docs.find(d => d.data().productId === productId);

                if (existingProduct) {
                    await updateDoc(doc(outletInventoryRef, existingProduct.id), {
                        quantity: increment(quantityChange),
                        updatedAt: new Date().toISOString()
                    });
                } else if (quantityChange > 0) {
                    // Add new product to outlet
                    const product = state.allProducts.find(p => p.id === productId);
                    await addDoc(outletInventoryRef, {
                        productId,
                        name: product?.name,
                        quantity: quantityChange,
                        cost: product?.cost,
                        price: product?.price,
                        category: product?.category,
                        createdAt: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            console.error('Error updating outlet inventory:', error);
            throw error;
        }
    }

    /**
     * Get outlet name
     */
    getOutletName(outletId) {
        if (outletId === 'main') return 'Main Office';
        const outlet = state.allOutlets.find(o => o.id === outletId);
        return outlet?.name || outletId;
    }

    /**
     * Get all transfers
     */
    async getTransfers(filters = {}) {
        try {
            const snapshot = await getDocs(firebaseService.getUserCollection('stock_transfers'));
            let transfers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Apply filters
            if (filters.status) {
                transfers = transfers.filter(t => t.status === filters.status);
            }
            if (filters.fromOutletId) {
                transfers = transfers.filter(t => t.fromOutletId === filters.fromOutletId);
            }
            if (filters.toOutletId) {
                transfers = transfers.filter(t => t.toOutletId === filters.toOutletId);
            }

            return transfers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } catch (error) {
            console.error('Error getting transfers:', error);
            return [];
        }
    }

    /**
     * Get pending transfers for an outlet
     */
    async getPendingTransfersForOutlet(outletId) {
        const transfers = await this.getTransfers({ status: 'pending' });
        return transfers.filter(t => t.toOutletId === outletId);
    }

    /**
     * Render transfer modal
     */
    renderTransferModal() {
        const outlets = [{ id: 'main', name: 'Main Office' }, ...state.allOutlets];
        const products = state.allProducts.filter(p => (parseInt(p.quantity) || 0) > 0);

        const modal = document.createElement('div');
        modal.id = 'stock-transfer-modal';
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('stock-transfer-modal').remove()">&times;</span>
                <h3><i class="fas fa-exchange-alt"></i> Create Stock Transfer</h3>
                
                <form id="stock-transfer-form" onsubmit="stockTransfer.handleTransferSubmit(event)">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label>Transfer From *</label>
                            <select id="transfer-from" required onchange="stockTransfer.updateProductList()">
                                ${outlets.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label>Transfer To *</label>
                            <select id="transfer-to" required>
                                <option value="">Select destination...</option>
                                ${outlets.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <label>Transfer Date *</label>
                            <input type="date" id="transfer-date" required value="${new Date().toISOString().split('T')[0]}">
                        </div>
                    </div>
                    
                    <div style="margin: 1.5rem 0;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                            <h4 style="margin: 0;">Items to Transfer</h4>
                            <button type="button" onclick="stockTransfer.addItemRow()" style="background: #28a745; padding: 0.5rem 1rem;">
                                <i class="fas fa-plus"></i> Add Item
                            </button>
                        </div>
                        <div id="transfer-items-container">
                            <!-- Item rows will be added here -->
                        </div>
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                        <div style="display: flex; justify-content: space-between;">
                            <span>Total Items:</span>
                            <strong id="transfer-total-items">0</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Total Value:</span>
                            <strong id="transfer-total-value">${Utils.formatCurrency(0)}</strong>
                        </div>
                    </div>
                    
                    <label>Notes</label>
                    <textarea id="transfer-notes" rows="2" placeholder="Transfer notes..."></textarea>
                    
                    <div style="display: flex; gap: 1rem; margin-top: 1rem;">
                        <button type="submit" style="flex: 1; background: #007bff;">
                            <i class="fas fa-paper-plane"></i> Create Transfer
                        </button>
                        <button type="button" onclick="document.getElementById('stock-transfer-modal').remove()" style="flex: 1; background: #6c757d;">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);
        this.addItemRow(); // Add first item row
    }

    /**
     * Add item row to transfer form
     */
    addItemRow() {
        const container = document.getElementById('transfer-items-container');
        const products = state.allProducts.filter(p => (parseInt(p.quantity) || 0) > 0);
        const rowIndex = container.children.length;

        const row = document.createElement('div');
        row.className = 'transfer-item-row';
        row.style.cssText = 'display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; padding: 0.5rem; background: #f8f9fa; border-radius: 4px;';
        row.innerHTML = `
            <select class="transfer-product" required onchange="stockTransfer.updateItemTotal(this)">
                <option value="">Select product...</option>
                ${products.map(p => `<option value="${p.id}" data-cost="${p.cost}" data-stock="${p.quantity}">${p.name} (Stock: ${p.quantity})</option>`).join('')}
            </select>
            <input type="number" class="transfer-quantity" min="1" value="1" required onchange="stockTransfer.updateItemTotal(this)" placeholder="Qty">
            <span class="transfer-item-value">${Utils.formatCurrency(0)}</span>
            <button type="button" onclick="this.closest('.transfer-item-row').remove(); stockTransfer.updateTotals();" style="background: #dc3545; padding: 0.3rem 0.5rem;">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(row);
    }

    /**
     * Update item total when product/quantity changes
     */
    updateItemTotal(element) {
        const row = element.closest('.transfer-item-row');
        const select = row.querySelector('.transfer-product');
        const quantityInput = row.querySelector('.transfer-quantity');
        const valueSpan = row.querySelector('.transfer-item-value');

        const selectedOption = select.options[select.selectedIndex];
        const cost = parseFloat(selectedOption?.dataset?.cost) || 0;
        const maxStock = parseInt(selectedOption?.dataset?.stock) || 0;
        const quantity = parseInt(quantityInput.value) || 0;

        // Validate quantity doesn't exceed stock
        if (quantity > maxStock) {
            quantityInput.value = maxStock;
            quantityInput.max = maxStock;
            Utils.showToast(`Maximum available: ${maxStock}`, 'warning');
        }

        const total = cost * Math.min(quantity, maxStock);
        valueSpan.textContent = Utils.formatCurrency(total);

        this.updateTotals();
    }

    /**
     * Update grand totals
     */
    updateTotals() {
        const rows = document.querySelectorAll('.transfer-item-row');
        let totalItems = 0;
        let totalValue = 0;

        rows.forEach(row => {
            const quantity = parseInt(row.querySelector('.transfer-quantity')?.value) || 0;
            const select = row.querySelector('.transfer-product');
            const cost = parseFloat(select?.options[select.selectedIndex]?.dataset?.cost) || 0;
            
            totalItems += quantity;
            totalValue += cost * quantity;
        });

        document.getElementById('transfer-total-items').textContent = totalItems;
        document.getElementById('transfer-total-value').textContent = Utils.formatCurrency(totalValue);
    }

    /**
     * Handle transfer form submission
     */
    async handleTransferSubmit(event) {
        event.preventDefault();

        const fromOutletId = document.getElementById('transfer-from').value;
        const toOutletId = document.getElementById('transfer-to').value;

        if (fromOutletId === toOutletId) {
            Utils.showToast('Cannot transfer to the same outlet', 'error');
            return;
        }

        // Collect items
        const items = [];
        const rows = document.querySelectorAll('.transfer-item-row');
        
        rows.forEach(row => {
            const select = row.querySelector('.transfer-product');
            const quantity = row.querySelector('.transfer-quantity').value;
            
            if (select.value && quantity > 0) {
                items.push({
                    productId: select.value,
                    productName: select.options[select.selectedIndex].text.split(' (')[0],
                    quantity: parseInt(quantity)
                });
            }
        });

        if (items.length === 0) {
            Utils.showToast('Please add at least one item', 'error');
            return;
        }

        const transferData = {
            fromOutletId,
            toOutletId,
            items,
            transferDate: document.getElementById('transfer-date').value,
            notes: document.getElementById('transfer-notes').value
        };

        const result = await this.createTransfer(transferData);
        
        if (result.success) {
            document.getElementById('stock-transfer-modal').remove();
            // Refresh outlets view
            if (window.appController) {
                window.appController.loadOutlets();
            }
        }
    }

    /**
     * Render transfers table
     */
    async renderTransfersTable() {
        const transfers = await this.getTransfers();
        
        if (transfers.length === 0) {
            return '<p class="no-data">No stock transfers recorded yet.</p>';
        }

        const statusColors = {
            pending: 'status-pending',
            in_transit: 'status-transit',
            received: 'status-received',
            cancelled: 'status-cancelled'
        };

        let html = `
            <div class="table-responsive">
                <table class="transfers-table">
                    <thead>
                        <tr>
                            <th>Transfer #</th>
                            <th>Date</th>
                            <th>From</th>
                            <th>To</th>
                            <th>Items</th>
                            <th>Value</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        transfers.forEach(t => {
            html += `
                <tr>
                    <td><strong>${t.transferNumber}</strong></td>
                    <td>${t.transferDate}</td>
                    <td>${t.fromOutletName}</td>
                    <td>${t.toOutletName}</td>
                    <td>${t.totalItems}</td>
                    <td>${Utils.formatCurrency(t.totalValue)}</td>
                    <td><span class="status-badge ${statusColors[t.status]}">${t.status}</span></td>
                    <td>
                        ${t.status === 'pending' ? `
                            <button onclick="stockTransfer.receiveTransfer('${t.id}')" class="btn-sm btn-success" title="Receive">
                                <i class="fas fa-check"></i>
                            </button>
                            <button onclick="stockTransfer.cancelTransfer('${t.id}')" class="btn-sm btn-danger" title="Cancel">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : ''}
                        <button onclick="stockTransfer.viewTransferDetails('${t.id}')" class="btn-sm btn-info" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        return html;
    }

    /**
     * View transfer details
     */
    async viewTransferDetails(transferId) {
        const transfers = await this.getTransfers();
        const transfer = transfers.find(t => t.id === transferId);
        
        if (!transfer) {
            Utils.showToast('Transfer not found', 'error');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'transfer-details-modal';
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 700px;">
                <span class="close" onclick="document.getElementById('transfer-details-modal').remove()">&times;</span>
                <h3><i class="fas fa-exchange-alt"></i> Transfer Details: ${transfer.transferNumber}</h3>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                        <p><strong>From:</strong> ${transfer.fromOutletName}</p>
                        <p><strong>To:</strong> ${transfer.toOutletName}</p>
                        <p><strong>Date:</strong> ${transfer.transferDate}</p>
                    </div>
                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                        <p><strong>Status:</strong> <span class="status-badge status-${transfer.status}">${transfer.status}</span></p>
                        <p><strong>Total Items:</strong> ${transfer.totalItems}</p>
                        <p><strong>Total Value:</strong> ${Utils.formatCurrency(transfer.totalValue)}</p>
                    </div>
                </div>
                
                <h4>Items</h4>
                <table style="width: 100%;">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Quantity</th>
                            <th>Unit Cost</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${transfer.items.map(item => `
                            <tr>
                                <td>${item.productName}</td>
                                <td>${item.quantity}</td>
                                <td>${Utils.formatCurrency(item.unitCost)}</td>
                                <td>${Utils.formatCurrency(item.totalValue)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                ${transfer.notes ? `<p style="margin-top: 1rem;"><strong>Notes:</strong> ${transfer.notes}</p>` : ''}
            </div>
        `;

        document.body.appendChild(modal);
    }
}

export const stockTransfer = new StockTransferService();
window.stockTransfer = stockTransfer;
