/**
 * PDF Export Service
 * Generates professional PDF reports for financial statements
 */

import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';

class PDFExportService {
    constructor() {
        this.loadJSPDF();
    }

    /** Format amount for PDFs using "GHS" (jsPDF does not render ₵ correctly). */
    formatGHS(amount) {
        return 'GHS ' + (parseFloat(amount) || 0).toFixed(2);
    }

    isDebtPayment(e) {
        const type = (e.expenseType || '').toLowerCase();
        const cat = (e.category || '').toLowerCase();
        return type === 'liability_payment' || cat === 'debt payment' || cat === 'loan repayment';
    }

    /** Compute revenue for one sale: use s.total if valid, else derive from quantity/price/discount/tax. */
    getSaleTotal(s) {
        const explicit = parseFloat(s.total);
        if (!Number.isNaN(explicit)) return explicit;
        const qty = parseFloat(s.quantity) || 0;
        const price = parseFloat(s.price) || 0;
        const discount = parseFloat(s.discount) || 0;
        const tax = parseFloat(s.tax) || 0;
        const subtotal = qty * price;
        const discounted = subtotal * (1 - discount / 100);
        return discounted * (1 + tax / 100);
    }

    /**
     * Load jsPDF + autoTable plugin dynamically.
     * Safe to call repeatedly — resolves immediately once loaded.
     */
    async loadJSPDF() {
        if (window.jspdf && typeof window.jspdf.jsPDF?.prototype?.autoTable === 'function') {
            return;
        }

        if (this._loadingPromise) return this._loadingPromise;

        this._loadingPromise = new Promise((resolve, reject) => {
            const loadScript = (src) =>
                new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = src;
                    s.onload = res;
                    s.onerror = () => rej(new Error(`Failed to load ${src}`));
                    document.head.appendChild(s);
                });

            loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
                .then(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js'))
                .then(resolve)
                .catch((err) => {
                    this._loadingPromise = null;
                    reject(err);
                });
        });

        return this._loadingPromise;
    }

    /**
     * Generate Sales Report PDF
     */
    async generateSalesReport(dateRange = {}) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            // Filter sales by date range
            let sales = [...state.allSales];
            if (dateRange.start) {
                sales = sales.filter(s => s.date >= dateRange.start);
            }
            if (dateRange.end) {
                sales = sales.filter(s => s.date <= dateRange.end);
            }

            // Header
            this.addHeader(doc, 'Sales Report');
            this.addDateRange(doc, dateRange);

            // Summary section - Total Revenue (use getSaleTotal so missing s.total still gives correct sum)
            const totalRevenue = sales.reduce((sum, s) => sum + this.getSaleTotal(s), 0);
            const totalQuantity = sales.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0);

            doc.setFontSize(12);
            doc.text(`Total Revenue (GHS): ${this.formatGHS(totalRevenue)}`, 14, 50);
            doc.text(`Total Items Sold: ${totalQuantity}`, 14, 58);
            doc.text(`Number of Transactions: ${sales.length}`, 14, 66);

            // Sales table
            const tableData = sales.slice(0, 100).map(s => [
                s.date,
                s.product || s.productName,
                s.customer || s.customerName || 'Walk-in',
                s.quantity,
                this.formatGHS(s.price),
                this.formatGHS(this.getSaleTotal(s))
            ]);

            doc.autoTable({
                startY: 80,
                head: [['Date', 'Product', 'Customer', 'Qty', 'Price (GHS)', 'Total (GHS)']],
                body: tableData,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [0, 123, 255] }
            });

            // Footer
            this.addFooter(doc);

            // Save
            doc.save(`sales-report-${new Date().toISOString().split('T')[0]}.pdf`);
            Utils.showToast('Sales report downloaded', 'success');
        } catch (error) {
            console.error('Error generating PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Inventory Report PDF
     */
    async generateInventoryReport(dateRange = {}) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            this.addHeader(doc, 'Inventory Report');
            this.addDateRange(doc, dateRange);

            const totalValue = state.allProducts.reduce((sum, p) => 
                sum + ((parseFloat(p.cost) || 0) * (parseInt(p.quantity) || 0)), 0
            );
            const totalRetailValue = state.allProducts.reduce((sum, p) => 
                sum + ((parseFloat(p.price) || 0) * (parseInt(p.quantity) || 0)), 0
            );
            const lowStockCount = state.allProducts.filter(p => 
                (parseInt(p.quantity) || 0) <= (parseInt(p.minStock) || 10)
            ).length;

            let sales = [...state.allSales];
            if (dateRange.start) sales = sales.filter(s => s.date >= dateRange.start);
            if (dateRange.end) sales = sales.filter(s => s.date <= dateRange.end);
            const unitsSoldInPeriod = sales.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0);

            const startY = (dateRange.start || dateRange.end) ? 50 : 45;
            doc.setFontSize(12);
            doc.text(`Total Products: ${state.allProducts.length}`, 14, startY);
            doc.text(`Inventory Value (Cost, GHS): ${this.formatGHS(totalValue)}`, 14, startY + 8);
            doc.text(`Inventory Value (Retail, GHS): ${this.formatGHS(totalRetailValue)}`, 14, startY + 16);
            doc.text(`Low Stock Items: ${lowStockCount}`, 14, startY + 24);
            if (dateRange.start || dateRange.end) {
                doc.text(`Units Sold in Period: ${unitsSoldInPeriod}`, 14, startY + 32);
            }

            const tableData = state.allProducts.map(p => [
                p.name,
                p.category || 'N/A',
                p.quantity || 0,
                this.formatGHS(p.cost || 0),
                this.formatGHS(p.price || 0),
                this.formatGHS((p.cost || 0) * (p.quantity || 0))
            ]);

            doc.autoTable({
                startY: startY + (dateRange.start || dateRange.end ? 42 : 35),
                head: [['Product', 'Category', 'Stock', 'Cost (GHS)', 'Price (GHS)', 'Value (GHS)']],
                body: tableData,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [40, 167, 69] }
            });

            this.addFooter(doc);
            doc.save(`inventory-report-${new Date().toISOString().split('T')[0]}.pdf`);
            Utils.showToast('Inventory report downloaded', 'success');
        } catch (error) {
            console.error('Error generating PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Financial Statement PDF
     */
    async generateFinancialStatement(dateRange = {}) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            this.addHeader(doc, 'Financial Statement');
            this.addDateRange(doc, dateRange);

            let sales = [...state.allSales];
            let allExpenses = [...state.allExpenses];
            if (dateRange.start) {
                sales = sales.filter(s => s.date >= dateRange.start);
                allExpenses = allExpenses.filter(e => e.date >= dateRange.start);
            }
            if (dateRange.end) {
                sales = sales.filter(s => s.date <= dateRange.end);
                allExpenses = allExpenses.filter(e => e.date <= dateRange.end);
            }

            const operatingExpenses = allExpenses.filter(e => !this.isDebtPayment(e));
            const debtPayments = allExpenses.filter(e => this.isDebtPayment(e));

            const totalRevenue = sales.reduce((sum, s) => sum + this.getSaleTotal(s), 0);
            const totalCOGS = sales.reduce((sum, s) => {
                const product = state.allProducts.find(p => p.id === s.productId || p.name === s.product);
                const cost = parseFloat(product?.cost) || 0;
                return sum + (cost * (parseInt(s.quantity) || 0));
            }, 0);
            const grossProfit = totalRevenue - totalCOGS;
            
            const totalExpenses = operatingExpenses.reduce((sum, e) => {
                const amount = parseFloat(e.amount);
                return sum + (isNaN(amount) ? 0 : amount);
            }, 0);
            const totalDebtPayments = debtPayments.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
            const netProfit = grossProfit - totalExpenses;

            const inventoryValue = state.allProducts.reduce((sum, p) => 
                sum + ((parseFloat(p.cost) || 0) * (parseInt(p.quantity) || 0)), 0
            );

            let y = (dateRange.start || dateRange.end) ? 50 : 45;

            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Income Statement', 14, y);
            doc.setFont(undefined, 'normal');
            doc.setFontSize(11);

            y += 10;
            doc.text(`Total Revenue (GHS)`, 14, y);
            doc.text(this.formatGHS(totalRevenue), 160, y, { align: 'right' });
            
            y += 8;
            doc.text(`Cost of Goods Sold`, 14, y);
            doc.text(`(${this.formatGHS(totalCOGS)})`, 160, y, { align: 'right' });
            
            y += 8;
            doc.setFont(undefined, 'bold');
            doc.text(`Gross Profit`, 14, y);
            doc.text(this.formatGHS(grossProfit), 160, y, { align: 'right' });
            doc.setFont(undefined, 'normal');
            
            y += 10;
            doc.text(`Operating Expenses`, 14, y);
            doc.text(`(${this.formatGHS(totalExpenses)})`, 160, y, { align: 'right' });
            
            y += 10;
            doc.setFont(undefined, 'bold');
            doc.setFontSize(12);
            doc.text(`Net Profit`, 14, y);
            doc.text(this.formatGHS(netProfit), 160, y, { align: 'right' });

            y += 12;
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(100);
            doc.text(`Debt/Liability Payments (not an expense):`, 14, y);
            doc.text(this.formatGHS(totalDebtPayments), 160, y, { align: 'right' });
            doc.setTextColor(0);

            y += 16;
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Balance Sheet Summary', 14, y);
            doc.setFont(undefined, 'normal');
            doc.setFontSize(11);

            y += 10;
            doc.text(`Assets (GHS):`, 14, y);
            y += 8;
            doc.text(`  Inventory`, 20, y);
            doc.text(this.formatGHS(inventoryValue), 160, y, { align: 'right' });
            y += 8;
            doc.text(`  Cash (Est.)`, 20, y);
            doc.text(this.formatGHS(netProfit), 160, y, { align: 'right' });

            y += 16;
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Operating Expense Breakdown', 14, y);

            const expensesByCategory = {};
            operatingExpenses.forEach(e => {
                const cat = e.category || 'Other';
                const amount = parseFloat(e.amount) || 0;
                expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amount;
            });

            const expenseData = Object.entries(expensesByCategory).map(([cat, amount]) => [
                cat,
                this.formatGHS(amount),
                totalExpenses > 0 ? `${((amount / totalExpenses) * 100).toFixed(1)}%` : '0.0%'
            ]);

            doc.autoTable({
                startY: y + 5,
                head: [['Category', 'Amount (GHS)', '% of Total']],
                body: expenseData,
                styles: { fontSize: 9 },
                headStyles: { fillColor: [220, 53, 69] }
            });

            this.addFooter(doc);
            doc.save(`financial-statement-${new Date().toISOString().split('T')[0]}.pdf`);
            Utils.showToast('Financial statement downloaded', 'success');
        } catch (error) {
            console.error('Error generating PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Profit & Loss Report
     */
    async generateProfitLossReport(dateRange = {}) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            this.addHeader(doc, 'Profit & Loss Report');
            this.addDateRange(doc, dateRange);

            let sales = [...state.allSales];
            let allExpenses = [...state.allExpenses];

            if (dateRange.start) {
                sales = sales.filter(s => s.date >= dateRange.start);
                allExpenses = allExpenses.filter(e => e.date >= dateRange.start);
            }
            if (dateRange.end) {
                sales = sales.filter(s => s.date <= dateRange.end);
                allExpenses = allExpenses.filter(e => e.date <= dateRange.end);
            }

            const operatingExpenses = allExpenses.filter(e => !this.isDebtPayment(e));
            const debtPayments = allExpenses.filter(e => this.isDebtPayment(e));

            const revenue = sales.reduce((sum, s) => sum + this.getSaleTotal(s), 0);
            const cogs = sales.reduce((sum, s) => {
                const product = state.allProducts.find(p => p.id === s.productId || p.name === s.product);
                return sum + ((parseFloat(product?.cost) || 0) * (parseInt(s.quantity) || 0));
            }, 0);
            const grossProfit = revenue - cogs;
            const totalExpenses = operatingExpenses.reduce((sum, e) => {
                const amount = parseFloat(e.amount);
                return sum + (isNaN(amount) ? 0 : amount);
            }, 0);
            const totalDebtPayments = debtPayments.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
            const netProfit = grossProfit - totalExpenses;
            const grossMargin = revenue > 0 ? ((grossProfit / revenue) * 100) : 0;
            const netMargin = revenue > 0 ? ((netProfit / revenue) * 100) : 0;

            const plData = [
                ['Total Revenue (Sales)', '', this.formatGHS(revenue)],
                ['Less: Cost of Goods Sold', '', `(${this.formatGHS(cogs)})`],
                ['Gross Profit', `${grossMargin.toFixed(1)}%`, this.formatGHS(grossProfit)],
                ['', '', ''],
                ['Operating Expenses:', '', '']
            ];

            const expensesByCategory = {};
            operatingExpenses.forEach(e => {
                const cat = e.category || 'Other';
                const amount = parseFloat(e.amount) || 0;
                expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amount;
            });

            Object.entries(expensesByCategory).forEach(([cat, amount]) => {
                plData.push([`  ${cat}`, '', `(${this.formatGHS(amount)})`]);
            });

            plData.push(['Total Operating Expenses', '', `(${this.formatGHS(totalExpenses)})`]);
            plData.push(['', '', '']);
            plData.push(['Net Profit', `${netMargin.toFixed(1)}%`, this.formatGHS(netProfit)]);

            if (totalDebtPayments > 0) {
                plData.push(['', '', '']);
                plData.push(['Debt/Liability Payments (reduces liabilities, not an expense)', '', this.formatGHS(totalDebtPayments)]);
            }

            doc.autoTable({
                startY: 55,
                body: plData,
                styles: { fontSize: 10 },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 100 },
                    1: { halign: 'center', cellWidth: 30 },
                    2: { halign: 'right', cellWidth: 50 }
                },
                didParseCell: (data) => {
                    // Highlight totals
                    if (data.row.raw[0] === 'Gross Profit' || data.row.raw[0] === 'Net Profit') {
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.fillColor = [240, 240, 240];
                    }
                }
            });

            this.addFooter(doc);
            doc.save(`profit-loss-${new Date().toISOString().split('T')[0]}.pdf`);
            Utils.showToast('P&L report downloaded', 'success');
        } catch (error) {
            console.error('Error generating PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Supplier Payment History PDF with corporate/modern design.
     * @param {{ summaryRows: Array<Object>, paymentRows: Array<Object>, totals: { totalPurchase, totalPaid, amountDue } }} options
     */
    async generateSupplierPaymentHistoryReport({ summaryRows = [], paymentRows = [], totals = {} } = {}) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const pageW = doc.internal.pageSize.getWidth();
            const margin = 14;

            // —— Corporate header ——
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.3);
            doc.line(0, 0, pageW, 0);
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.text('Ultimate Bookkeeping', margin, 10);
            doc.setFontSize(16);
            doc.setTextColor(30, 41, 59);
            doc.setFont(undefined, 'bold');
            doc.text('Supplier Payment History', pageW / 2, 22, { align: 'center' });
            doc.setFont(undefined, 'normal');
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.text(`Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}  •  Currency: GHS`, pageW / 2, 29, { align: 'center' });
            doc.setDrawColor(226, 232, 240);
            doc.line(margin, 34, pageW - margin, 34);
            doc.setTextColor(0, 0, 0);

            let startY = 42;

            // —— Executive summary (three metric cards) ——
            const { totalPurchase = 0, totalPaid = 0, amountDue = 0 } = totals;
            const cardW = (pageW - 2 * margin - 16) / 3;
            const cardH = 22;
            const labels = ['Total Purchase (GHS)', 'Total Paid (GHS)', 'Amount Due (GHS)'];
            const values = [
                this.formatGHS(totalPurchase),
                this.formatGHS(totalPaid),
                this.formatGHS(amountDue)
            ];
            const fills = [[248, 250, 252], [248, 250, 252], [248, 250, 252]];
            const accentBottom = [37, 99, 235];

            for (let i = 0; i < 3; i++) {
                const x = margin + i * (cardW + 8);
                doc.setFillColor(...fills[i]);
                doc.roundedRect(x, startY, cardW, cardH, 1.5, 1.5, 'F');
                doc.setDrawColor(226, 232, 240);
                doc.setLineWidth(0.2);
                doc.roundedRect(x, startY, cardW, cardH, 1.5, 1.5, 'S');
                doc.setFillColor(...accentBottom);
                doc.rect(x, startY + cardH - 2.5, cardW, 2.5, 'F');
                doc.setFontSize(8);
                doc.setTextColor(100, 116, 139);
                doc.text(labels[i], x + 6, startY + 7);
                doc.setFontSize(11);
                doc.setTextColor(30, 41, 59);
                doc.setFont(undefined, 'bold');
                doc.text(values[i], x + 6, startY + 15);
                doc.setFont(undefined, 'normal');
            }
            startY += cardH + 14;
            doc.setTextColor(0, 0, 0);

            // —— Liability summary table ——
            if (summaryRows.length > 0) {
                doc.setFontSize(9);
                doc.setTextColor(71, 85, 105);
                doc.setFont(undefined, 'bold');
                doc.text('LIABILITY SUMMARY', margin, startY);
                doc.setFont(undefined, 'normal');
                doc.setFontSize(9);
                startY += 7;

                const summaryBody = summaryRows.map(r => [
                    r.Supplier || '',
                    r['PO Number'] || '',
                    (r.Description || '').substring(0, 28),
                    r['Total Purchase Amount (GHS)'] || '',
                    r['Total Amount Paid (GHS)'] || '',
                    r['Amount Due (GHS)'] || '',
                    r['Due Date'] || ''
                ]);
                doc.autoTable({
                    startY,
                    head: [['Supplier', 'PO #', 'Description', 'Purchase (GHS)', 'Paid (GHS)', 'Due (GHS)', 'Due Date']],
                    body: summaryBody,
                    margin: { left: margin, right: margin },
                    theme: 'plain',
                    styles: { fontSize: 8, cellPadding: 4 },
                    headStyles: {
                        fillColor: [30, 41, 59],
                        textColor: [248, 250, 252],
                        fontStyle: 'bold',
                        fontSize: 8
                    },
                    alternateRowStyles: { fillColor: [248, 250, 252] },
                    columnStyles: {
                        2: { cellWidth: 30 },
                        3: { halign: 'right' },
                        4: { halign: 'right' },
                        5: { halign: 'right' }
                    }
                });
                startY = doc.lastAutoTable.finalY + 14;
            }

            // —— Payment history table ——
            if (paymentRows.length > 0) {
                if (startY > 250) {
                    doc.addPage();
                    startY = 20;
                }
                doc.setFontSize(9);
                doc.setTextColor(71, 85, 105);
                doc.setFont(undefined, 'bold');
                doc.text('PAYMENT HISTORY', margin, startY);
                doc.setFont(undefined, 'normal');
                doc.setFontSize(9);
                startY += 7;

                const historyBody = paymentRows.map(r => [
                    r.Supplier || '',
                    r['PO Number'] || '',
                    r['Payment Date'] || '',
                    r['Amount (GHS)'] || '',
                    r.Method || '',
                    (r.Notes || '').substring(0, 22)
                ]);
                doc.autoTable({
                    startY,
                    head: [['Supplier', 'PO #', 'Date', 'Amount (GHS)', 'Method', 'Notes']],
                    body: historyBody,
                    margin: { left: margin, right: margin },
                    theme: 'plain',
                    styles: { fontSize: 8, cellPadding: 4 },
                    headStyles: {
                        fillColor: [30, 41, 59],
                        textColor: [248, 250, 252],
                        fontStyle: 'bold',
                        fontSize: 8
                    },
                    alternateRowStyles: { fillColor: [248, 250, 252] },
                    columnStyles: { 3: { halign: 'right' }, 5: { cellWidth: 28 } }
                });
            }

            // —— Corporate footer ——
            const pageCount = doc.internal.getNumberOfPages();
            const footerY = doc.internal.pageSize.height - 12;
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setDrawColor(226, 232, 240);
                doc.line(margin, footerY - 6, pageW - margin, footerY - 6);
                doc.setFontSize(8);
                doc.setTextColor(100, 116, 139);
                doc.text(
                    `Supplier Payment History Report  •  Page ${i} of ${pageCount}  •  ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
                    pageW / 2,
                    footerY,
                    { align: 'center' }
                );
            }

            doc.save(`supplier-payment-history-${new Date().toISOString().split('T')[0]}.pdf`);
            Utils.showToast('Supplier payment history downloaded', 'success');
        } catch (error) {
            console.error('Error generating supplier payment history PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Add header to PDF
     */
    addHeader(doc, title) {
        // Company name
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text('Ultimate Firebase Bookkeeping', 105, 15, { align: 'center' });
        
        // Report title
        doc.setFontSize(14);
        doc.setFont(undefined, 'normal');
        doc.text(title, 105, 25, { align: 'center' });
        
        // Date generated and currency
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleString()} | Currency: Ghana Cedi (GHS)`, 105, 33, { align: 'center' });
        
        // Line separator
        doc.setLineWidth(0.5);
        doc.line(14, 37, 196, 37);
    }

    /**
     * Add date range to PDF
     */
    addDateRange(doc, dateRange) {
        if (dateRange.start || dateRange.end) {
            doc.setFontSize(10);
            const rangeText = `Period: ${dateRange.start || 'Beginning'} to ${dateRange.end || 'Present'}`;
            doc.text(rangeText, 14, 45);
        }
    }

    /**
     * Add footer to PDF
     */
    addFooter(doc) {
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.text(
                `Page ${i} of ${pageCount}`,
                105,
                doc.internal.pageSize.height - 10,
                { align: 'center' }
            );
        }
    }

    /**
     * Generate Purchase Order PDF
     */
    async generatePurchaseOrderPDF(po) {
        if (!po) throw new Error('No purchase order data provided');
        try {
            await this.loadJSPDF();
            if (!window.jspdf?.jsPDF) throw new Error('PDF library failed to load. Check your internet connection and try again.');
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const pageW = doc.internal.pageSize.getWidth();
            const margin = 14;

            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.3);
            doc.line(0, 0, pageW, 0);

            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.text('Ultimate Bookkeeping', margin, 10);
            doc.setFontSize(16);
            doc.setTextColor(30, 41, 59);
            doc.setFont(undefined, 'bold');
            doc.text('PURCHASE ORDER', pageW / 2, 22, { align: 'center' });
            doc.setFont(undefined, 'normal');
            doc.setFontSize(10);
            doc.setTextColor(100, 116, 139);
            doc.text(`Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}  •  Currency: GHS`, pageW / 2, 29, { align: 'center' });
            doc.setDrawColor(226, 232, 240);
            doc.line(margin, 34, pageW - margin, 34);
            doc.setTextColor(0, 0, 0);

            let y = 42;

            const orderDate = po.orderDate ? new Date(po.orderDate).toLocaleDateString() : '—';
            const dueDate = po.dueDate ? new Date(po.dueDate).toLocaleDateString() : '—';
            const paymentTerms = po.paymentTerms ? po.paymentTerms.replace(/_/g, ' ').toUpperCase() : '—';
            const status = (po.status || 'pending').toUpperCase();

            const fields = [
                ['PO Number', po.poNumber || '—'],
                ['Supplier', po.supplierName || '—'],
                ['Order Date', orderDate],
                ['Due Date', dueDate],
                ['Payment Terms', paymentTerms],
                ['Status', status],
            ];

            doc.setFontSize(10);
            const colW = (pageW - 2 * margin) / 2;
            fields.forEach((field, i) => {
                const col = i % 2;
                if (col === 0 && i > 0) y += 8;
                const x = margin + col * colW;
                doc.setFont(undefined, 'bold');
                doc.text(`${field[0]}:`, x, y);
                doc.setFont(undefined, 'normal');
                doc.text(field[1], x + 35, y);
            });

            y += 16;
            const items = po.items || [];

            if (items.length > 0) {
                const tableBody = items.map((item, i) => [
                    (i + 1).toString(),
                    item.productName || '—',
                    (item.quantity ?? '—').toString(),
                    this.formatGHS(item.unitCost),
                    this.formatGHS(item.totalCost)
                ]);

                doc.autoTable({
                    startY: y,
                    head: [['#', 'Product', 'Qty', 'Unit Cost (GHS)', 'Total (GHS)']],
                    body: tableBody,
                    margin: { left: margin, right: margin },
                    theme: 'plain',
                    styles: { fontSize: 9, cellPadding: 4 },
                    headStyles: {
                        fillColor: [30, 41, 59],
                        textColor: [248, 250, 252],
                        fontStyle: 'bold',
                        fontSize: 9
                    },
                    alternateRowStyles: { fillColor: [248, 250, 252] },
                    columnStyles: {
                        0: { cellWidth: 12, halign: 'center' },
                        2: { halign: 'right' },
                        3: { halign: 'right' },
                        4: { halign: 'right' }
                    },
                    foot: [['', '', '', 'Grand Total', this.formatGHS(po.totalAmount)]],
                    footStyles: {
                        fillColor: [30, 41, 59],
                        textColor: [248, 250, 252],
                        fontStyle: 'bold'
                    }
                });

                y = doc.lastAutoTable.finalY + 10;
            }

            if (po.notes) {
                doc.setFontSize(9);
                doc.setFont(undefined, 'bold');
                doc.text('Notes:', margin, y);
                doc.setFont(undefined, 'normal');
                doc.text(po.notes, margin, y + 6, { maxWidth: pageW - 2 * margin });
            }

            const pageCount = doc.internal.getNumberOfPages();
            const footerY = doc.internal.pageSize.height - 12;
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setDrawColor(226, 232, 240);
                doc.line(margin, footerY - 6, pageW - margin, footerY - 6);
                doc.setFontSize(8);
                doc.setTextColor(100, 116, 139);
                doc.text(
                    `Purchase Order ${po.poNumber || ''}  •  Page ${i} of ${pageCount}  •  ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
                    pageW / 2, footerY, { align: 'center' }
                );
            }

            doc.save(`PO-${po.poNumber || po.id}-${new Date().toISOString().split('T')[0]}.pdf`);
            Utils.showToast('Purchase order exported to PDF', 'success');
        } catch (error) {
            console.error('Error generating PO PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Show export options modal
     */
    showExportModal() {
        document.getElementById('pdf-export-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'pdf-export-modal';
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <span class="close" onclick="document.getElementById('pdf-export-modal').remove()">&times;</span>
                <h3><i class="fas fa-file-pdf"></i> Export Reports to PDF</h3>
                <p style="font-size: 0.9rem; color: #666; margin-bottom: 1rem;">All amounts in Ghana Cedi (GHS)</p>
                
                <div style="margin: 1rem 0;">
                    <label>Date Range (Optional)</label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <input type="date" id="export-start-date" placeholder="Start Date">
                        <input type="date" id="export-end-date" placeholder="End Date">
                    </div>
                </div>
                
                <div class="export-options" style="display: grid; gap: 0.5rem;">
                    <button onclick="pdfExport.handleExport('sales')" class="export-btn">
                        <i class="fas fa-chart-line"></i> Sales Report
                    </button>
                    <button onclick="pdfExport.handleExport('inventory')" class="export-btn">
                        <i class="fas fa-boxes"></i> Inventory Report
                    </button>
                    <button onclick="pdfExport.handleExport('financial')" class="export-btn">
                        <i class="fas fa-balance-scale"></i> Financial Statement
                    </button>
                    <button onclick="pdfExport.handleExport('pnl')" class="export-btn">
                        <i class="fas fa-chart-bar"></i> Profit & Loss Report
                    </button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);
    }

    /**
     * Handle export button click
     */
    handleExport(type) {
        const dateRange = {
            start: document.getElementById('export-start-date')?.value,
            end: document.getElementById('export-end-date')?.value
        };

        switch (type) {
            case 'sales':
                this.generateSalesReport(dateRange);
                break;
            case 'inventory':
                this.generateInventoryReport(dateRange);
                break;
            case 'financial':
                this.generateFinancialStatement(dateRange);
                break;
            case 'pnl':
                this.generateProfitLossReport(dateRange);
                break;
        }

        document.getElementById('pdf-export-modal')?.remove();
    }
}

export const pdfExport = new PDFExportService();
window.pdfExport = pdfExport;
