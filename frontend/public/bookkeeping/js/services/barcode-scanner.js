/**
 * Barcode Scanner Service
 * Integrates barcode scanning for faster sales entry
 */

import { state } from '../utils/state.js';
import { Utils } from '../utils/utils.js';

class BarcodeScannerService {
    constructor() {
        this.isScanning = false;
        this.scanBuffer = '';
        this.scanTimeout = null;
        this.lastScanTime = 0;
        this.codeReader = null;
        this.videoStream = null;
        this.onScanCallback = null;
    }

    /**
     * Initialize keyboard-based barcode scanning
     * Most USB barcode scanners act as keyboards
     */
    initKeyboardScanner(callback) {
        this.onScanCallback = callback;
        
        document.addEventListener('keypress', (e) => {
            if (this.isInputFocused()) return;
            
            const now = Date.now();
            
            // If more than 100ms between keypresses, start new scan
            if (now - this.lastScanTime > 100) {
                this.scanBuffer = '';
            }
            
            this.lastScanTime = now;
            
            // Enter key indicates end of scan
            if (e.key === 'Enter' && this.scanBuffer.length >= 8) {
                this.handleScan(this.scanBuffer);
                this.scanBuffer = '';
                return;
            }
            
            // Only accept numbers for barcode
            if (/^\d$/.test(e.key)) {
                this.scanBuffer += e.key;
            }
            
            // Clear buffer after 500ms of inactivity
            clearTimeout(this.scanTimeout);
            this.scanTimeout = setTimeout(() => {
                if (this.scanBuffer.length >= 8) {
                    this.handleScan(this.scanBuffer);
                }
                this.scanBuffer = '';
            }, 500);
        });
        
        console.log('Keyboard barcode scanner initialized');
    }

    /**
     * Check if an input field is focused
     */
    isInputFocused() {
        const activeElement = document.activeElement;
        return activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.tagName === 'SELECT' ||
            activeElement.isContentEditable
        );
    }

    /**
     * Initialize camera-based barcode scanning
     */
    async initCameraScanner(videoElementId) {
        try {
            // Load QuaggaJS or ZXing library
            if (!window.Quagga) {
                await this.loadQuaggaJS();
            }

            this.isScanning = true;
            
            Quagga.init({
                inputStream: {
                    name: 'Live',
                    type: 'LiveStream',
                    target: document.getElementById(videoElementId),
                    constraints: {
                        facingMode: 'environment'
                    }
                },
                decoder: {
                    readers: [
                        'ean_reader',
                        'ean_8_reader',
                        'code_128_reader',
                        'code_39_reader',
                        'upc_reader',
                        'upc_e_reader'
                    ]
                }
            }, (err) => {
                if (err) {
                    console.error('QuaggaJS init error:', err);
                    Utils.showToast('Failed to start camera scanner', 'error');
                    return;
                }
                Quagga.start();
            });

            Quagga.onDetected((result) => {
                const code = result.codeResult.code;
                if (code) {
                    // Vibrate on successful scan (mobile)
                    if (navigator.vibrate) {
                        navigator.vibrate(100);
                    }
                    this.handleScan(code);
                }
            });

        } catch (error) {
            console.error('Camera scanner error:', error);
            Utils.showToast('Camera access denied or unavailable', 'error');
        }
    }

    /**
     * Load QuaggaJS library
     */
    loadQuaggaJS() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Stop camera scanner
     */
    stopCameraScanner() {
        if (window.Quagga) {
            Quagga.stop();
        }
        this.isScanning = false;
    }

    /**
     * Handle scanned barcode
     */
    handleScan(barcode) {
        console.log('Barcode scanned:', barcode);
        
        // Find product by barcode
        const product = state.allProducts.find(p => p.barcode === barcode);
        
        if (product) {
            Utils.showToast(`Found: ${product.name}`, 'success');
            
            // Call callback if set
            if (this.onScanCallback) {
                this.onScanCallback(product);
            } else {
                // Default: Add to sale
                this.addToSale(product);
            }
        } else {
            Utils.showToast(`Product not found for barcode: ${barcode}`, 'warning');
            
            // Offer to create product
            this.showProductNotFoundModal(barcode);
        }
    }

    /**
     * Add scanned product to sale
     */
    addToSale(product) {
        // Check if add-sale modal is open
        const saleModal = document.getElementById('add-sale-modal');
        if (saleModal && saleModal.style.display === 'block') {
            // Fill in product details
            document.getElementById('sale-product').value = product.id;
            document.getElementById('sale-product-search').value = product.name;
            document.getElementById('sale-price').value = product.price;
            document.getElementById('sale-quantity').value = 1;
            
            // Show product info
            const productInfo = document.getElementById('sale-product-info');
            if (productInfo) {
                productInfo.style.display = 'block';
                document.getElementById('selected-product-name').textContent = product.name;
                document.getElementById('selected-product-stock').textContent = product.quantity;
                document.getElementById('selected-product-price').textContent = Utils.formatCurrency(product.price);
            }
            
            // Update total preview
            if (window.appController) {
                window.appController.updateSaleTotal();
            }
        } else {
            // Open sale modal with product pre-filled
            if (window.appController) {
                window.appController.openSaleModalWithProduct(product);
            }
        }
    }

    /**
     * Show modal when product not found
     */
    showProductNotFoundModal(barcode) {
        const modal = document.createElement('div');
        modal.id = 'barcode-not-found-modal';
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <span class="close" onclick="document.getElementById('barcode-not-found-modal').remove()">&times;</span>
                <h3><i class="fas fa-barcode"></i> Product Not Found</h3>
                <p style="text-align: center; margin: 1rem 0;">
                    No product found with barcode:<br>
                    <strong style="font-size: 1.5rem;">${barcode}</strong>
                </p>
                <div style="display: flex; gap: 1rem;">
                    <button onclick="barcodeScanner.createProductWithBarcode('${barcode}')" style="flex: 1; background: #28a745;">
                        <i class="fas fa-plus"></i> Add New Product
                    </button>
                    <button onclick="document.getElementById('barcode-not-found-modal').remove()" style="flex: 1; background: #6c757d;">
                        <i class="fas fa-times"></i> Cancel
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    /**
     * Create new product with scanned barcode
     */
    createProductWithBarcode(barcode) {
        document.getElementById('barcode-not-found-modal').remove();
        
        // Open add product modal
        document.getElementById('add-product-modal').style.display = 'block';
        
        // Pre-fill barcode
        const barcodeInput = document.getElementById('product-barcode-input');
        if (barcodeInput) {
            barcodeInput.value = barcode;
        }
        
        // Show barcode preview
        const previewCanvas = document.getElementById('preview-barcode');
        if (previewCanvas && window.JsBarcode) {
            previewCanvas.style.display = 'block';
            JsBarcode(previewCanvas, barcode, {
                format: 'CODE128',
                width: 2,
                height: 60,
                displayValue: true
            });
        }
        
        Utils.showToast('Fill in product details to save', 'info');
    }

    /**
     * Render scanner button/icon
     */
    renderScannerButton() {
        return `
            <button onclick="barcodeScanner.showScannerModal()" class="scanner-btn" title="Scan Barcode">
                <i class="fas fa-barcode"></i>
            </button>
        `;
    }

    /**
     * Show scanner selection modal
     */
    showScannerModal() {
        const modal = document.createElement('div');
        modal.id = 'scanner-modal';
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <span class="close" onclick="document.getElementById('scanner-modal').remove(); barcodeScanner.stopCameraScanner();">&times;</span>
                <h3><i class="fas fa-barcode"></i> Barcode Scanner</h3>
                
                <div class="scanner-options" style="margin: 1rem 0;">
                    <p style="text-align: center; color: #666; margin-bottom: 1rem;">
                        <i class="fas fa-keyboard"></i> USB/Bluetooth scanners work automatically<br>
                        <small>Just scan - no need to click anything!</small>
                    </p>
                    
                    <div style="border-top: 1px solid #ddd; padding-top: 1rem;">
                        <p style="text-align: center; margin-bottom: 1rem;">Or use camera:</p>
                        <div id="scanner-video" style="width: 100%; height: 300px; background: #000; border-radius: 8px; overflow: hidden;"></div>
                        <button onclick="barcodeScanner.initCameraScanner('scanner-video')" 
                                style="width: 100%; margin-top: 1rem;" id="start-camera-btn">
                            <i class="fas fa-camera"></i> Start Camera Scanner
                        </button>
                    </div>
                </div>
                
                <div style="margin-top: 1rem;">
                    <label>Or enter barcode manually:</label>
                    <div style="display: flex; gap: 0.5rem;">
                        <input type="text" id="manual-barcode" placeholder="Enter barcode..." style="flex: 1;">
                        <button onclick="barcodeScanner.handleManualEntry()">
                            <i class="fas fa-search"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    /**
     * Handle manual barcode entry
     */
    handleManualEntry() {
        const barcode = document.getElementById('manual-barcode').value.trim();
        if (barcode) {
            document.getElementById('scanner-modal').remove();
            this.handleScan(barcode);
        } else {
            Utils.showToast('Please enter a barcode', 'warning');
        }
    }

    /**
     * Generate barcode for product
     */
    generateBarcode() {
        return Math.floor(100000000000 + Math.random() * 900000000000).toString();
    }
}

export const barcodeScanner = new BarcodeScannerService();
window.barcodeScanner = barcodeScanner;

// Initialize keyboard scanner on load
document.addEventListener('DOMContentLoaded', () => {
    barcodeScanner.initKeyboardScanner();
});
