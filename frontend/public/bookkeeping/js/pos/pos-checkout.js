// ==================== POS CHECKOUT ====================
import { POSUI } from './pos-ui.js';
import { POSData } from './pos-data.js';
import { addDoc, updateDoc, doc, collection, db } from '../config/firebase.js';
import { state } from '../utils/state.js';
import { POSInvoice } from './pos-invoice.js';

export const POSCheckout = {
    
    async processSale(cartData, customerName) {
        try {
            
            
            // Validate cart
            if (!cartData.items || cartData.items.length === 0) {
                throw new Error('Cart is empty');
            }
            
            console.log('🛒 POS processing sale for', cartData.items.length, 'items');
            
            // ⭐ Determine paths based on user role (EXACTLY like handleBulkSale and pos11.html)
            let salesCollection, inventoryPath;
            
            if (state.assignedOutlet && state.parentAdminId) {
                // Outlet manager: Use outlet-specific paths
                console.log('🏪 OUTLET MANAGER - Creating individual sales in:');
                console.log(`   users/${state.parentAdminId}/outlets/${state.assignedOutlet}/outlet_sales`);
                
                salesCollection = collection(db, 'users', state.parentAdminId, 'outlets', state.assignedOutlet, 'outlet_sales');
                inventoryPath = (productId) => doc(db, 'users', state.parentAdminId, 'outlets', state.assignedOutlet, 'outlet_inventory', productId);
            } else {
                // Admin: Use main collections
                console.log('👤 ADMIN - Creating individual sales in: sales');
                
                salesCollection = collection(db, 'sales');
                inventoryPath = (productId) => doc(db, 'inventory', productId);
            }
            
            const date = new Date().toISOString().split('T')[0];
            const customer = customerName || 'Walk-in Customer';
            
            console.log('');
            console.log('═══════════════════════════════════════════════');
            console.log('CREATING INDIVIDUAL SALES (EXACTLY like pos11.html)');
            console.log('═══════════════════════════════════════════════');
            
            // ⭐ CRITICAL: Loop through items and create individual sales
            // This is EXACTLY how pos11.html does it!
            for (const item of cartData.items) {
                const product = state.products.find(p => p.id === item.productId);
                if (!product) {
                    console.warn(`❌ Product not found: ${item.productId}`);
                    continue;
                }
                
                console.log('');
                console.log(`📄 Creating sale for: ${item.name}`);
                console.log(`   Quantity: ${item.quantity}`);
                console.log(`   Price: ₵${item.price}`);
                
                // ⭐ Individual sale document (EXACTLY like pos11.html)
                const saleData = {
                    productId: item.productId,      // Product ID
                    product: item.name,              // ⭐ Single product name (NOT items array!)
                    quantity: item.quantity,
                    price: item.price,
                    discount: cartData.discount || 0,
                    tax: cartData.tax || 0,
                    customer: customer,
                    date: date,
                    createdAt: new Date().toISOString(),
                    
                    // Additional POS metadata
                    cost: product.cost || 0,
                    createdBy: state.currentUser?.email || 'Unknown',
                    location: state.assignedOutlet || 'main',
                    source: 'POS',
                    isPOSPurchase: true,
                    outlet: state.assignedOutlet || null,
                    parentAdminId: state.parentAdminId || null,
                    cashier: state.currentUser?.email || 'Unknown',
                    userRole: state.userRole || 'admin'
                };

                console.log(`   ✅ Sale Data:`, saleData);
                
                // ⭐ Add individual sale document (EXACTLY like pos11.html)
                await addDoc(salesCollection, saleData);
                
                console.log(`   ✅ Sale document created`);
                
                // ⭐ Update inventory (EXACTLY like pos11.html)
                await updateDoc(inventoryPath(item.productId), {
                    quantity: product.quantity - item.quantity,
                    lastSold: new Date().toISOString()
                });
                console.log(`   📦 Inventory: ${product.quantity} → ${product.quantity - item.quantity}`);
                
                // Update local state
                product.quantity -= item.quantity;
            }
            
            console.log('');
            console.log('═══════════════════════════════════════════════');
            console.log(`✅ SUCCESS: ${cartData.items.length} individual sales created!`);
            console.log('═══════════════════════════════════════════════');
            console.log('');
            
            // Prepare invoice data (for receipt display only)
            const invoiceData = {
                date: date,
                customer: customer,
                items: cartData.items,
                subtotal: cartData.subtotal,
                discount: cartData.discount || 0,
                tax: cartData.tax || 0,
                total: cartData.total
            };
            
            // Show receipt
            POSInvoice.show(invoiceData);

            return invoiceData;

        } catch (error) {
            console.error('❌ POS Checkout error:', error);
            throw error;
        }
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
