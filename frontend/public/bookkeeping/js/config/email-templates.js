// ==================== EMAIL TEMPLATES ====================

/**
 * Email Templates
 * Pre-designed HTML email templates for various notifications
 */

import { Utils } from '../utils/utils.js';

export const emailTemplates = {
    // ==================== LOW STOCK ALERT ====================
    lowStockAlert: (product) => `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #dc3545, #c82333); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .alert-box { background: white; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; }
                .product-details { background: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
                .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 15px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>⚠️ Low Stock Alert</h1>
                </div>
                <div class="content">
                    <div class="alert-box">
                        <h2>Inventory Running Low!</h2>
                        <p>The following product needs to be restocked soon:</p>
                    </div>
                    
                    <div class="product-details">
                        <h3>${product.name}</h3>
                        <p><strong>Category:</strong> ${product.category}</p>
                        <p><strong>Current Stock:</strong> <span style="color: #dc3545; font-size: 20px; font-weight: bold;">${product.quantity}</span></p>
                        <p><strong>Minimum Stock Level:</strong> ${product.minStock || 10}</p>
                        <p><strong>Selling Price:</strong> ${Utils.formatCurrency(product.price)}</p>
                    </div>
                    
                    <p>Please reorder this product to avoid stockouts.</p>
                    
                    <a href="${window.location.origin}?section=inventory" class="button">
                        View Inventory
                    </a>
                </div>
                <div class="footer">
                    <p>This is an automated notification from your bookkeeping system.</p>
                    <p>© ${new Date().getFullYear()} Ultimate Bookkeeping</p>
                </div>
            </div>
        </body>
        </html>
    `,

    // ==================== SALE CONFIRMATION ====================
    saleConfirmation: (sale) => `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #28a745, #218838); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .sale-details { background: white; padding: 20px; border-radius: 4px; margin: 15px 0; }
                .total { font-size: 24px; color: #007bff; font-weight: bold; text-align: right; margin-top: 15px; padding-top: 15px; border-top: 2px solid #dee2e6; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>✅ Purchase Confirmed</h1>
                    <p>Thank you for your purchase!</p>
                </div>
                <div class="content">
                    <div class="sale-details">
                        <h2>Order #${sale.id}</h2>
                        <p><strong>Date:</strong> ${Utils.formatDate(sale.date)}</p>
                        <p><strong>Customer:</strong> ${sale.customer}</p>
                        
                        <h3>Items Purchased:</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr style="background: #f8f9fa;">
                                <th style="text-align: left; padding: 10px;">Product</th>
                                <th style="text-align: center; padding: 10px;">Qty</th>
                                <th style="text-align: right; padding: 10px;">Price</th>
                            </tr>
                            <tr>
                                <td style="padding: 10px;">${sale.productName}</td>
                                <td style="text-align: center; padding: 10px;">${sale.quantity}</td>
                                <td style="text-align: right; padding: 10px;">${Utils.formatCurrency(sale.price)}</td>
                            </tr>
                        </table>
                        
                        ${sale.discount ? `<p><strong>Discount:</strong> ${sale.discount}%</p>` : ''}
                        ${sale.tax ? `<p><strong>Tax:</strong> ${sale.tax}%</p>` : ''}
                        
                        <div class="total">
                            Total: ${Utils.formatCurrency(sale.total)}
                        </div>
                    </div>
                    
                    <p style="text-align: center;">We appreciate your business!</p>
                </div>
                <div class="footer">
                    <p>Questions? Contact us at support@bookkeeping.app</p>
                    <p>© ${new Date().getFullYear()} Ultimate Bookkeeping</p>
                </div>
            </div>
        </body>
        </html>
    `,

    // ==================== INVOICE ====================
    invoice: (invoice) => `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 700px; margin: 0 auto; padding: 20px; background: white; }
                .header { display: flex; justify-content: space-between; border-bottom: 2px solid #007bff; padding-bottom: 20px; margin-bottom: 20px; }
                .invoice-title { font-size: 32px; color: #007bff; font-weight: bold; }
                .invoice-number { font-size: 18px; color: #666; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th { background: #f8f9fa; padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6; }
                td { padding: 12px; border-bottom: 1px solid #dee2e6; }
                .total-section { background: #f8f9fa; padding: 15px; margin-top: 20px; text-align: right; }
                .grand-total { font-size: 24px; color: #007bff; font-weight: bold; }
                .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div>
                        <div class="invoice-title">INVOICE</div>
                        <div class="invoice-number">#${invoice.invoiceNumber}</div>
                    </div>
                    <div style="text-align: right;">
                        <strong>${invoice.businessName}</strong><br>
                        ${invoice.businessAddress || ''}<br>
                        ${invoice.businessPhone || ''}
                    </div>
                </div>
                
                <div style="display: flex; justify-content: space-between; margin: 20px 0;">
                    <div>
                        <strong>Bill To:</strong><br>
                        ${invoice.customerName}<br>
                        ${invoice.customerEmail || ''}<br>
                        ${invoice.customerPhone || ''}
                    </div>
                    <div style="text-align: right;">
                        <strong>Invoice Date:</strong> ${Utils.formatDate(invoice.date)}<br>
                        <strong>Due Date:</strong> ${Utils.formatDate(invoice.dueDate)}
                    </div>
                </div>
                
                <table>
                    <thead>
                        <tr>
                            <th>Description</th>
                            <th style="text-align: center;">Quantity</th>
                            <th style="text-align: right;">Unit Price</th>
                            <th style="text-align: right;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${invoice.items.map(item => `
                            <tr>
                                <td>${item.description}</td>
                                <td style="text-align: center;">${item.quantity}</td>
                                <td style="text-align: right;">${Utils.formatCurrency(item.unitPrice)}</td>
                                <td style="text-align: right;">${Utils.formatCurrency(item.amount)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <div class="total-section">
                    <div>Subtotal: ${Utils.formatCurrency(invoice.subtotal)}</div>
                    ${invoice.discount ? `<div>Discount (${invoice.discountPercent}%): -${Utils.formatCurrency(invoice.discount)}</div>` : ''}
                    ${invoice.tax ? `<div>Tax (${invoice.taxPercent}%): ${Utils.formatCurrency(invoice.tax)}</div>` : ''}
                    <div class="grand-total" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid #007bff;">
                        Total: ${Utils.formatCurrency(invoice.total)}
                    </div>
                </div>
                
                <div class="footer">
                    <p><strong>Payment Terms:</strong> ${invoice.paymentTerms || 'Due upon receipt'}</p>
                    <p>Thank you for your business!</p>
                    <p style="font-size: 12px; color: #999;">This is a computer-generated invoice and requires no signature.</p>
                </div>
            </div>
        </body>
        </html>
    `,

    // ==================== DAILY SUMMARY ====================
    dailySummary: (summary) => `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #007bff, #0056b3); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0; }
                .metric-card { background: white; padding: 15px; border-radius: 4px; text-align: center; }
                .metric-value { font-size: 28px; font-weight: bold; color: #007bff; }
                .metric-label { font-size: 14px; color: #666; margin-top: 5px; }
                .highlight { background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 15px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📊 Daily Business Summary</h1>
                    <p>${Utils.formatDate(summary.date)}</p>
                </div>
                <div class="content">
                    <div class="metric-grid">
                        <div class="metric-card">
                            <div class="metric-value">${Utils.formatCurrency(summary.totalRevenue)}</div>
                            <div class="metric-label">Total Revenue</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${Utils.formatCurrency(summary.totalExpenses)}</div>
                            <div class="metric-label">Total Expenses</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value" style="color: #28a745;">${Utils.formatCurrency(summary.profit)}</div>
                            <div class="metric-label">Net Profit</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${summary.salesCount}</div>
                            <div class="metric-label">Sales Made</div>
                        </div>
                    </div>
                    
                    ${summary.topProduct ? `
                        <div class="highlight">
                            <strong>🏆 Top Selling Product:</strong><br>
                            ${summary.topProduct.name} (${summary.topProduct.unitsSold} units)
                        </div>
                    ` : ''}
                    
                    ${summary.lowStockItems && summary.lowStockItems.length > 0 ? `
                        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0;">
                            <strong>⚠️ Low Stock Alert:</strong><br>
                            ${summary.lowStockItems.length} items need restocking
                        </div>
                    ` : ''}
                    
                    <p style="text-align: center; margin-top: 20px;">
                        <a href="${window.location.origin}?section=analytics" 
                           style="display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                            View Full Analytics
                        </a>
                    </p>
                </div>
                <div class="footer">
                    <p>Automated daily report from your bookkeeping system</p>
                    <p>© ${new Date().getFullYear()} Ultimate Bookkeeping</p>
                </div>
            </div>
        </body>
        </html>
    `,

    // ==================== WEEKLY SUMMARY ====================
    weeklySummary: (summary) => `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 700px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #6f42c1, #5a32a3); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 20px 0; }
                .metric-card { background: white; padding: 15px; border-radius: 4px; text-align: center; }
                .metric-value { font-size: 24px; font-weight: bold; color: #6f42c1; }
                .metric-label { font-size: 13px; color: #666; margin-top: 5px; }
                .chart-section { background: white; padding: 20px; border-radius: 4px; margin: 20px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📈 Weekly Business Report</h1>
                    <p>${summary.weekStart} - ${summary.weekEnd}</p>
                </div>
                <div class="content">
                    <h2>Financial Overview</h2>
                    <div class="metric-grid">
                        <div class="metric-card">
                            <div class="metric-value">${Utils.formatCurrency(summary.weeklyRevenue)}</div>
                            <div class="metric-label">Weekly Revenue</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${Utils.formatCurrency(summary.weeklyExpenses)}</div>
                            <div class="metric-label">Weekly Expenses</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value" style="color: #28a745;">${Utils.formatCurrency(summary.weeklyProfit)}</div>
                            <div class="metric-label">Weekly Profit</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${summary.totalSales}</div>
                            <div class="metric-label">Total Sales</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${summary.newCustomers}</div>
                            <div class="metric-label">New Customers</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${Utils.formatCurrency(summary.averageSale)}</div>
                            <div class="metric-label">Avg Sale Value</div>
                        </div>
                    </div>
                    
                    ${summary.topProducts && summary.topProducts.length > 0 ? `
                        <div class="chart-section">
                            <h3>🏆 Top 5 Products This Week</h3>
                            <ol>
                                ${summary.topProducts.slice(0, 5).map(p => `
                                    <li>${p.name} - ${p.unitsSold} units (${Utils.formatCurrency(p.revenue)})</li>
                                `).join('')}
                            </ol>
                        </div>
                    ` : ''}
                    
                    <p style="text-align: center; margin-top: 30px;">
                        <a href="${window.location.origin}?section=analytics" 
                           style="display: inline-block; background: #6f42c1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                            View Detailed Reports
                        </a>
                    </p>
                </div>
                <div class="footer">
                    <p>Automated weekly report from your bookkeeping system</p>
                    <p>© ${new Date().getFullYear()} Ultimate Bookkeeping</p>
                </div>
            </div>
        </body>
        </html>
    `,

    // ==================== SETTLEMENT NOTIFICATION ====================
    settlement: (settlement) => `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #17a2b8, #138496); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .settlement-details { background: white; padding: 20px; border-radius: 4px; margin: 15px 0; }
                .amount { font-size: 32px; color: #28a745; font-weight: bold; text-align: center; margin: 20px 0; }
                .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 15px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>💰 Settlement Statement</h1>
                    <p>Statement #${settlement.settlementNumber}</p>
                </div>
                <div class="content">
                    <div class="settlement-details">
                        <p><strong>Outlet:</strong> ${settlement.outletName}</p>
                        <p><strong>Period:</strong> ${settlement.startDate} to ${settlement.endDate}</p>
                        <p><strong>Generated:</strong> ${Utils.formatDate(settlement.generatedDate)}</p>
                        
                        <hr style="margin: 20px 0;">
                        
                        <table style="width: 100%;">
                            <tr>
                                <td>Total Sales:</td>
                                <td style="text-align: right;">${Utils.formatCurrency(settlement.totalSales)}</td>
                            </tr>
                            <tr>
                                <td>Commission (${settlement.commissionRate}%):</td>
                                <td style="text-align: right;">${Utils.formatCurrency(settlement.commission)}</td>
                            </tr>
                            <tr>
                                <td>Previous Balance:</td>
                                <td style="text-align: right;">${Utils.formatCurrency(settlement.previousBalance)}</td>
                            </tr>
                        </table>
                        
                        <div class="amount">
                            Net Amount: ${Utils.formatCurrency(settlement.netAmount)}
                        </div>
                    </div>
                    
                    <p style="text-align: center;">
                        <a href="${window.location.origin}?section=settlements" class="button">
                            View Full Statement
                        </a>
                    </p>
                </div>
                <div class="footer">
                    <p>This settlement statement has been automatically generated.</p>
                    <p>© ${new Date().getFullYear()} Ultimate Bookkeeping</p>
                </div>
            </div>
        </body>
        </html>
    `,

    // ==================== EXPENSE APPROVAL ====================
    expenseApproval: (expense) => `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #ffc107, #e0a800); color: #333; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .expense-details { background: white; padding: 20px; border-radius: 4px; margin: 15px 0; }
                .actions { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
                .button { display: inline-block; padding: 12px 24px; text-decoration: none; border-radius: 4px; color: white; font-weight: bold; }
                .approve { background: #28a745; }
                .reject { background: #dc3545; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📝 Expense Approval Required</h1>
                </div>
                <div class="content">
                    <div class="expense-details">
                        <h3>${expense.description}</h3>
                        <p><strong>Category:</strong> ${expense.category}</p>
                        <p><strong>Amount:</strong> ${Utils.formatCurrency(expense.amount)}</p>
                        <p><strong>Date:</strong> ${Utils.formatDate(expense.date)}</p>
                        <p><strong>Submitted by:</strong> ${expense.submittedBy}</p>
                        ${expense.notes ? `<p><strong>Notes:</strong> ${expense.notes}</p>` : ''}
                    </div>
                    
                    <div class="actions">
                        <a href="${window.location.origin}?action=approve-expense&id=${expense.id}" class="button approve">
                            ✓ Approve
                        </a>
                        <a href="${window.location.origin}?action=reject-expense&id=${expense.id}" class="button reject">
                            ✗ Reject
                        </a>
                    </div>
                </div>
                <div class="footer">
                    <p>Please review and approve or reject this expense.</p>
                    <p>© ${new Date().getFullYear()} Ultimate Bookkeeping</p>
                </div>
            </div>
        </body>
        </html>
    `,

    // ==================== CONSIGNMENT CONFIRMATION ====================
    consignmentConfirmation: (consignment) => `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #007bff, #0056b3); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .consignment-details { background: white; padding: 20px; border-radius: 4px; margin: 15px 0; }
                table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                th, td { padding: 10px; text-align: left; border-bottom: 1px solid #dee2e6; }
                th { background: #f8f9fa; }
                .button { display: inline-block; background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 15px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📦 Consignment Delivery</h1>
                    <p>Consignment #${consignment.id}</p>
                </div>
                <div class="content">
                    <div class="consignment-details">
                        <p><strong>To:</strong> ${consignment.outletName}</p>
                        <p><strong>Delivery Date:</strong> ${Utils.formatDate(consignment.deliveryDate)}</p>
                        
                        <h3>Products Delivered:</h3>
                        <table>
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>Quantity</th>
                                    <th>Unit Price</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${consignment.products.map(p => `
                                    <tr>
                                        <td>${p.name}</td>
                                        <td>${p.quantity}</td>
                                        <td>${Utils.formatCurrency(p.price)}</td>
                                        <td>${Utils.formatCurrency(p.quantity * p.price)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        
                        <p style="text-align: right; font-size: 20px; font-weight: bold;">
                            Total Value: ${Utils.formatCurrency(consignment.totalValue)}
                        </p>
                    </div>
                    
                    <p style="text-align: center;">
                        Please confirm receipt of this consignment.
                    </p>
                    
                    <p style="text-align: center;">
                        <a href="${window.location.origin}?action=confirm-consignment&id=${consignment.id}" class="button">
                            Confirm Receipt
                        </a>
                    </p>
                </div>
                <div class="footer">
                    <p>This consignment has been dispatched to your outlet.</p>
                    <p>© ${new Date().getFullYear()} Ultimate Bookkeeping</p>
                </div>
            </div>
        </body>
        </html>
    `,

    // ==================== CUSTOMER WELCOME ====================
    customerWelcome: (customer) => `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #28a745, #218838); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
                .welcome-message { background: white; padding: 20px; border-radius: 4px; margin: 15px 0; text-align: center; }
                .benefits { background: white; padding: 20px; border-radius: 4px; margin: 15px 0; }
                .benefit-item { margin: 10px 0; padding-left: 25px; position: relative; }
                .benefit-item:before { content: "✓"; position: absolute; left: 0; color: #28a745; font-weight: bold; }
                .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 15px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🎉 Welcome!</h1>
                    <p>We're excited to have you!</p>
                </div>
                <div class="content">
                    <div class="welcome-message">
                        <h2>Hello ${customer.name}!</h2>
                        <p>Thank you for choosing us. We're thrilled to have you as a valued customer.</p>
                    </div>
                    
                    <div class="benefits">
                        <h3>What you can expect:</h3>
                        <div class="benefit-item">Quality products and excellent service</div>
                        <div class="benefit-item">Regular updates on new products</div>
                        <div class="benefit-item">Exclusive deals and promotions</div>
                        <div class="benefit-item">Personalized customer support</div>
                    </div>
                    
                    <p style="text-align: center;">
                        <a href="${window.location.origin}" class="button">
                            Start Shopping
                        </a>
                    </p>
                </div>
                <div class="footer">
                    <p>Need help? Contact us at support@bookkeeping.app</p>
                    <p>© ${new Date().getFullYear()} Ultimate Bookkeeping</p>
                </div>
            </div>
        </body>
        </html>
    `
};
