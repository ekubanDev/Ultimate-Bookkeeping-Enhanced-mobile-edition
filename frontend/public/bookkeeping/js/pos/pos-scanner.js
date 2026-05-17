// ==================== POS SCANNER (QuaggaJS - same as dashboard/sales) ====================
import { state } from '../utils/state.js';
import { POSUI } from './pos-ui.js';
import { POSProducts } from './pos-products.js';
import { POSData } from './pos-data.js';
import { nativeFeatures } from '../services/native-features.js';

const QUAGGA_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js';

export const POSScanner = {
    scanning: false,
    _detectedHandler: null,

    async init() {
        console.log('Initializing barcode scanner (QuaggaJS)...');

        // Setup manual barcode input
        const barcodeInput = document.getElementById('barcode-scan');
        if (barcodeInput) {
            barcodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                    const barcode = e.target.value.trim();
                    console.log('Manual barcode entered:', barcode);
                    this.onBarcodeDetected(barcode);
                    e.target.value = '';
                }
            });
            console.log('✅ Manual barcode input configured');
        }

        // Setup camera scanner button
        const scannerBtn = document.getElementById('open-scanner-btn');
        if (scannerBtn) {
            scannerBtn.addEventListener('click', () => {
                console.log('Camera scanner button clicked');
                this.openCamera();
            });
            console.log('✅ Camera scanner button configured');
        }
        console.log('✅ POS Scanner initialized');
    },

    loadQuaggaJS() {
        if (window.Quagga) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = QUAGGA_SCRIPT;
            script.onload = () => {
                console.log('✅ QuaggaJS loaded');
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load QuaggaJS'));
            document.head.appendChild(script);
        });
    },

    async openCamera() {
        console.log('Opening camera scanner (QuaggaJS)...');

        // Native app: prefer Capacitor scanner plugin over browser camera APIs.
        if (nativeFeatures?.isNative) {
            try {
                const code = await nativeFeatures.scanBarcode();
                if (code) {
                    this.onBarcodeDetected(code);
                } else {
                    this.focusManualInput('Scanner unavailable. Enable camera permission in Settings, then retry.');
                }
            } catch (err) {
                console.error('Native barcode scanner failed:', err);
                this.focusManualInput('Camera permission denied/unavailable. Check app Settings and use manual barcode input.');
            }
            return;
        }

        const container = document.getElementById('scanner-container');
        const viewport = document.getElementById('scanner-viewport');

        if (!container || !viewport) {
            console.error('Scanner DOM elements not found (need #scanner-container and #scanner-viewport)');
            POSUI.showNotification('Scanner UI not available', 'error');
            return;
        }

        try {
            await this.loadQuaggaJS();
        } catch (err) {
            console.error('QuaggaJS load error:', err);
            POSUI.showNotification('Scanner library failed to load', 'error');
            return;
        }

        // Preflight on mobile Safari/WebKit: prompt permission before Quagga init.
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            this.focusManualInput('Camera unavailable on this device. Use manual barcode input.');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false
            });
            stream.getTracks().forEach((t) => t.stop());
        } catch (err) {
            console.error('Camera preflight denied/unavailable:', err);
            this.focusManualInput('Camera permission denied/unavailable. Use manual barcode input.');
            return;
        }

        container.classList.add('active');
        this.scanning = true;

        const Quagga = window.Quagga;
        Quagga.init({
            inputStream: {
                name: 'Live',
                type: 'LiveStream',
                target: viewport,
                constraints: { facingMode: 'environment' }
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
                this.focusManualInput('Camera access denied/unavailable. Use manual barcode input.');
                this.closeCamera();
                return;
            }
            Quagga.start();
        });

        if (this._detectedHandler) {
            try { Quagga.offDetected(this._detectedHandler); } catch (_) { /* no-op */ }
        }
        this._detectedHandler = (result) => {
            const code = result?.codeResult?.code;
            if (code) {
                if (navigator.vibrate) navigator.vibrate(100);
                this.onBarcodeDetected(code);
                this.closeCamera();
            }
        };
        Quagga.onDetected(this._detectedHandler);

        const closeBtn = document.getElementById('close-scanner');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeCamera();
        }
    },

    closeCamera() {
        console.log('Closing camera scanner...');
        if (window.Quagga && this.scanning) {
            try {
                if (this._detectedHandler && typeof window.Quagga.offDetected === 'function') {
                    window.Quagga.offDetected(this._detectedHandler);
                }
                window.Quagga.stop();
            } catch (e) {
                console.error('Error stopping Quagga:', e);
            }
            this.scanning = false;
        }
        const container = document.getElementById('scanner-container');
        if (container) container.classList.remove('active');
    },

    focusManualInput(message) {
        POSUI.showNotification(message, 'error');
        const barcodeInput = document.getElementById('barcode-scan');
        if (barcodeInput) {
            setTimeout(() => {
                barcodeInput.focus();
                barcodeInput.select?.();
            }, 50);
        }
    },

    onBarcodeDetected(barcode) {
        const cleanBarcode = String(barcode).trim();
        console.log('Processing barcode:', cleanBarcode);

        const product = POSData.findProductByBarcode(cleanBarcode);

        if (product) {
            console.log('✅ Product found:', product.name);
            POSUI.showNotification(`Found: ${product.name}`, 'success');
            if (POSProducts && POSProducts.promptForQuantity) {
                POSProducts.promptForQuantity(product.id);
            } else {
                console.error('POSProducts.promptForQuantity not available');
            }
        } else {
            console.warn('Product not found for barcode:', cleanBarcode);
            if (state.products) {
                const allBarcodes = state.products
                    .filter(p => p.barcode)
                    .map(p => `${p.name}: "${p.barcode}"`)
                    .join(', ');
                console.log('Available barcodes:', allBarcodes);
            }
            POSUI.showNotification(`Product not found: ${cleanBarcode}`, 'error');
        }
    }
};
