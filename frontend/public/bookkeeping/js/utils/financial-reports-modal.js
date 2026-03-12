// ==================== FINANCIAL REPORTS MODAL ====================
// Mobile-friendly financial reports viewer
// Replaces window.open() with in-app modal display

export class FinancialReportsModal {
    
    /**
     * Show a financial report in a modal
     * @param {string} reportHTML - The HTML content of the report
     * @param {string} reportTitle - Title of the report
     * @param {string} reportType - Type: 'income-statement', 'balance-sheet', 'cash-flow'
     */
    static show(reportHTML, reportTitle, reportType) {
        // Remove any existing report modal
        const existing = document.querySelector('.financial-report-modal');
        if (existing) existing.remove();
        
        // Extract just the body content from reportHTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = reportHTML;
        const bodyContent = tempDiv.querySelector('body')?.innerHTML || reportHTML;
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'financial-report-modal';
        modal.innerHTML = `
            <div class="report-modal-overlay"></div>
            <div class="report-modal-container">
                <div class="report-modal-header">
                    <button class="report-back-btn" aria-label="Close">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <h2 class="report-title">${reportTitle}</h2>
                    <div class="report-actions">
                        <button class="report-action-btn print-btn" aria-label="Print" title="Print Report">
                            <i class="fas fa-print"></i>
                        </button>
                        <button class="report-action-btn share-btn" aria-label="Share" title="Share Report">
                            <i class="fas fa-share-alt"></i>
                        </button>
                        <button class="report-action-btn download-btn" aria-label="Download" title="Download PDF">
                            <i class="fas fa-download"></i>
                        </button>
                    </div>
                </div>
                <div class="report-modal-body">
                    ${bodyContent}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add event listeners
        this.setupEventListeners(modal, reportHTML, reportTitle, reportType);
        
        // Prevent body scroll
        document.body.style.overflow = 'hidden';
        
        // Animate in
        setTimeout(() => modal.classList.add('active'), 10);
    }
    
    /**
     * Setup event listeners for modal actions
     */
    static setupEventListeners(modal, reportHTML, reportTitle, reportType) {
        // Close button
        modal.querySelector('.report-back-btn').addEventListener('click', () => {
            this.close(modal);
        });
        
        // Close on overlay click
        modal.querySelector('.report-modal-overlay').addEventListener('click', () => {
            this.close(modal);
        });
        
        // Print button
        modal.querySelector('.print-btn').addEventListener('click', () => {
            this.handlePrint(modal, reportHTML, reportTitle);
        });
        
        // Share button
        modal.querySelector('.share-btn').addEventListener('click', () => {
            this.handleShare(modal, reportHTML, reportTitle, reportType);
        });
        
        // Download button
        modal.querySelector('.download-btn').addEventListener('click', () => {
            this.handleDownload(modal, reportHTML, reportTitle, reportType);
        });
        
        // ESC key to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.close(modal);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }
    
    /**
     * Close the modal
     */
    static close(modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => modal.remove(), 300);
    }
    
    /**
     * Handle print action
     */
    static async handlePrint(modal, reportHTML, reportTitle) {
        if (this.isCapacitor()) {
            // Mobile: Generate PDF and use native print
            await this.printViaPDF(reportHTML, reportTitle);
        } else {
            // Desktop: Use window.print()
            const printWindow = window.open('', '_blank');
            printWindow.document.write(reportHTML);
            printWindow.document.close();
            printWindow.print();
        }
    }
    
    /**
     * Handle share action
     */
    static async handleShare(modal, reportHTML, reportTitle, reportType) {
        if (!this.isCapacitor()) {
            // Desktop: Show message or fallback to print
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Share feature is available on mobile app', 'info');
            }
            return;
        }
        
        try {
            // Generate PDF
            const pdfBlob = await this.generatePDF(reportHTML, reportTitle);
            
            // Save to temporary file
            const { Filesystem, Directory } = await import('@capacitor/filesystem');
            const base64Data = await this.blobToBase64(pdfBlob);
            const fileName = `${reportType}-${Date.now()}.pdf`;
            
            const result = await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: Directory.Cache
            });
            
            // Share the file
            const { Share } = await import('@capacitor/share');
            await Share.share({
                title: reportTitle,
                text: `${reportTitle} - Generated on ${new Date().toLocaleDateString()}`,
                url: result.uri,
                dialogTitle: 'Share Report'
            });
            
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Report shared successfully', 'success');
            }
        } catch (error) {
            console.error('Share error:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Failed to share report: ' + error.message, 'error');
            }
        }
    }
    
    /**
     * Handle download action
     */
    static async handleDownload(modal, reportHTML, reportTitle, reportType) {
        try {
            const pdfBlob = await this.generatePDF(reportHTML, reportTitle);
            
            if (this.isCapacitor()) {
                // Mobile: Save to Downloads or Documents
                const { Filesystem, Directory } = await import('@capacitor/filesystem');
                const base64Data = await this.blobToBase64(pdfBlob);
                const fileName = `${reportType}-${Date.now()}.pdf`;
                
                await Filesystem.writeFile({
                    path: fileName,
                    data: base64Data,
                    directory: Directory.Documents
                });
                
                if (typeof Utils !== 'undefined' && Utils.showToast) {
                    Utils.showToast('Report saved to Documents', 'success');
                }
            } else {
                // Desktop: Trigger download
                const url = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${reportType}-${Date.now()}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                if (typeof Utils !== 'undefined' && Utils.showToast) {
                    Utils.showToast('Report downloaded', 'success');
                }
            }
        } catch (error) {
            console.error('Download error:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Failed to download report: ' + error.message, 'error');
            }
        }
    }
    
    /**
     * Generate PDF from HTML
     */
    static async generatePDF(reportHTML, reportTitle) {
        // Check if jsPDF is available
        if (typeof window.jspdf === 'undefined') {
            // Load jsPDF dynamically
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }
        
        // Check if html2canvas is available
        if (typeof html2canvas === 'undefined') {
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
        }
        
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        
        // Create temporary container for rendering
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.width = '210mm'; // A4 width
        container.innerHTML = reportHTML;
        document.body.appendChild(container);
        
        // Convert to canvas
        const canvas = await html2canvas(container.querySelector('body') || container, {
            scale: 2,
            useCORS: true,
            logging: false
        });
        
        document.body.removeChild(container);
        
        // Add canvas to PDF
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = 210; // A4 width in mm
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
        
        return pdf.output('blob');
    }
    
    /**
     * Print via PDF (for mobile)
     */
    static async printViaPDF(reportHTML, reportTitle) {
        try {
            const pdfBlob = await this.generatePDF(reportHTML, reportTitle);
            const pdfUrl = URL.createObjectURL(pdfBlob);
            
            // Try to open in system PDF viewer
            if (this.isCapacitor()) {
                const { Browser } = await import('@capacitor/browser');
                await Browser.open({ url: pdfUrl });
            } else {
                window.open(pdfUrl, '_blank');
            }
        } catch (error) {
            console.error('Print error:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Failed to print: ' + error.message, 'error');
            }
        }
    }
    
    /**
     * Convert Blob to Base64
     */
    static blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    /**
     * Load external script
     */
    static loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    /**
     * Check if running in Capacitor
     */
    static isCapacitor() {
        return window.Capacitor !== undefined;
    }
}

// Export for use in other modules
window.FinancialReportsModal = FinancialReportsModal;
