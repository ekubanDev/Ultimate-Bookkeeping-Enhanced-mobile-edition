// ==================== FINANCIAL REPORTS MODAL ====================
// Mobile-friendly financial reports viewer + native save/share via Capacitor

import {
    sharePdfBlobBestEffort,
    downloadPdfBlobInBrowser,
    PDF_SHARE_UNAVAILABLE,
} from './native-pdf-save.js';

export class FinancialReportsModal {

    static parseReportBodyHTML(reportHTML) {
        try {
            const doc = new DOMParser().parseFromString(reportHTML, 'text/html');
            if (doc.body && doc.body.innerHTML.trim()) {
                return doc.body.innerHTML;
            }
        } catch (e) {
            console.warn('parseReportBodyHTML:', e);
        }
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = reportHTML;
        return tempDiv.querySelector('body')?.innerHTML || reportHTML;
    }

    static show(reportHTML, reportTitle, reportType) {
        const existing = document.querySelector('.financial-report-modal');
        if (existing) existing.remove();

        const bodyContent = this.parseReportBodyHTML(reportHTML);

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
                        <button class="report-action-btn print-btn" aria-label="Print" title="Print / open PDF">
                            <i class="fas fa-print"></i>
                        </button>
                        <button class="report-action-btn share-btn" aria-label="Share" title="Share report">
                            <i class="fas fa-share-alt"></i>
                        </button>
                        <button class="report-action-btn download-btn" aria-label="Download" title="Save PDF">
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
        this.setupEventListeners(modal, reportHTML, reportTitle, reportType);
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => modal.classList.add('active'));
    }

    static setupEventListeners(modal, reportHTML, reportTitle, reportType) {
        modal.querySelector('.report-back-btn').addEventListener('click', () => this.close(modal));
        modal.querySelector('.report-modal-overlay').addEventListener('click', () => this.close(modal));
        modal.querySelector('.print-btn').addEventListener('click', () => {
            this.handlePrint(modal, reportHTML, reportTitle, reportType);
        });
        modal.querySelector('.share-btn').addEventListener('click', () => {
            this.handleShare(modal, reportHTML, reportTitle, reportType);
        });
        modal.querySelector('.download-btn').addEventListener('click', () => {
            this.handleDownload(modal, reportHTML, reportTitle, reportType);
        });

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.close(modal);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    static close(modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => modal.remove(), 300);
    }

    static isNativeCapacitor() {
        return window.Capacitor?.isNativePlatform?.() === true;
    }

    static async loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(script);
        });
    }

    static async generatePDF(modal, reportTitle) {
        const bodyEl = modal.querySelector('.report-modal-body');
        if (!bodyEl) {
            throw new Error('Report content not found');
        }

        if (typeof window.jspdf === 'undefined') {
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }
        if (typeof html2canvas === 'undefined') {
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
        }

        const clone = bodyEl.cloneNode(true);
        clone.style.position = 'absolute';
        clone.style.left = '-9999px';
        clone.style.top = '0';
        clone.style.width = '794px';
        clone.style.background = '#ffffff';
        clone.style.padding = '24px';
        document.body.appendChild(clone);

        try {
            const canvas = await html2canvas(clone, {
                scale: Math.min(2, window.devicePixelRatio || 2),
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
            });
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            const margin = 10;
            const imgW = pageW - 2 * margin;
            const imgData = canvas.toDataURL('image/png', 0.92);
            const imgH = (canvas.height * imgW) / canvas.width;
            let heightLeft = imgH;
            let position = margin;

            pdf.addImage(imgData, 'PNG', margin, position, imgW, imgH);
            heightLeft -= pageH - 2 * margin;

            while (heightLeft > 0) {
                position = heightLeft - imgH + margin;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', margin, position, imgW, imgH);
                heightLeft -= pageH - 2 * margin;
            }

            return pdf.output('blob');
        } finally {
            document.body.removeChild(clone);
        }
    }

    static async savePdfAndShare(pdfBlob, fileName, reportTitle, successMessage) {
        if (typeof Utils !== 'undefined' && Utils.showToast) {
            Utils.showToast('Generating PDF for sharing…', 'info');
        }

        const hint = successMessage || 'Save to Files, email, or another app';
        const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');

        try {
            await sharePdfBlobBestEffort(pdfBlob, safeName, reportTitle, hint);
        } catch (shareErr) {
            if (shareErr && shareErr.name === 'AbortError') return;
            if (shareErr && String(shareErr.message || '').toLowerCase().includes('cancel')) {
                return;
            }
            if (shareErr && (shareErr.code === PDF_SHARE_UNAVAILABLE || shareErr.message === PDF_SHARE_UNAVAILABLE)) {
                try {
                    downloadPdfBlobInBrowser(pdfBlob, fileName);
                } catch (dl) {
                    console.error('PDF download fallback failed:', dl);
                    throw shareErr;
                }
            } else {
                try {
                    downloadPdfBlobInBrowser(pdfBlob, fileName);
                } catch (dl) {
                    throw shareErr;
                }
            }
        }

        if (typeof Utils !== 'undefined' && Utils.showToast) {
            Utils.showToast(successMessage || 'Use the share sheet to save your PDF', 'success');
        }
    }

    static async handlePrint(modal, reportHTML, reportTitle, reportType) {
        const fileName = `${reportType || 'report'}-${Date.now()}.pdf`;
        try {
            if (this.isNativeCapacitor()) {
                if (typeof Utils !== 'undefined' && Utils.showToast) {
                    Utils.showToast('Preparing report (native)…', 'info');
                }
                const pdfBlob = await this.generatePDF(modal, reportTitle);
                await this.savePdfAndShare(
                    pdfBlob,
                    fileName,
                    reportTitle,
                    'Open share sheet to print or save the PDF'
                );
                return;
            }
            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(reportHTML);
                printWindow.document.close();
                printWindow.focus();
                printWindow.print();
            } else {
                const pdfBlob = await this.generatePDF(modal, reportTitle);
                const url = URL.createObjectURL(pdfBlob);
                window.open(url, '_blank');
            }
        } catch (error) {
            console.error('Print error:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Print failed: ' + (error.message || error), 'error');
            }
        }
    }

    static async handleShare(modal, reportHTML, reportTitle, reportType) {
        const fileName = `${reportType || 'report'}-${Date.now()}.pdf`;
        try {
            if (!this.isNativeCapacitor()) {
                if (typeof Utils !== 'undefined' && Utils.showToast) {
                    Utils.showToast('Generating PDF…', 'info');
                }
                const pdfBlob = await this.generatePDF(modal, reportTitle);
                const url = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
                return;
            }
            const pdfBlob = await this.generatePDF(modal, reportTitle);
            await this.savePdfAndShare(
                pdfBlob,
                fileName,
                reportTitle,
                'Share or save this report'
            );
        } catch (error) {
            console.error('Share error:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Share failed: ' + (error.message || error), 'error');
            }
        }
    }

    static async handleDownload(modal, reportHTML, reportTitle, reportType) {
        const fileName = `${reportType || 'report'}-${Date.now()}.pdf`;
        try {
            const pdfBlob = await this.generatePDF(modal, reportTitle);

            if (this.isNativeCapacitor()) {
                if (typeof Utils !== 'undefined' && Utils.showToast) {
                    Utils.showToast('Saving report to device…', 'info');
                }
                await this.savePdfAndShare(
                    pdfBlob,
                    fileName,
                    reportTitle,
                    'Tap Save to Files to download the PDF'
                );
                return;
            }

            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                const label = (reportTitle || reportType || 'Report').trim();
                Utils.showToast(
                    `Saved: ${label}\nFile: ${fileName}`,
                    'success'
                );
            }
        } catch (error) {
            console.error('Download error:', error);
            if (typeof Utils !== 'undefined' && Utils.showToast) {
                Utils.showToast('Download failed: ' + (error.message || error), 'error');
            }
        }
    }
}

window.FinancialReportsModal = FinancialReportsModal;
