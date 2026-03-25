// ==================== ENHANCED EXPORT SERVICE ====================

/**
 * Export Service
 * Handles data export in multiple formats (CSV, Excel, PDF)
 */

import { Utils } from '../utils/utils.js';
import { state } from '../utils/state.js';
import { db, collection, query, where, getDocs } from '../config/firebase.js';

class ExportService {
    constructor() {
        this.initialized = false;
    }

    // ==================== CSV EXPORT ====================

    exportToCSV(data, filename, columns = null) {
        if (!data || data.length === 0) {
            Utils.showToast('No data to export', 'warning');
            return;
        }

        // Get columns from first object if not provided
        const headers = columns || Object.keys(data[0]);
        
        // Build CSV content
        let csvContent = headers.join(',') + '\n';
        
        data.forEach(row => {
            const values = headers.map(header => {
                let value = row[header];
                
                // Handle special characters
                if (value === null || value === undefined) {
                    value = '';
                } else if (typeof value === 'string') {
                    // Escape quotes and wrap in quotes if contains comma
                    value = value.replace(/"/g, '""');
                    if (value.includes(',') || value.includes('\n')) {
                        value = `"${value}"`;
                    }
                }
                
                return value;
            });
            
            csvContent += values.join(',') + '\n';
        });

        this.downloadFile(csvContent, filename, 'text/csv');
        Utils.showToast('CSV exported successfully', 'success');
    }

    // ==================== EXCEL EXPORT (using SheetJS) ====================

    async exportToExcel(data, filename, sheetName = 'Data') {
        if (!data || data.length === 0) {
            Utils.showToast('No data to export', 'warning');
            return;
        }

        try {
            // Load SheetJS if not already loaded
            if (typeof XLSX === 'undefined') {
                await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
            }

            // Create workbook
            const wb = XLSX.utils.book_new();
            
            // Convert data to worksheet
            const ws = XLSX.utils.json_to_sheet(data);
            
            // Add worksheet to workbook
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            
            // Generate Excel file
            XLSX.writeFile(wb, filename);
            
            Utils.showToast('Excel file exported successfully', 'success');
        } catch (error) {
            console.error('Excel export failed:', error);
            Utils.showToast('Excel export failed', 'error');
        }
    }

    // ==================== PDF EXPORT (using jsPDF) ====================

    async exportToPDF(config) {
        try {
            // Load jsPDF if not already loaded
            if (typeof jspdf === 'undefined') {
                await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
                await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF(config.orientation || 'portrait');
            
            // Add title
            if (config.title) {
                doc.setFontSize(18);
                doc.text(config.title, 14, 20);
            }
            
            // Add subtitle/date
            if (config.subtitle) {
                doc.setFontSize(11);
                doc.text(config.subtitle, 14, 28);
            }
            
            // Add table if data provided
            if (config.data && config.columns) {
                doc.autoTable({
                    startY: config.title ? 35 : 20,
                    head: [config.columns.map(col => col.header)],
                    body: config.data.map(row => 
                        config.columns.map(col => row[col.dataKey])
                    ),
                    theme: 'grid',
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [0, 123, 255] }
                });
            }
            
            // Add footer
            const pageCount = doc.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.text(
                    `Page ${i} of ${pageCount}`,
                    doc.internal.pageSize.getWidth() / 2,
                    doc.internal.pageSize.getHeight() - 10,
                    { align: 'center' }
                );
            }
            
            doc.save(config.filename);
            Utils.showToast('PDF exported successfully', 'success');
        } catch (error) {
            console.error('PDF export failed:', error);
            Utils.showToast('PDF export failed', 'error');
        }
    }

    // ==================== SPECIALIZED EXPORTS ====================

    exportSalesReport(startDate, endDate) {
        const filteredSales = state.allSales.filter(sale => {
            const saleDate = sale.date;
            return (!startDate || saleDate >= startDate) && 
                   (!endDate || saleDate <= endDate);
        });

        const totalRevenue = filteredSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);

        const data = filteredSales.map(sale => ({
            Date: Utils.formatDate(sale.date),
            Customer: sale.customer,
            Product: sale.productName || 'N/A',
            Quantity: sale.quantity,
            'Unit Price (GHS)': Utils.formatCurrencyGHS(sale.price),
            Discount: sale.discount ? `${sale.discount}%` : '0%',
            Tax: sale.tax ? `${sale.tax}%` : '0%',
            'Total (GHS)': Utils.formatCurrencyGHS(sale.total)
        }));

        // Add total revenue row
        if (data.length > 0) {
            data.push({
                Date: '',
                Customer: 'TOTAL REVENUE',
                Product: '',
                Quantity: '',
                'Unit Price (GHS)': '',
                Discount: '',
                Tax: '',
                'Total (GHS)': Utils.formatCurrencyGHS(totalRevenue)
            });
        }

        const filename = `sales_report_${startDate}_to_${endDate}.csv`;
        this.exportToCSV(data, filename);
    }

    exportInventoryReport() {
        const data = state.allProducts.map(product => {
            const qty = parseInt(product.quantity) || 0;
            const cost = parseFloat(product.cost) || 0;
            const price = parseFloat(product.price) || 0;
            const minStock = parseInt(product.minStock) || 10;

            const inventoryValue = qty * cost;
            const potentialRevenue = qty * price;

            return {
                Name: product.name,
                Category: product.category,
                'In Stock': qty,
                'Cost Price (GHS)': Utils.formatCurrencyGHS(cost),
                'Selling Price (GHS)': Utils.formatCurrencyGHS(price),
                'Inventory Value (GHS)': Utils.formatCurrencyGHS(inventoryValue),
                'Potential Revenue (GHS)': Utils.formatCurrencyGHS(potentialRevenue),
                'Min Stock': minStock,
                Status: qty < minStock ? 'Low Stock' : 'In Stock'
            };
        });

        this.exportToCSV(data, 'inventory_report.csv');
    }

    exportExpensesReport(startDate, endDate) {
        const filteredExpenses = state.allExpenses.filter(expense => {
            const expenseDate = expense.date;
            return (!startDate || expenseDate >= startDate) && 
                   (!endDate || expenseDate <= endDate);
        });

        const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

        const data = filteredExpenses.map(expense => ({
            Date: Utils.formatDate(expense.date),
            Description: expense.description,
            Category: expense.category,
            'Amount (GHS)': Utils.formatCurrencyGHS(expense.amount)
        }));

        if (data.length > 0) {
            data.push({
                Date: '',
                Description: 'TOTAL EXPENSES',
                Category: '',
                'Amount (GHS)': Utils.formatCurrencyGHS(totalExpenses)
            });
        }

        const filename = `expenses_report_${startDate}_to_${endDate}.csv`;
        this.exportToCSV(data, filename);
    }

    _getSupplierName(supplierId, creditor, supplierName) {
        if (supplierId && state.allSuppliers && state.allSuppliers.length) {
            const s = state.allSuppliers.find(sup => sup.id === supplierId);
            if (s && s.name) return s.name;
        }
        return creditor || supplierName || 'Unknown';
    }

    /**
     * Export supplier payment history: liability summary (supplier, PO, owed, paid, due) + payment history.
     * Options: startDate, endDate (optional), supplierId (optional), format: 'csv' | 'pdf'
     */
    async exportSupplierPaymentsReport({ startDate, endDate, supplierId = null, format = 'csv' } = {}) {
        try {
            let liabilities = [...(state.allLiabilities || [])];
            if (supplierId) liabilities = liabilities.filter(l => (l.supplierId || '') === supplierId);
            if (startDate) liabilities = liabilities.filter(l => (l.dueDate || l.createdAt || '').toString().slice(0, 10) >= startDate);
            if (endDate) liabilities = liabilities.filter(l => (l.dueDate || l.createdAt || '').toString().slice(0, 10) <= endDate);

            const summaryRows = liabilities
                .sort((a, b) => (this._getSupplierName(a.supplierId, a.creditor, a.supplierName) || '').localeCompare(this._getSupplierName(b.supplierId, b.creditor, b.supplierName) || '') || (a.poNumber || '').localeCompare(b.poNumber || ''))
                .map(l => {
                    const amount = parseFloat(l.amount) || 0;
                    const balance = parseFloat(l.balance) ?? amount;
                    const paid = amount - balance;
                    return {
                        Supplier: this._getSupplierName(l.supplierId, l.creditor, l.supplierName),
                        'PO Number': l.poNumber || '',
                        Description: l.description || '',
                        'Total Purchase Amount (GHS)': Utils.formatGHS(amount),
                        'Total Amount Paid (GHS)': Utils.formatGHS(paid),
                        'Amount Due (GHS)': Utils.formatGHS(balance),
                        'Due Date': Utils.formatDate(l.dueDate)
                    };
                });

            const constraints = [where('type', '==', 'liability_payment')];
            if (startDate) constraints.push(where('paymentDate', '>=', startDate));
            if (endDate) constraints.push(where('paymentDate', '<=', endDate));
            if (supplierId) constraints.push(where('supplierId', '==', supplierId));
            const paymentsSnap = await getDocs(query(collection(db, 'payment_transactions'), ...constraints));

            const paymentList = [];
            paymentsSnap.forEach(docSnap => {
                const p = docSnap.data();
                let dateStr = p.paymentDate;
                if (!dateStr && p.createdAt) {
                    const raw = p.createdAt;
                    if (typeof raw === 'string') dateStr = raw;
                    else if (raw && typeof raw.toDate === 'function') dateStr = raw.toDate().toISOString().split('T')[0];
                    else { const d = new Date(raw); if (!isNaN(d.getTime())) dateStr = d.toISOString().split('T')[0]; }
                }
                const liability = (state.allLiabilities || []).find(l => l.id === p.liabilityId);
                const supplierName = liability ? this._getSupplierName(liability.supplierId, liability.creditor, liability.supplierName) : (p.supplierName || p.creditor || 'Unknown');
                const poNumber = (liability && liability.poNumber) || p.poNumber || '';
                paymentList.push({
                    Supplier: supplierName,
                    'PO Number': poNumber,
                    'Payment Date': Utils.formatDate(dateStr || ''),
                    'Amount (GHS)': Utils.formatGHS(parseFloat(p.amount) || 0),
                    Method: p.paymentMethod || '',
                    Notes: p.notes || ''
                });
            });
            paymentList.sort((a, b) => (a.Supplier || '').localeCompare(b.Supplier || '') || (a['Payment Date'] || '').localeCompare(b['Payment Date'] || ''));

            const paymentRows = paymentList.map(p => ({
                Supplier: p.Supplier,
                'PO Number': p['PO Number'],
                'Payment Date': p['Payment Date'],
                'Amount (GHS)': p['Amount (GHS)'],
                Method: p.Method,
                Notes: p.Notes
            }));

            if (summaryRows.length === 0 && paymentRows.length === 0) {
                Utils.showToast('No supplier or payment data found for selected filters', 'warning');
                return;
            }

            const totals = liabilities.length
                ? {
                    totalPurchase: liabilities.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
                    totalPaid: liabilities.reduce((s, l) => {
                        const amt = parseFloat(l.amount) || 0;
                        const bal = parseFloat(l.balance) ?? amt;
                        return s + (amt - bal);
                    }, 0),
                    amountDue: liabilities.reduce((s, l) => s + ((parseFloat(l.balance) ?? parseFloat(l.amount)) || 0), 0)
                }
                : { totalPurchase: 0, totalPaid: 0, amountDue: 0 };

            if (format === 'pdf') {
                if (window.pdfExport && typeof window.pdfExport.generateSupplierPaymentHistoryReport === 'function') {
                    await window.pdfExport.generateSupplierPaymentHistoryReport({ summaryRows, paymentRows, totals });
                } else {
                    Utils.showToast('PDF export not available', 'error');
                }
                return;
            }

            const csvColumns = ['Type', 'Supplier', 'PO Number', 'Description', 'Total Purchase Amount (GHS)', 'Total Amount Paid (GHS)', 'Amount Due (GHS)', 'Due Date', 'Payment Date', 'Amount (GHS)', 'Method', 'Notes']; // Currency: GHS
            const csvRows = [];
            summaryRows.forEach(r => {
                csvRows.push({
                    Type: 'Summary',
                    Supplier: r.Supplier,
                    'PO Number': r['PO Number'],
                    Description: r.Description,
                    'Total Purchase Amount (GHS)': r['Total Purchase Amount (GHS)'],
                    'Total Amount Paid (GHS)': r['Total Amount Paid (GHS)'],
                    'Amount Due (GHS)': r['Amount Due (GHS)'],
                    'Due Date': r['Due Date'],
                    'Payment Date': '', 'Amount (GHS)': '', Method: '', Notes: ''
                });
            });
            paymentList.forEach(p => {
                csvRows.push({
                    Type: 'Payment',
                    Supplier: p.Supplier,
                    'PO Number': p['PO Number'],
                    Description: '', 'Total Purchase Amount (GHS)': '', 'Total Amount Paid (GHS)': '', 'Amount Due (GHS)': '', 'Due Date': '',
                    'Payment Date': p['Payment Date'],
                    'Amount (GHS)': p['Amount (GHS)'],
                    Method: p.Method,
                    Notes: p.Notes
                });
            });
            this.exportToCSV(csvRows, `supplier_payment_history_${startDate || 'all'}_to_${endDate || 'all'}.csv`, csvColumns);
        } catch (error) {
            console.error('Supplier payments export failed:', error);
            Utils.showToast('Failed to export supplier payments', 'error');
        }
    }

    exportCustomersReport() {
        const data = state.allCustomers.map(customer => ({
            Name: customer.name,
            Email: customer.email || '',
            Phone: customer.phone || '',
            Address: customer.address || '',
            'Total Purchases': customer.totalPurchases || 0,
            'Total Spent (GHS)': Utils.formatCurrencyGHS(customer.totalSpent || 0),
            'Last Purchase': customer.lastPurchase ? Utils.formatDate(customer.lastPurchase) : 'Never'
        }));

        this.exportToCSV(data, 'customers_report.csv');
    }

    async exportFinancialStatement(type, period) {
        let title, data, columns;

        // Derive date range from period (day/week/month/quarter/year/all)
        const normalizedPeriod = period === 'today' ? 'day' : period;
        const { start, end } = Utils.getDateRange(normalizedPeriod);

        // Filter by period before computing totals
        const periodSales = state.allSales.filter(s => s.date >= start && s.date <= end);
        const periodExpenses = state.allExpenses.filter(e => e.date >= start && e.date <= end);
        const periodLiabilities = state.allLiabilities.filter(l => {
            const d = l.dueDate || l.createdAt || l.date;
            if (!d) return true;
            return d >= start && d <= end;
        });

        const totalRevenue = periodSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalExpenses = periodExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const totalLiabilities = periodLiabilities.reduce((sum, l) => sum + (parseFloat(l.balance) || 0), 0);

        if (type === 'income') {
            title = `Income Statement - ${period} (GHS)`;
            data = [
                { Category: 'Total Revenue', Amount: Utils.formatCurrencyGHS(totalRevenue) },
                { Category: 'Total Expenses', Amount: Utils.formatCurrencyGHS(totalExpenses) },
                { Category: 'Net Income', Amount: Utils.formatCurrencyGHS(totalRevenue - totalExpenses) }
            ];
            columns = [
                { header: 'Category', dataKey: 'Category' },
                { header: 'Amount (₵)', dataKey: 'Amount' }
            ];
        } else if (type === 'balance') {
            title = `Balance Sheet - ${period} (GHS)`;
            const inventoryValue = state.allProducts.reduce((sum, p) => sum + ((parseFloat(p.cost) || 0) * (parseInt(p.quantity) || 0)), 0);
            const cash = totalRevenue - totalExpenses;
            const totalAssets = cash + inventoryValue;

            data = [
                { Category: 'Assets', Subcategory: 'Cash', Amount: Utils.formatCurrencyGHS(cash) },
                { Category: 'Assets', Subcategory: 'Inventory', Amount: Utils.formatCurrencyGHS(inventoryValue) },
                { Category: 'Assets', Subcategory: 'Total Assets', Amount: Utils.formatCurrencyGHS(totalAssets) },
                { Category: 'Liabilities', Subcategory: 'Total Liabilities', Amount: Utils.formatCurrencyGHS(totalLiabilities) },
                { Category: 'Equity', Subcategory: 'Owner\'s Equity', Amount: Utils.formatCurrencyGHS(totalAssets - totalLiabilities) }
            ];
            columns = [
                { header: 'Category', dataKey: 'Category' },
                { header: 'Item', dataKey: 'Subcategory' },
                { header: 'Amount (₵)', dataKey: 'Amount' }
            ];
        }

        await this.exportToPDF({
            title,
            subtitle: `Generated on ${Utils.formatDate(new Date())} | Currency: Ghana Cedi (₵)`,
            data,
            columns,
            filename: `${type}_statement_${period}.pdf`,
            orientation: 'portrait'
        });
    }

    async exportComprehensiveReport(startDate, endDate) {
        const period = `${startDate} to ${endDate}`;
        
        try {
            // Load SheetJS
            if (typeof XLSX === 'undefined') {
                await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
            }

            const wb = XLSX.utils.book_new();

            // Sales Sheet
            const salesData = state.allSales
                .filter(s => s.date >= startDate && s.date <= endDate)
                .map(s => ({
                    Date: s.date,
                    Customer: s.customer,
                    Product: s.productName,
                    Quantity: s.quantity,
                    Price: s.price,
                    Total: s.total
                }));
            const salesWS = XLSX.utils.json_to_sheet(salesData);
            XLSX.utils.book_append_sheet(wb, salesWS, 'Sales');

            // Expenses Sheet
            const expensesData = state.allExpenses
                .filter(e => e.date >= startDate && e.date <= endDate)
                .map(e => ({
                    Date: e.date,
                    Description: e.description,
                    Category: e.category,
                    Amount: e.amount
                }));
            const expensesWS = XLSX.utils.json_to_sheet(expensesData);
            XLSX.utils.book_append_sheet(wb, expensesWS, 'Expenses');

            // Inventory Sheet
            const inventoryData = state.allProducts.map(p => ({
                Name: p.name,
                Category: p.category,
                Quantity: p.quantity,
                Cost: p.cost,
                Price: p.price,
                Value: p.quantity * p.cost
            }));
            const inventoryWS = XLSX.utils.json_to_sheet(inventoryData);
            XLSX.utils.book_append_sheet(wb, inventoryWS, 'Inventory');

            // Summary Sheet: Total Revenue, Total Expenses, Net Profit (all in Ghana Cedi)
            const totalRevenue = salesData.reduce((sum, s) => sum + (parseFloat(s.Total) || 0), 0);
            const totalExpenses = expensesData.reduce((sum, e) => sum + (parseFloat(e.Amount) || 0), 0);
            const summaryData = [
                { Metric: 'Total Revenue (GHS)', Value: Utils.formatCurrencyGHS(totalRevenue) },
                { Metric: 'Total Expenses (GHS)', Value: Utils.formatCurrencyGHS(totalExpenses) },
                { Metric: 'Net Profit (GHS)', Value: Utils.formatCurrencyGHS(totalRevenue - totalExpenses) },
                { Metric: 'Total Sales (Transactions)', Value: salesData.length },
                { Metric: 'Products in Stock', Value: state.allProducts.length }
            ];
            const summaryWS = XLSX.utils.json_to_sheet(summaryData);
            XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');

            XLSX.writeFile(wb, `comprehensive_report_${period}.xlsx`);
            Utils.showToast('Comprehensive report exported successfully', 'success');
        } catch (error) {
            console.error('Comprehensive export failed:', error);
            Utils.showToast('Export failed', 'error');
        }
    }

    // ==================== SCHEDULED EXPORTS ====================

    scheduleAutoExport(frequency, type, time) {
        // frequency: 'daily', 'weekly', 'monthly'
        // type: 'sales', 'expenses', 'inventory', 'comprehensive'
        // time: '09:00'

        const schedule = {
            frequency,
            type,
            time,
            enabled: true
        };

        // Save to localStorage
        const schedules = JSON.parse(localStorage.getItem('export_schedules') || '[]');
        schedules.push(schedule);
        localStorage.setItem('export_schedules', JSON.stringify(schedules));

        console.log('Export scheduled:', schedule);
        Utils.showToast(`${frequency} ${type} export scheduled`, 'success');
    }

    getScheduledExports() {
        return JSON.parse(localStorage.getItem('export_schedules') || '[]');
    }

    removeScheduledExport(index) {
        const schedules = this.getScheduledExports();
        schedules.splice(index, 1);
        localStorage.setItem('export_schedules', JSON.stringify(schedules));
        Utils.showToast('Schedule removed', 'success');
    }

    // ==================== UTILITY METHODS ====================

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
}

// Create and export singleton
export const exportService = new ExportService();
