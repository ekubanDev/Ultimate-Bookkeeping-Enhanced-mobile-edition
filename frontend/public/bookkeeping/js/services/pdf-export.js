/**
 * PDF Export Service
 * Generates professional PDF reports for financial statements
 */

import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';
import {
    sharePdfBlobBestEffort,
    downloadPdfBlobInBrowser,
    PDF_SHARE_UNAVAILABLE,
} from '../utils/native-pdf-save.js';
import { isDebtPayment, getSaleTotal } from '../utils/accounting.js';

class PDFExportService {
    constructor() {
        this.loadJSPDF();
    }

    /** Format amount for PDFs using "GHS" (jsPDF does not render ₵ correctly). */
    formatGHS(amount) {
        return 'GHS ' + (parseFloat(amount) || 0).toFixed(2);
    }

    isDebtPayment(e) { return isDebtPayment(e); }

    /** Compute revenue for one sale: use s.total if valid, else derive from quantity/price/discount/tax. */
    getSaleTotal(s) { return getSaleTotal(s);
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
     * jsPDF doc.save() triggers blob URLs — iOS WKWebView cannot open them (NSOSStatus -10814).
     * On Capacitor, write to Documents and show the system share sheet.
     */
    async savePdfOutput(doc, fileName, shareTitle, successToast) {
        const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        if (typeof Utils !== 'undefined' && Utils.showToast) {
            Utils.showToast('Preparing PDF…', 'info');
        }
        const blob = doc.output('blob');

        try {
            await sharePdfBlobBestEffort(
                blob,
                safeName,
                shareTitle,
                'Save to Files or share this PDF'
            );
            Utils.showToast(successToast, 'success');
            return;
        } catch (e) {
            if (e && (e.name === 'AbortError' || String(e.message || '').toLowerCase().includes('abort'))) {
                return;
            }
            const msg = String(e && e.message ? e.message : e).toLowerCase();
            if (msg.includes('cancel') || msg.includes('dismiss')) return;

            if (e && (e.code === PDF_SHARE_UNAVAILABLE || e.message === PDF_SHARE_UNAVAILABLE)) {
                try {
                    downloadPdfBlobInBrowser(blob, fileName);
                    Utils.showToast(successToast, 'success');
                    return;
                } catch (dlErr) {
                    console.warn('PDF download fallback failed:', dlErr);
                }
            } else {
                console.warn('PDF share failed, trying download:', e);
                try {
                    downloadPdfBlobInBrowser(blob, fileName);
                    Utils.showToast(successToast, 'success');
                    return;
                } catch (dlErr) {
                    /* fall through to doc.save */
                }
            }
        }

        try {
            doc.save(fileName);
            Utils.showToast(successToast, 'success');
        } catch (finalErr) {
            console.error('PDF save failed:', finalErr);
            Utils.showToast('Could not save PDF. Try updating the app or use Share from the report screen.', 'error');
            throw finalErr;
        }
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

            const tableData = sales.map(s => [
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

            await this.savePdfOutput(
                doc,
                `sales-report-${new Date().toISOString().split('T')[0]}.pdf`,
                'Sales Report',
                'Sales report downloaded'
            );
        } catch (error) {
            console.error('Error generating PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Product sale history: per-product totals, then all lines grouped by product (A–Z) and date.
     */
    async generateProductSaleHistoryPdf(dateRange = {}) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            let sales = [...(state.allSales || [])];
            if (dateRange.start) {
                sales = sales.filter((s) => (s.date || '') >= dateRange.start);
            }
            if (dateRange.end) {
                sales = sales.filter((s) => (s.date || '') <= dateRange.end);
            }

            const productOf = (s) => {
                const n = String(s.product || s.productName || '').trim();
                return n || 'Unknown';
            };

            this.addHeader(doc, 'Product Sale History');
            this.addDateRange(doc, dateRange);

            if (sales.length === 0) {
                doc.setFontSize(11);
                doc.text('No sales records in this period.', 14, 52);
                this.addFooter(doc);
                await this.savePdfOutput(
                    doc,
                    `product-sale-history-${new Date().toISOString().split('T')[0]}.pdf`,
                    'Product Sale History',
                    'Product sale history downloaded'
                );
                return;
            }

            const summaryMap = new Map();
            for (const s of sales) {
                const p = productOf(s);
                const line = this.getSaleTotal(s);
                const qty = parseInt(s.quantity, 10) || 0;
                if (!summaryMap.has(p)) {
                    summaryMap.set(p, { qty: 0, revenue: 0, lines: 0 });
                }
                const agg = summaryMap.get(p);
                agg.qty += qty;
                agg.revenue += line;
                agg.lines += 1;
            }

            const totalRevenue = sales.reduce((sum, s) => sum + this.getSaleTotal(s), 0);
            const uniqueProducts = summaryMap.size;

            doc.setFontSize(11);
            doc.setFont(undefined, 'normal');
            const statsY = dateRange.start || dateRange.end ? 52 : 48;
            doc.text(
                `Products with sales: ${uniqueProducts}  |  Line items: ${sales.length}  |  Total revenue: ${this.formatGHS(totalRevenue)}`,
                14,
                statsY
            );

            const summaryBody = [...summaryMap.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([name, agg]) => [name, String(agg.lines), String(agg.qty), this.formatGHS(agg.revenue)]);

            doc.autoTable({
                startY: statsY + 10,
                head: [['Product', 'Sale lines', 'Qty sold', 'Revenue (GHS)']],
                body: summaryBody,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [0, 123, 255] },
            });

            const sortedDetail = [...sales].sort((a, b) => {
                const cmp = productOf(a).localeCompare(productOf(b));
                if (cmp !== 0) return cmp;
                return String(a.date || '').localeCompare(String(b.date || ''));
            });

            const detailBody = sortedDetail.map((s) => [
                String(s.date || '').slice(0, 10),
                productOf(s),
                s.customer || s.customerName || 'Walk-in',
                String(parseInt(s.quantity, 10) || 0),
                this.formatGHS(s.price),
                this.formatGHS(this.getSaleTotal(s)),
            ]);

            const nextY = doc.lastAutoTable.finalY + 12;
            doc.setFontSize(10);
            doc.text('Detail (by product, then date)', 14, nextY);
            doc.autoTable({
                startY: nextY + 4,
                head: [['Date', 'Product', 'Customer', 'Qty', 'Unit price (GHS)', 'Line total (GHS)']],
                body: detailBody,
                styles: { fontSize: 7 },
                headStyles: { fillColor: [40, 167, 69] },
            });

            this.addFooter(doc);
            await this.savePdfOutput(
                doc,
                `product-sale-history-${new Date().toISOString().split('T')[0]}.pdf`,
                'Product Sale History',
                'Product sale history downloaded'
            );
        } catch (error) {
            console.error('Error generating product sale history PDF:', error);
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
            await this.savePdfOutput(
                doc,
                `inventory-report-${new Date().toISOString().split('T')[0]}.pdf`,
                'Inventory Report',
                'Inventory report downloaded'
            );
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
            await this.savePdfOutput(
                doc,
                `financial-statement-${new Date().toISOString().split('T')[0]}.pdf`,
                'Financial Statement',
                'Financial statement downloaded'
            );
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
            await this.savePdfOutput(
                doc,
                `profit-loss-${new Date().toISOString().split('T')[0]}.pdf`,
                'Profit & Loss Report',
                'P&L report downloaded'
            );
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

            await this.savePdfOutput(
                doc,
                `supplier-payment-history-${new Date().toISOString().split('T')[0]}.pdf`,
                'Supplier Payment History',
                'Supplier payment history downloaded'
            );
        } catch (error) {
            console.error('Error generating supplier payment history PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    getBusinessName() {
        try {
            const saved = JSON.parse(localStorage.getItem('business_settings') || '{}');
            return saved.businessName || saved.business_name || 'Ultimate Bookkeeping';
        } catch { return 'Ultimate Bookkeeping'; }
    }

    addHeader(doc, title) {
        const biz = this.getBusinessName();
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text(biz, 105, 15, { align: 'center' });

        doc.setFontSize(14);
        doc.setFont(undefined, 'normal');
        doc.text(title, 105, 25, { align: 'center' });

        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleString()} | Currency: Ghana Cedi (GHS)`, 105, 33, { align: 'center' });

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

            await this.savePdfOutput(
                doc,
                `PO-${po.poNumber || po.id}-${new Date().toISOString().split('T')[0]}.pdf`,
                'Purchase Order',
                'Purchase order exported to PDF'
            );
        } catch (error) {
            console.error('Error generating PO PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Expenses Report PDF
     */
    async generateExpensesReport(dateRange = {}) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            this.addHeader(doc, 'Expenses Report');
            this.addDateRange(doc, dateRange);

            let expenses = [...state.allExpenses];
            if (dateRange.start) expenses = expenses.filter(e => e.date >= dateRange.start);
            if (dateRange.end) expenses = expenses.filter(e => e.date <= dateRange.end);

            const operating = expenses.filter(e => !this.isDebtPayment(e));
            const debt = expenses.filter(e => this.isDebtPayment(e));
            const totalOp = operating.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
            const totalDebt = debt.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

            const byCategory = {};
            operating.forEach(e => {
                const cat = e.category || 'Uncategorised';
                byCategory[cat] = (byCategory[cat] || 0) + (parseFloat(e.amount) || 0);
            });

            const startY = (dateRange.start || dateRange.end) ? 50 : 45;
            doc.setFontSize(12);
            doc.text(`Total Operating Expenses: ${this.formatGHS(totalOp)}`, 14, startY);
            doc.text(`Debt/Liability Payments: ${this.formatGHS(totalDebt)}`, 14, startY + 8);
            doc.text(`Number of Entries: ${expenses.length}`, 14, startY + 16);

            const summaryData = Object.entries(byCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amt]) => [cat, expenses.filter(e => (e.category || 'Uncategorised') === cat).length.toString(), this.formatGHS(amt), totalOp > 0 ? ((amt / totalOp) * 100).toFixed(1) + '%' : '0%']);

            doc.autoTable({
                startY: startY + 26,
                head: [['Category', 'Count', 'Amount (GHS)', '% of Total']],
                body: summaryData,
                styles: { fontSize: 9 },
                headStyles: { fillColor: [220, 53, 69] },
            });

            const detailY = doc.lastAutoTable.finalY + 10;
            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
            doc.text('Detailed Transactions', 14, detailY);
            doc.setFont(undefined, 'normal');

            const tableData = expenses.map(e => [
                e.date || '',
                (e.description || '').substring(0, 40),
                e.category || 'N/A',
                this.isDebtPayment(e) ? 'Debt' : 'Operating',
                this.formatGHS(e.amount)
            ]);

            doc.autoTable({
                startY: detailY + 4,
                head: [['Date', 'Description', 'Category', 'Type', 'Amount (GHS)']],
                body: tableData,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [220, 53, 69] },
            });

            this.addFooter(doc);
            await this.savePdfOutput(
                doc,
                `expenses-report-${new Date().toISOString().split('T')[0]}.pdf`,
                'Expenses Report',
                'Expenses report downloaded'
            );
        } catch (error) {
            console.error('Error generating expenses PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Cash Flow Statement PDF
     */
    async generateCashFlowReport(dateRange = {}) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            this.addHeader(doc, 'Cash Flow Statement');
            this.addDateRange(doc, dateRange);

            let sales = [...state.allSales];
            let expenses = [...state.allExpenses];
            if (dateRange.start) {
                sales = sales.filter(s => s.date >= dateRange.start);
                expenses = expenses.filter(e => e.date >= dateRange.start);
            }
            if (dateRange.end) {
                sales = sales.filter(s => s.date <= dateRange.end);
                expenses = expenses.filter(e => e.date <= dateRange.end);
            }

            const opExpenses = expenses.filter(e => !this.isDebtPayment(e));
            const debtPayments = expenses.filter(e => this.isDebtPayment(e));

            const cashFromSales = sales.reduce((s, sl) => s + this.getSaleTotal(sl), 0);
            const cashToExpenses = opExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
            const cashToDebt = debtPayments.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

            const operatingCash = cashFromSales - cashToExpenses;
            const inventoryCost = state.allProducts.reduce((s, p) => s + ((parseFloat(p.cost) || 0) * (parseInt(p.quantity) || 0)), 0);
            const netCashFlow = operatingCash - cashToDebt;

            const cfData = [
                ['OPERATING ACTIVITIES', '', ''],
                ['  Cash received from sales', '', this.formatGHS(cashFromSales)],
                ['  Cash paid for operating expenses', '', `(${this.formatGHS(cashToExpenses)})`],
                ['Net Cash from Operations', '', this.formatGHS(operatingCash)],
                ['', '', ''],
                ['INVESTING ACTIVITIES', '', ''],
                ['  Inventory on hand (at cost)', '', `(${this.formatGHS(inventoryCost)})`],
                ['', '', ''],
                ['FINANCING ACTIVITIES', '', ''],
                ['  Debt/Liability payments', '', `(${this.formatGHS(cashToDebt)})`],
                ['', '', ''],
                ['NET CASH FLOW', '', this.formatGHS(netCashFlow)],
            ];

            doc.autoTable({
                startY: (dateRange.start || dateRange.end) ? 55 : 45,
                body: cfData,
                styles: { fontSize: 10 },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 110 },
                    1: { cellWidth: 30 },
                    2: { halign: 'right', cellWidth: 45 }
                },
                didParseCell: (data) => {
                    const label = data.row.raw[0];
                    if (label === 'Net Cash from Operations' || label === 'NET CASH FLOW') {
                        data.cell.styles.fillColor = [240, 240, 240];
                        data.cell.styles.fontStyle = 'bold';
                    }
                    if (label.startsWith('OPERATING') || label.startsWith('INVESTING') || label.startsWith('FINANCING')) {
                        data.cell.styles.fillColor = [0, 123, 255];
                        data.cell.styles.textColor = [255, 255, 255];
                    }
                }
            });

            const monthlyY = doc.lastAutoTable.finalY + 12;
            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
            doc.text('Monthly Breakdown', 14, monthlyY);
            doc.setFont(undefined, 'normal');

            const monthly = {};
            sales.forEach(s => {
                const m = (s.date || '').substring(0, 7);
                if (!m) return;
                if (!monthly[m]) monthly[m] = { revenue: 0, expenses: 0, debt: 0 };
                monthly[m].revenue += this.getSaleTotal(s);
            });
            opExpenses.forEach(e => {
                const m = (e.date || '').substring(0, 7);
                if (!m) return;
                if (!monthly[m]) monthly[m] = { revenue: 0, expenses: 0, debt: 0 };
                monthly[m].expenses += parseFloat(e.amount) || 0;
            });
            debtPayments.forEach(e => {
                const m = (e.date || '').substring(0, 7);
                if (!m) return;
                if (!monthly[m]) monthly[m] = { revenue: 0, expenses: 0, debt: 0 };
                monthly[m].debt += parseFloat(e.amount) || 0;
            });

            const monthlyRows = Object.entries(monthly).sort().map(([m, d]) => [
                m, this.formatGHS(d.revenue), `(${this.formatGHS(d.expenses)})`, `(${this.formatGHS(d.debt)})`, this.formatGHS(d.revenue - d.expenses - d.debt)
            ]);

            if (monthlyRows.length > 0) {
                doc.autoTable({
                    startY: monthlyY + 4,
                    head: [['Month', 'Revenue', 'Expenses', 'Debt', 'Net Cash']],
                    body: monthlyRows,
                    styles: { fontSize: 8 },
                    headStyles: { fillColor: [0, 123, 255] },
                });
            }

            this.addFooter(doc);
            await this.savePdfOutput(
                doc,
                `cashflow-statement-${new Date().toISOString().split('T')[0]}.pdf`,
                'Cash Flow Statement',
                'Cash flow statement downloaded'
            );
        } catch (error) {
            console.error('Error generating cash flow PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Tax / VAT Summary PDF
     */
    async generateTaxReport(dateRange = {}) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            this.addHeader(doc, 'Tax / VAT Summary Report');
            this.addDateRange(doc, dateRange);

            let sales = [...state.allSales];
            let expenses = [...state.allExpenses];
            if (dateRange.start) {
                sales = sales.filter(s => s.date >= dateRange.start);
                expenses = expenses.filter(e => e.date >= dateRange.start);
            }
            if (dateRange.end) {
                sales = sales.filter(s => s.date <= dateRange.end);
                expenses = expenses.filter(e => e.date <= dateRange.end);
            }

            let taxCollected = 0, taxableSales = 0, exemptSales = 0;
            const byRate = {};

            sales.forEach(s => {
                const rate = parseFloat(s.tax) || 0;
                const qty = parseFloat(s.quantity) || 1;
                const price = parseFloat(s.price) || 0;
                const discount = parseFloat(s.discount) || 0;
                const subtotal = qty * price * (1 - discount / 100);
                const taxAmt = subtotal * (rate / 100);

                if (rate > 0) {
                    taxableSales += subtotal;
                    taxCollected += taxAmt;
                    const key = `${rate}%`;
                    if (!byRate[key]) byRate[key] = { count: 0, taxable: 0, tax: 0 };
                    byRate[key].count++;
                    byRate[key].taxable += subtotal;
                    byRate[key].tax += taxAmt;
                } else {
                    exemptSales += subtotal;
                }
            });

            let inputTax = 0;
            expenses.forEach(e => {
                const eTax = parseFloat(e.tax) || 0;
                if (eTax > 0) inputTax += (parseFloat(e.amount) || 0) * (eTax / 100);
            });

            const netPayable = taxCollected - inputTax;

            const startY = (dateRange.start || dateRange.end) ? 52 : 45;
            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
            doc.text('Tax Overview', 14, startY);
            doc.setFont(undefined, 'normal');

            const overviewData = [
                ['Total Sales Revenue', this.formatGHS(taxableSales + exemptSales)],
                ['Taxable Sales', this.formatGHS(taxableSales)],
                ['Tax-Exempt Sales', this.formatGHS(exemptSales)],
                ['', ''],
                ['Output Tax (collected from sales)', this.formatGHS(taxCollected)],
                ['Input Tax (paid on expenses)', `(${this.formatGHS(inputTax)})`],
                ['Net Tax Payable / (Refundable)', this.formatGHS(netPayable)],
            ];

            doc.autoTable({
                startY: startY + 4,
                body: overviewData,
                styles: { fontSize: 10 },
                columnStyles: {
                    0: { cellWidth: 120 },
                    1: { halign: 'right', cellWidth: 60 }
                },
                didParseCell: (data) => {
                    if (data.row.raw[0].startsWith('Net Tax')) {
                        data.cell.styles.fillColor = netPayable >= 0 ? [255, 243, 205] : [209, 236, 241];
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            });

            if (Object.keys(byRate).length > 0) {
                const breakY = doc.lastAutoTable.finalY + 10;
                doc.setFontSize(11);
                doc.setFont(undefined, 'bold');
                doc.text('Tax Rate Breakdown', 14, breakY);
                doc.setFont(undefined, 'normal');

                const breakdownRows = Object.entries(byRate)
                    .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
                    .map(([rate, d]) => [rate, d.count.toString(), this.formatGHS(d.taxable), this.formatGHS(d.tax)]);

                doc.autoTable({
                    startY: breakY + 4,
                    head: [['Tax Rate', 'Transactions', 'Taxable Amount (GHS)', 'Tax Collected (GHS)']],
                    body: breakdownRows,
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [255, 193, 7], textColor: [0, 0, 0] },
                });
            }

            this.addFooter(doc);
            await this.savePdfOutput(
                doc,
                `tax-report-${new Date().toISOString().split('T')[0]}.pdf`,
                'Tax Report',
                'Tax report downloaded'
            );
        } catch (error) {
            console.error('Error generating tax PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Accounts Receivable Aging PDF
     */
    async generateARAgingReport() {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('l');

            this.addHeader(doc, 'Accounts Receivable Aging Report');
            const pageW = doc.internal.pageSize.getWidth();

            const today = new Date();
            const customers = state.allCustomers.filter(c => (parseFloat(c.balance) || 0) > 0);
            const buckets = { current: [], days30: [], days60: [], days90: [] };

            customers.forEach(c => {
                const bal = parseFloat(c.balance) || 0;
                let ageDays = 999;
                const lp = c.lastPurchase || c.last_purchase || '';
                if (lp) {
                    try {
                        const lpDate = lp.includes('T') ? new Date(lp) : new Date(lp + 'T00:00:00');
                        ageDays = Math.floor((today - lpDate) / (1000 * 60 * 60 * 24));
                    } catch { ageDays = 999; }
                }

                const entry = [c.name || 'Unknown', c.email || '', c.phone || '', this.formatGHS(bal), `${ageDays}d`, lp ? lp.substring(0, 10) : 'N/A'];
                if (ageDays <= 30) buckets.current.push(entry);
                else if (ageDays <= 60) buckets.days30.push(entry);
                else if (ageDays <= 90) buckets.days60.push(entry);
                else buckets.days90.push(entry);
            });

            const totalReceivable = customers.reduce((s, c) => s + (parseFloat(c.balance) || 0), 0);

            const summaryData = [
                ['Current (0-30 days)', buckets.current.length.toString(), this.formatGHS(buckets.current.reduce((s, r) => s + parseFloat(r[3].replace('GHS ', '').replace(',', '')), 0))],
                ['31-60 days', buckets.days30.length.toString(), this.formatGHS(buckets.days30.reduce((s, r) => s + parseFloat(r[3].replace('GHS ', '').replace(',', '')), 0))],
                ['61-90 days', buckets.days60.length.toString(), this.formatGHS(buckets.days60.reduce((s, r) => s + parseFloat(r[3].replace('GHS ', '').replace(',', '')), 0))],
                ['Over 90 days', buckets.days90.length.toString(), this.formatGHS(buckets.days90.reduce((s, r) => s + parseFloat(r[3].replace('GHS ', '').replace(',', '')), 0))],
                ['TOTAL', customers.length.toString(), this.formatGHS(totalReceivable)],
            ];

            doc.setFontSize(12);
            doc.text(`Total Receivable: ${this.formatGHS(totalReceivable)}  |  Customers with balances: ${customers.length}`, 14, 45);

            doc.autoTable({
                startY: 52,
                head: [['Aging Bucket', 'Customers', 'Amount (GHS)']],
                body: summaryData,
                styles: { fontSize: 10 },
                headStyles: { fillColor: [220, 53, 69] },
                didParseCell: (data) => {
                    if (data.row.raw[0] === 'TOTAL') {
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.fillColor = [240, 240, 240];
                    }
                    if (data.row.raw[0] === 'Over 90 days') {
                        data.cell.styles.textColor = [220, 53, 69];
                    }
                }
            });

            const allEntries = [
                ...buckets.current.map(e => ['Current', ...e]),
                ...buckets.days30.map(e => ['31-60d', ...e]),
                ...buckets.days60.map(e => ['61-90d', ...e]),
                ...buckets.days90.map(e => ['90d+', ...e]),
            ];

            if (allEntries.length > 0) {
                doc.autoTable({
                    startY: doc.lastAutoTable.finalY + 10,
                    head: [['Bucket', 'Customer', 'Email', 'Phone', 'Balance (GHS)', 'Age', 'Last Purchase']],
                    body: allEntries,
                    styles: { fontSize: 8 },
                    headStyles: { fillColor: [220, 53, 69] },
                    didParseCell: (data) => {
                        if (data.row.raw[0] === '90d+') data.cell.styles.textColor = [220, 53, 69];
                    }
                });
            }

            this.addFooter(doc);
            await this.savePdfOutput(
                doc,
                `ar-aging-report-${new Date().toISOString().split('T')[0]}.pdf`,
                'AR Aging Report',
                'AR aging report downloaded'
            );
        } catch (error) {
            console.error('Error generating AR aging PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Customer Statement PDF for a specific customer
     */
    async generateCustomerStatement(customerId) {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            const customer = state.allCustomers.find(c => c.id === customerId);
            if (!customer) throw new Error('Customer not found');

            this.addHeader(doc, 'Customer Account Statement');

            doc.setFontSize(11);
            let y = 45;
            doc.setFont(undefined, 'bold');
            doc.text('Customer Details', 14, y);
            doc.setFont(undefined, 'normal');
            y += 7;
            doc.text(`Name: ${customer.name || 'N/A'}`, 14, y);
            doc.text(`Email: ${customer.email || 'N/A'}`, 110, y);
            y += 6;
            doc.text(`Phone: ${customer.phone || 'N/A'}`, 14, y);
            doc.text(`Balance: ${this.formatGHS(customer.balance || 0)}`, 110, y);
            y += 10;

            const customerSales = state.allSales
                .filter(s => s.customerId === customerId || s.customer === customer.name)
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

            const tableData = customerSales.map(s => [
                s.date || '',
                s.product || s.productName || '',
                (s.quantity || 0).toString(),
                this.formatGHS(s.price || 0),
                this.formatGHS(this.getSaleTotal(s)),
            ]);

            const totalSpent = customerSales.reduce((s, sl) => s + this.getSaleTotal(sl), 0);

            doc.autoTable({
                startY: y,
                head: [['Date', 'Product', 'Qty', 'Price (GHS)', 'Total (GHS)']],
                body: tableData,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [0, 123, 255] },
                foot: [['', '', '', 'Total Purchased', this.formatGHS(totalSpent)]],
                footStyles: { fillColor: [240, 240, 240], fontStyle: 'bold' }
            });

            this.addFooter(doc);
            await this.savePdfOutput(
                doc,
                `statement-${(customer.name || 'customer').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`,
                `Statement — ${customer.name || 'Customer'}`,
                'Customer statement downloaded'
            );
        } catch (error) {
            console.error('Error generating customer statement PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    /**
     * Generate Stock Valuation Report PDF
     */
    async generateStockValuationReport() {
        try {
            await this.loadJSPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('l');

            this.addHeader(doc, 'Stock Valuation & Movement Report');

            const products = [...state.allProducts].sort((a, b) => (a.category || '').localeCompare(b.category || ''));
            const totalCost = products.reduce((s, p) => s + ((parseFloat(p.cost) || 0) * (parseInt(p.quantity) || 0)), 0);
            const totalRetail = products.reduce((s, p) => s + ((parseFloat(p.price) || 0) * (parseInt(p.quantity) || 0)), 0);
            const lowStock = products.filter(p => (parseInt(p.quantity) || 0) <= (parseInt(p.minStock) || 10));
            const outOfStock = products.filter(p => (parseInt(p.quantity) || 0) === 0);

            doc.setFontSize(11);
            doc.text(`Total Products: ${products.length}  |  Low Stock: ${lowStock.length}  |  Out of Stock: ${outOfStock.length}`, 14, 45);
            doc.text(`Cost Value: ${this.formatGHS(totalCost)}  |  Retail Value: ${this.formatGHS(totalRetail)}  |  Potential Profit: ${this.formatGHS(totalRetail - totalCost)}`, 14, 53);

            const byCategory = {};
            products.forEach(p => {
                const cat = p.category || 'Uncategorised';
                if (!byCategory[cat]) byCategory[cat] = { count: 0, units: 0, costVal: 0, retailVal: 0 };
                byCategory[cat].count++;
                byCategory[cat].units += parseInt(p.quantity) || 0;
                byCategory[cat].costVal += (parseFloat(p.cost) || 0) * (parseInt(p.quantity) || 0);
                byCategory[cat].retailVal += (parseFloat(p.price) || 0) * (parseInt(p.quantity) || 0);
            });

            const catRows = Object.entries(byCategory).sort((a, b) => b[1].retailVal - a[1].retailVal).map(([cat, d]) => [
                cat, d.count.toString(), d.units.toString(), this.formatGHS(d.costVal), this.formatGHS(d.retailVal), this.formatGHS(d.retailVal - d.costVal)
            ]);

            doc.autoTable({
                startY: 60,
                head: [['Category', 'Products', 'Total Units', 'Cost Value (GHS)', 'Retail Value (GHS)', 'Potential Profit (GHS)']],
                body: catRows,
                styles: { fontSize: 9 },
                headStyles: { fillColor: [40, 167, 69] },
            });

            const detailY = doc.lastAutoTable.finalY + 10;
            const detailRows = products.map(p => {
                const qty = parseInt(p.quantity) || 0;
                const cost = parseFloat(p.cost) || 0;
                const price = parseFloat(p.price) || 0;
                const minStock = parseInt(p.minStock) || 10;
                let status = 'OK';
                if (qty === 0) status = 'OUT';
                else if (qty <= minStock) status = 'LOW';

                return [p.name, p.category || 'N/A', qty.toString(), this.formatGHS(cost), this.formatGHS(price), this.formatGHS(cost * qty), this.formatGHS(price * qty), status];
            });

            doc.autoTable({
                startY: detailY,
                head: [['Product', 'Category', 'Qty', 'Cost', 'Price', 'Cost Value', 'Retail Value', 'Status']],
                body: detailRows,
                styles: { fontSize: 7 },
                headStyles: { fillColor: [40, 167, 69] },
                didParseCell: (data) => {
                    if (data.column.index === 7) {
                        const val = data.cell.raw;
                        if (val === 'OUT') data.cell.styles.textColor = [220, 53, 69];
                        else if (val === 'LOW') data.cell.styles.textColor = [255, 193, 7];
                    }
                }
            });

            this.addFooter(doc);
            await this.savePdfOutput(
                doc,
                `stock-valuation-${new Date().toISOString().split('T')[0]}.pdf`,
                'Stock Valuation Report',
                'Stock valuation report downloaded'
            );
        } catch (error) {
            console.error('Error generating stock valuation PDF:', error);
            Utils.showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    showExportModal() {
        document.getElementById('pdf-export-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'pdf-export-modal';
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 520px;">
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
                
                <div class="export-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                    <button onclick="pdfExport.handleExport('sales')" class="export-btn">
                        <i class="fas fa-chart-line"></i> Sales
                    </button>
                    <button onclick="pdfExport.handleExport('inventory')" class="export-btn">
                        <i class="fas fa-boxes"></i> Inventory
                    </button>
                    <button onclick="pdfExport.handleExport('financial')" class="export-btn">
                        <i class="fas fa-balance-scale"></i> Financial Statement
                    </button>
                    <button onclick="pdfExport.handleExport('pnl')" class="export-btn">
                        <i class="fas fa-chart-bar"></i> Profit & Loss
                    </button>
                    <button onclick="pdfExport.handleExport('expenses')" class="export-btn">
                        <i class="fas fa-credit-card"></i> Expenses
                    </button>
                    <button onclick="pdfExport.handleExport('cashflow')" class="export-btn">
                        <i class="fas fa-money-bill-wave"></i> Cash Flow
                    </button>
                    <button onclick="pdfExport.handleExport('tax')" class="export-btn">
                        <i class="fas fa-percentage"></i> Tax / VAT
                    </button>
                    <button onclick="pdfExport.handleExport('ar-aging')" class="export-btn">
                        <i class="fas fa-user-clock"></i> AR Aging
                    </button>
                    <button onclick="pdfExport.handleExport('stock-valuation')" class="export-btn">
                        <i class="fas fa-warehouse"></i> Stock Valuation
                    </button>
                    <button onclick="pdfExport.handleExport('product-sale-history')" class="export-btn">
                        <i class="fas fa-history"></i> Product sale history
                    </button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);
    }

    handleExport(type) {
        const dateRange = {
            start: document.getElementById('export-start-date')?.value,
            end: document.getElementById('export-end-date')?.value
        };

        switch (type) {
            case 'sales': this.generateSalesReport(dateRange); break;
            case 'inventory': this.generateInventoryReport(dateRange); break;
            case 'financial': this.generateFinancialStatement(dateRange); break;
            case 'pnl': this.generateProfitLossReport(dateRange); break;
            case 'expenses': this.generateExpensesReport(dateRange); break;
            case 'cashflow': this.generateCashFlowReport(dateRange); break;
            case 'tax': this.generateTaxReport(dateRange); break;
            case 'ar-aging': this.generateARAgingReport(); break;
            case 'stock-valuation': this.generateStockValuationReport(); break;
            case 'product-sale-history': this.generateProductSaleHistoryPdf(dateRange); break;
        }

        document.getElementById('pdf-export-modal')?.remove();
    }
}

export const pdfExport = new PDFExportService();
window.pdfExport = pdfExport;
