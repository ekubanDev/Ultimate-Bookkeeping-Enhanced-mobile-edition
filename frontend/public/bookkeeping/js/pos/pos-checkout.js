// ==================== POS CHECKOUT ====================
import { POSUI } from './pos-ui.js';
import { POSData } from './pos-data.js';
import { updateDoc, doc, collection, db, writeBatch } from '../config/firebase.js';
import { state } from '../utils/state.js';
import { POSInvoice } from './pos-invoice.js';
import { getSaleTotal } from '../utils/accounting.js';

export const POSCheckout = {
    
    async processSale(cartData, customerName) {
        if (!cartData.items || cartData.items.length === 0) {
            throw new Error('Cart is empty');
        }

        // Determine collection paths based on role
        let salesCollection, inventoryPath;
        if (state.assignedOutlet && state.parentAdminId) {
            salesCollection = collection(db, 'users', state.parentAdminId, 'outlets', state.assignedOutlet, 'outlet_sales');
            inventoryPath = (productId) => doc(db, 'users', state.parentAdminId, 'outlets', state.assignedOutlet, 'outlet_inventory', productId);
        } else {
            salesCollection = collection(db, 'sales');
            inventoryPath = (productId) => doc(db, 'inventory', productId);
        }

        const date = new Date().toISOString().split('T')[0];
        const customer = customerName || 'Walk-in Customer';
        const batch = writeBatch(db);

        // Build all sale + inventory ops in one batch
        const invoiceItems = [];
        for (const item of cartData.items) {
            const product = state.products.find(p => p.id === item.productId);
            if (!product) {
                console.warn('[POSCheckout] product not found in state:', item.productId);
                continue;
            }

            const qty      = item.quantity;
            const price    = item.price;
            const discount = cartData.discount || 0;
            const tax      = cartData.tax || 0;
            // Compute canonical total so getSaleTotal() uses the stored field on every surface
            const itemTotal = getSaleTotal({ quantity: qty, price, discount, tax });

            const saleData = {
                productId:    item.productId,
                product:      item.name,
                quantity:     qty,
                price:        price,
                discount:     discount,
                tax:          tax,
                total:        itemTotal,   // ← canonical stored total
                cost:         product.cost || 0,
                customer:     customer,
                date:         date,
                createdAt:    new Date().toISOString(),
                createdBy:    state.currentUser?.email || 'Unknown',
                cashier:      state.currentUser?.email || 'Unknown',
                location:     state.assignedOutlet || 'main',
                source:       'POS',
                isPOSPurchase: true,
                outlet:       state.assignedOutlet || null,
                parentAdminId: state.parentAdminId || null,
                userRole:     state.userRole || 'admin'
            };

            // Sale doc — use a new doc ref so we can set it in the batch
            const saleRef = doc(salesCollection);
            batch.set(saleRef, saleData);

            // Inventory decrement
            batch.update(inventoryPath(item.productId), {
                quantity: product.quantity - qty,
                lastSold: new Date().toISOString()
            });

            // Optimistic local state update
            product.quantity -= qty;

            invoiceItems.push({ ...item, subtotal: itemTotal });
        }

        try {
            await batch.commit();
        } catch (error) {
            console.error('[POSCheckout] batch commit failed:', error);
            throw error;
        }

        const invoiceData = {
            date,
            customer,
            items: invoiceItems,
            subtotal: cartData.subtotal,
            discount: cartData.discount || 0,
            tax: cartData.tax || 0,
            total: cartData.total
        };

        POSInvoice.show(invoiceData);
        return invoiceData;
    },

    generateInvoicePreview(cartData) {
        const lines = ['========== INVOICE =========='];
        lines.push(`Date: ${new Date().toLocaleString()}`);
        
        if (state.assignedOutlet) {
            lines.push(`Outlet: ${state.assignedOutlet}`);
        }
        
        lines.push('');
        
        cartData.items.forEach(item => {
            lines.push(`${item.name}`);
            lines.push(`  ${item.quantity} × ₵${item.price.toFixed(2)} = ₵${item.subtotal.toFixed(2)}`);
            if (item.discount > 0) {
                lines.push(`  Discount: -₵${item.discount.toFixed(2)}`);
            }
            lines.push('');
        });

        lines.push('-----------------------------');
        lines.push(`Subtotal: ₵${cartData.subtotal.toFixed(2)}`);
        
        if (cartData.discount > 0) {
            lines.push(`Discount: -₵${cartData.discount.toFixed(2)}`);
        }
        
        if (cartData.tax > 0) {
            lines.push(`Tax: ₵${cartData.tax.toFixed(2)}`);
        }
        
        lines.push(`TOTAL: ₵${cartData.total.toFixed(2)}`);
        lines.push('=============================');
        
        return lines.join('\n');
    }
};
