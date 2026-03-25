// ==================== POS SCANNER (QuaggaJS - same as dashboard/sales) ====================
import { state } from '../utils/state.js';
import { POSUI } from './pos-ui.js';
import { POSProducts } from './pos-products.js';
import { POSData } from './pos-data.js';

const QUAGGA_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js';

export const POSScanner = {
    scanning: false,

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
                POSUI.showNotification('Camera access denied or unavailable', 'error');
                this.closeCamera();
                return;
            }
            Quagga.start();
        });

        Quagga.onDetected((result) => {
            const code = result?.codeResult?.code;
            if (code) {
                if (navigator.vibrate) navigator.vibrate(100);
                this.onBarcodeDetected(code);
                this.closeCamera();
            }
        });

        const closeBtn = document.getElementById('close-scanner');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeCamera();
        }
    },

    closeCamera() {
        console.log('Closing camera scanner...');
        if (window.Quagga && this.scanning) {
            try {
                window.Quagga.stop();
            } catch (e) {
                console.error('Error stopping Quagga:', e);
            }
            this.scanning = false;
        }
        const container = document.getElementById('scanner-container');
        if (container) container.classList.remove('active');
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
