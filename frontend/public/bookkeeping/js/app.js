// ==================== MAIN APPLICATION ENTRY POINT ====================

/**
 * Firebase Bookkeeping Application
 * Main initialization file - imports and connects all modules
 * ENHANCED VERSION with PWA, i18n, Email, Export features
 */

// Import Firebase configuration and services
import { auth, onAuthStateChanged, CONFIG } from './config/firebase.js';
import { state } from './utils/state.js';
import { Utils } from './utils/utils.js';

// Initialize EmailJS
emailjs.init(CONFIG.emailJS.publicKey);

// Import services
import { firebaseService } from './services/firebase-service.js';
import { dataLoader } from './services/data-loader.js';
import ActivityLogger from './services/activity-logger.js';
import { AppController } from './controllers/app-controller.js';

// Import enhancement services
import { offlineSyncService } from './services/offline-sync.js';
import { emailService } from './services/email-service.js';
import { exportService } from './services/export-service.js';
import { i18nService } from './services/i18n-service.js';

// Import Priority 1, 2, 3 enhancement services
import { stockAlerts } from './services/stock-alerts.js';
import { formValidator } from './services/form-validator.js';
import { profitAnalysis } from './services/profit-analysis.js';
import { customerCredit } from './services/customer-credit.js';
import { salesReturns } from './services/sales-returns.js';
import { recurringExpenses } from './services/recurring-expenses.js';
import { stockTransfer } from './services/stock-transfer.js';
import { pdfExport } from './services/pdf-export.js';
import { barcodeScanner } from './services/barcode-scanner.js';

// Import Enhanced Dashboard
import { EnhancedDashboard } from './services/enhanced-dashboard.js';

// Import AI Chat
import aiChatService from './services/ai-chat.js';
import { metricsService } from './services/metrics-service.js';

// ==================== PRODUCTION LOG SUPPRESSION ====================
// Silence console.log and console.debug in production to prevent leaking
// sensitive business data (sale totals, PO details, user IDs) via DevTools.
// console.error and console.warn are preserved for critical runtime signals.
(function suppressLogsInProduction() {
    const isLocal = window.location.hostname === 'localhost'
        || window.location.hostname === '127.0.0.1'
        || window.location.hostname.startsWith('192.168.');
    if (!isLocal) {
        console.log   = () => {};
        console.debug = () => {};
        console.info  = () => {};
    }
})();

// ==================== GLOBAL ERROR HANDLERS ====================
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    metricsService.emit('runtime_error', {
        surface: 'frontend',
        section: window.appController?._currentSection || 'other',
        error_name: event.error?.name || 'Error',
        error_message: event.error?.message || String(event.message || ''),
        stack_hash: (event.error?.stack || '').slice(0, 240)
    });
    Utils.showToast('An unexpected error occurred', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    metricsService.emit('runtime_error', {
        surface: 'frontend',
        section: window.appController?._currentSection || 'other',
        error_name: 'UnhandledPromiseRejection',
        error_message: String(event.reason?.message || event.reason || ''),
        stack_hash: String(event.reason?.stack || '').slice(0, 240)
    });
    Utils.showToast('An unexpected error occurred', 'error');
});

// ==================== PWA INSTALLATION PROMPT ====================
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    // Show install button/banner
    const installBanner = document.createElement('div');
    installBanner.id = 'pwa-install-banner';
    installBanner.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #007bff;
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 15px;
        animation: slideUp 0.3s ease-out;
    `;
    
    installBanner.innerHTML = `
        <i class="fas fa-mobile-alt" style="font-size: 24px;"></i>
        <div>
            <strong>Install App</strong>
            <p style="margin: 0; font-size: 12px;">Install for offline access</p>
        </div>
        <button id="pwa-install-btn" style="background: white; color: #007bff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">
            Install
        </button>
        <button id="pwa-dismiss-btn" style="background: transparent; color: white; border: 1px solid white; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
            Later
        </button>
    `;
    
    document.body.appendChild(installBanner);
    
    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
        installBanner.style.display = 'none';
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`PWA install outcome: ${outcome}`);
        deferredPrompt = null;
    });
    
    document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
        installBanner.style.display = 'none';
    });
});

// ==================== APPLICATION INITIALIZATION ====================
console.log('🚀 Initializing Firebase Bookkeeping Application (Enhanced)...');

async function initializeApp() {
    try {
        // Initialize i18n first (for translations)
        await i18nService.init();
        console.log('✅ i18n initialized');
        
        // Initialize offline sync
        await offlineSyncService.init();
        console.log('✅ Offline sync initialized');
        
        // Initialize email service
        await emailService.init();
        console.log('✅ Email service initialized');
        
        // Initialize services globally before AppController
        window.stockAlerts = stockAlerts;
        window.formValidator = formValidator;
        window.profitAnalysis = profitAnalysis;
        window.customerCredit = customerCredit;
        window.salesReturns = salesReturns;
        window.recurringExpenses = recurringExpenses;
        window.stockTransfer = stockTransfer;
        window.pdfExport = pdfExport;
        window.barcodeScanner = barcodeScanner;
        window.metricsService = metricsService;

        const app = new AppController();
        window.appController = app;
        window.exportService = exportService;
        window.emailService = emailService;
        window.i18nService = i18nService;
        window.offlineSyncService = offlineSyncService;

        // Defer heavy / non-critical init until after first paint
        let heavyInitDone = false;
        const deferHeavyInit = () => {
            if (heavyInitDone) return;
            heavyInitDone = true;
            window.enhancedDashboard = new EnhancedDashboard();
            console.log('✅ Enhanced Dashboard initialized');
            // Only trigger a dashboard refresh if auth + data are already loaded.
            // If auth hasn't completed yet, the auth observer will call showSection('dashboard')
            // after loadAll() finishes — no need to pre-fire a refresh into empty state.
            if (window.appController && state.authInitialized && state.currentUser) {
                window.appController.markSectionDirty('dashboard');
                window.appController._refreshCurrentSectionIfDirty();
            }
            barcodeScanner.initKeyboardScanner();
            aiChatService.init(state);
            window.aiChatService = aiChatService;
            console.log('✅ AI Chat initialized');
        };
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(deferHeavyInit, { timeout: 2500 });
        } else {
            setTimeout(deferHeavyInit, 800);
        }
        
        // Check for recurring expenses after auth is ready
        setTimeout(() => {
            if (state.authInitialized && state.currentUser) {
                recurringExpenses.generateDueExpenses();
            }
        }, 5000);
        
        // Setup language selector
        const languageSelect = document.getElementById('language-select');
        if (languageSelect) {
            languageSelect.value = i18nService.getCurrentLanguage();
            languageSelect.addEventListener('change', async (e) => {
                await i18nService.setLanguage(e.target.value);
                // Optionally reload to apply all translations
                // window.location.reload();
            });
        }
        
        console.log('✅ Application initialized successfully!');
        
    } catch (error) {
        console.error('❌ Application initialization failed:', error);
        Utils.showToast('Failed to initialize application', 'error');
    }
}

// Start initialization
initializeApp();

