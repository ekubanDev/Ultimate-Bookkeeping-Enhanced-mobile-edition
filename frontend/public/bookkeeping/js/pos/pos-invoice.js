// ==================== POS INVOICE/RECEIPT ====================
import { POSUI } from './pos-ui.js';
import { state } from '../utils/state.js';
import { capacitorShare, capacitorWriteUtf8File } from '../utils/native-pdf-save.js';

export const POSInvoice = {
    
    show(saleData) {
        const receiptHTML = this.generateReceipt(saleData);
        
        // Create receipt modal if it doesn't exist
        let modal = document.getElementById('receipt-modal');
        if (!modal) {
            modal = this.createReceiptModal();
            document.body.appendChild(modal);
        }
        
        // Update modal content
        const modalBody = modal.querySelector('.modal-body');
        if (modalBody) {
            modalBody.innerHTML = receiptHTML;
        }
        
        modal.classList.add('active');
        
        // Store sale data for sharing
        this.currentSaleData = saleData;
    },

    createReceiptModal() {
        const modal = document.createElement('div');
        modal.id = 'receipt-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-body"></div>
                <div style="margin-top: 1rem; display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
                    <button class="btn btn-inventory" onclick="POSInvoice.handlePrint()" style="flex: 1; min-width: 120px;">
                        <i class="fas fa-print"></i> Print
                    </button>
                    <button class="btn btn-success" onclick="POSInvoice.handleShare()" style="flex: 1; min-width: 120px; background: #28a745;">
                        <i class="fas fa-share-alt"></i> Share
                    </button>
                    <button class="btn btn-primary" onclick="POSInvoice.handleDownload()" style="flex: 1; min-width: 120px; background: #007bff;">
                        <i class="fas fa-download"></i> Save
                    </button>
                    <button class="btn btn-clear" onclick="POSInvoice.close()" style="flex: 1; min-width: 120px;">
                        <i class="fas fa-times"></i> Close
                    </button>
                </div>
            </div>
        `;
        return modal;
    },

    generateReceipt(saleData) {
        const receiptId = 'RCPT-' + Date.now().toString().slice(-8);
        const date = new Date(saleData.date);
        const cashier = saleData.cashier || state.currentUser?.email || 'Cashier';
        const outlet = saleData.outlet || state.assignedOutlet || 'Main Outlet';

        return `
            <div class="receipt" id="receipt-content" style="font-family: 'Courier New', monospace; padding: 1rem; background: white; color: black;">
                <div style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 0.5rem;">
                    <h2 style="margin: 0; color: #333;">SALES RECEIPT</h2>
                    <p style="margin: 0.25rem 0; color: #666;">#${receiptId}</p>
                    <p style="margin: 0.25rem 0; color: #666;">${date.toLocaleString()}</p>
                </div>

                <div style="margin: 1rem 0; border-bottom: 1px solid #ccc; padding-bottom: 1rem;">
                    <table style="width: 100%; font-size: 0.9rem; color: #333;">
                        <tr><td>Cashier:</td><td style="text-align: right;">${cashier}</td></tr>
                        <tr><td>Outlet:</td><td style="text-align: right;">${outlet}</td></tr>
                        <tr><td>Customer:</td><td style="text-align: right;">${saleData.customer}</td></tr>
                    </table>
                </div>

                <table style="width: 100%; border-collapse: collapse; margin: 1rem 0; color: #333;">
                    <thead>
                        <tr style="border-bottom: 2px solid #333;">
                            <th style="text-align: left; padding: 0.5rem 0;">Item</th>
                            <th style="text-align: center;">Qty</th>
                            <th style="text-align: right;">Price</th>
                            <th style="text-align: right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${saleData.items.map(item => `
                            <tr style="border-bottom: 1px solid #eee;">
                                <td style="padding: 0.5rem 0;">${item.name}</td>
                                <td style="text-align: center;">${item.quantity}</td>
                                <td style="text-align: right;">₵${item.price.toFixed(2)}</td>
                                <td style="text-align: right;">₵${item.subtotal.toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div style="border-top: 2px solid #333; padding-top: 1rem; margin-top: 1rem;">
                    <table style="width: 100%; font-size: 1rem; color: #333;">
                        <tr><td>Subtotal:</td><td style="text-align: right;">₵${saleData.subtotal.toFixed(2)}</td></tr>
                        ${saleData.discount > 0 ? `
                            <tr><td>Discount:</td><td style="text-align: right;">-₵${saleData.discount.toFixed(2)}</td></tr>
                        ` : ''}
                        ${saleData.tax > 0 ? `
                            <tr><td>Tax:</td><td style="text-align: right;">₵${saleData.tax.toFixed(2)}</td></tr>
                        ` : ''}
                        <tr style="font-weight: bold; font-size: 1.2rem; border-top: 2px solid #333;">
                            <td style="padding-top: 0.5rem;">TOTAL:</td>
                            <td style="text-align: right; padding-top: 0.5rem;">₵${saleData.total.toFixed(2)}</td>
                        </tr>
                    </table>
                </div>

                <div style="text-align: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px dashed #999;">
                    <p style="margin: 0.5rem 0; color: #666;">Thank you for your business!</p>
                    <small style="color: #999;">Receipt generated: ${new Date().toLocaleString()}</small>
                </div>
            </div>
        `;
    },

    // Handle print action (mobile-friendly)
    async handlePrint() {
        if (this.isCapacitor()) {
            // Mobile: Show simple message
            POSUI.showNotification('Generating receipt for sharing...', 'info');
            await this.handleShare();
        } else {
            // Desktop: Use window.print
            window.print();
        }
    },

    // Handle share action (mobile-friendly)
    async handleShare() {
        if (!this.isCapacitor()) {
            POSUI.showNotification('Share feature is available on mobile app', 'info');
            return;
        }

        try {
            const text = this.generateTextReceipt(this.currentSaleData);
            
            await capacitorShare({
                title: 'Sales Receipt',
                text: text,
                dialogTitle: 'Share Receipt'
            });
            
            POSUI.showNotification('Receipt shared successfully', 'success');
        } catch (error) {
            console.error('Share error:', error);
            POSUI.showNotification('Share cancelled or failed', 'info');
        }
    },

    // Handle download action
    async handleDownload() {
        try {
            const text = this.generateTextReceipt(this.currentSaleData);
            
            if (this.isCapacitor()) {
                // Mobile: Save as text file
                try {
                    const fileName = `receipt-${Date.now()}.txt`;
                    await capacitorWriteUtf8File(fileName, text);
                    POSUI.showNotification('Receipt saved to Documents folder', 'success');
                } catch (fsError) {
                    console.error('Filesystem error:', fsError);
                    // Fallback to share
                    POSUI.showNotification('Opening share instead...', 'info');
                    await this.handleShare();
                }
            } else {
                // Desktop: Download as text file
                const blob = new Blob([text], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `receipt-${Date.now()}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                POSUI.showNotification('Receipt downloaded', 'success');
            }
        } catch (error) {
            console.error('Download error:', error);
            POSUI.showNotification('Failed to save: ' + error.message, 'error');
        }
    },

    // Generate text receipt for sharing/downloading
    generateTextReceipt(saleData) {
        const receiptId = 'RCPT-' + Date.now().toString().slice(-8);
        const date = new Date(saleData.date);
        const cashier = saleData.cashier || state.currentUser?.email || 'Cashier';
        const outlet = saleData.outlet || state.assignedOutlet || 'Main Outlet';
        
        let text = '========================================\n';
        text += '           SALES RECEIPT\n';
        text += '========================================\n';
        text += `Receipt #: ${receiptId}\n`;
        text += `Date: ${date.toLocaleString()}\n`;
        text += `Cashier: ${cashier}\n`;
        text += `Outlet: ${outlet}\n`;
        text += `Customer: ${saleData.customer}\n`;
        text += '========================================\n\n';
        
        text += 'ITEMS:\n';
        text += '----------------------------------------\n';
        saleData.items.forEach(item => {
            text += `${item.name}\n`;
            text += `  ${item.quantity} x ₵${item.price.toFixed(2)} = ₵${item.subtotal.toFixed(2)}\n`;
        });
        
        text += '----------------------------------------\n';
        text += `Subtotal:        ₵${saleData.subtotal.toFixed(2)}\n`;
        if (saleData.discount > 0) {
            text += `Discount:       -₵${saleData.discount.toFixed(2)}\n`;
        }
        if (saleData.tax > 0) {
            text += `Tax:            +₵${saleData.tax.toFixed(2)}\n`;
        }
        text += '========================================\n';
        text += `TOTAL:           ₵${saleData.total.toFixed(2)}\n`;
        text += '========================================\n\n';
        text += 'Thank you for your business!\n';
        text += `Generated: ${new Date().toLocaleString()}\n`;
        
        return text;
    },

    // Check if running in Capacitor
    isCapacitor() {
        return window.Capacitor !== undefined && window.Capacitor.isNativePlatform();
    },

    // Legacy print method (backward compatible)
    print() {
        this.handlePrint();
    },

    close() {
        const modal = document.getElementById('receipt-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }
};

// Make available globally for onclick handlers
window.POSInvoice = POSInvoice;
