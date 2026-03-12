// ==================== NATIVE FEATURES SERVICE ====================

/**
 * Native Features Service
 * Integrates Capacitor native features (Camera, Haptics, Share, etc.)
 * Provides fallbacks for web platform
 */

import { Utils } from '../utils/utils.js';

class NativeFeatures {
    constructor() {
        this.isNative = this.checkIfNative();
        this.plugins = {};
        this.init();
    }

    async init() {
        if (!this.isNative) {
            console.log('📱 Running in web mode - native features disabled');
            return;
        }

        try {
            // Dynamically import Capacitor plugins
            const { Camera } = await import('@capacitor/camera');
            const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
            const { Toast } = await import('@capacitor/toast');
            const { Share } = await import('@capacitor/share');
            const { Network } = await import('@capacitor/network');
            const { App } = await import('@capacitor/app');
            const { StatusBar } = await import('@capacitor/status-bar');
            const { SplashScreen } = await import('@capacitor/splash-screen');
            
            this.plugins = {
                Camera,
                Haptics,
                ImpactStyle,
                Toast,
                Share,
                Network,
                App,
                StatusBar,
                SplashScreen
            };

            // Try to import barcode scanner (optional)
            try {
                const { BarcodeScanner } = await import('@capacitor-community/barcode-scanner');
                this.plugins.BarcodeScanner = BarcodeScanner;
            } catch (e) {
                console.log('Barcode scanner plugin not available');
            }

            console.log('✅ Native features initialized');
            
            // Hide splash screen after app loads
            await this.hideSplashScreen();
            
        } catch (error) {
            console.error('Failed to initialize native features:', error);
            this.isNative = false;
        }
    }

    checkIfNative() {
        return typeof window !== 'undefined' && 
               window.Capacitor?.isNativePlatform?.() === true;
    }

    getPlatform() {
        if (!this.isNative) return 'web';
        return window.Capacitor?.getPlatform() || 'web';
    }

    // ==================== SPLASH SCREEN ====================

    async hideSplashScreen() {
        if (!this.isNative || !this.plugins.SplashScreen) return;
        
        try {
            await this.plugins.SplashScreen.hide();
        } catch (error) {
            console.error('Error hiding splash screen:', error);
        }
    }

    // ==================== BARCODE SCANNING ====================

    async scanBarcode() {
        if (!this.isNative || !this.plugins.BarcodeScanner) {
            Utils.showToast('Barcode scanning only works in native app', 'warning');
            return null;
        }

        try {
            // Check camera permission
            const status = await this.plugins.BarcodeScanner.checkPermission({ force: true });
            
            if (!status.granted) {
                Utils.showToast('Camera permission required for scanning', 'error');
                return null;
            }

            // Prepare scanner (hide app content)
            await this.plugins.BarcodeScanner.prepare();
            document.body.classList.add('scanner-active');
            
            // Start scanning
            const result = await this.plugins.BarcodeScanner.startScan();
            
            // Stop scanner and show app content
            await this.plugins.BarcodeScanner.stopScan();
            document.body.classList.remove('scanner-active');
            
            if (result.hasContent) {
                await this.hapticFeedback('medium');
                return result.content;
            }
            
            return null;
        } catch (error) {
            console.error('Barcode scan error:', error);
            document.body.classList.remove('scanner-active');
            Utils.showToast('Barcode scanning failed', 'error');
            return null;
        }
    }

    // ==================== CAMERA ====================

    async takePicture(options = {}) {
        if (!this.isNative || !this.plugins.Camera) {
            Utils.showToast('Camera only works in native app', 'warning');
            return null;
        }

        try {
            const image = await this.plugins.Camera.getPhoto({
                quality: options.quality || 90,
                allowEditing: options.allowEditing || false,
                resultType: options.resultType || 'uri',
                source: options.source || 'prompt', // 'prompt', 'camera', 'photos'
                width: options.width,
                height: options.height
            });
            
            await this.hapticFeedback('light');
            return image.webPath || image.dataUrl;
        } catch (error) {
            if (error.message !== 'User cancelled photos app') {
                console.error('Camera error:', error);
                Utils.showToast('Failed to capture photo', 'error');
            }
            return null;
        }
    }

    async pickImage() {
        return await this.takePicture({ source: 'photos' });
    }

    async capturePhoto() {
        return await this.takePicture({ source: 'camera' });
    }

    // ==================== HAPTIC FEEDBACK ====================

    async hapticFeedback(style = 'medium') {
        if (!this.isNative || !this.plugins.Haptics) return;
        
        try {
            const styleMap = {
                light: this.plugins.ImpactStyle.Light,
                medium: this.plugins.ImpactStyle.Medium,
                heavy: this.plugins.ImpactStyle.Heavy
            };
            
            await this.plugins.Haptics.impact({ 
                style: styleMap[style] || this.plugins.ImpactStyle.Medium 
            });
        } catch (error) {
            console.error('Haptic error:', error);
        }
    }

    async vibrate(duration = 100) {
        if (!this.isNative || !this.plugins.Haptics) return;
        
        try {
            await this.plugins.Haptics.vibrate({ duration });
        } catch (error) {
            console.error('Vibrate error:', error);
        }
    }

    async hapticSuccess() {
        if (!this.isNative || !this.plugins.Haptics) return;
        
        try {
            await this.plugins.Haptics.notification({ 
                type: 'SUCCESS' 
            });
        } catch (error) {
            console.error('Haptic success error:', error);
        }
    }

    async hapticWarning() {
        if (!this.isNative || !this.plugins.Haptics) return;
        
        try {
            await this.plugins.Haptics.notification({ 
                type: 'WARNING' 
            });
        } catch (error) {
            console.error('Haptic warning error:', error);
        }
    }

    async hapticError() {
        if (!this.isNative || !this.plugins.Haptics) return;
        
        try {
            await this.plugins.Haptics.notification({ 
                type: 'ERROR' 
            });
        } catch (error) {
            console.error('Haptic error notification error:', error);
        }
    }

    // ==================== TOAST NOTIFICATIONS ====================

    async showToast(message, duration = 'short', position = 'bottom') {
        if (!this.isNative || !this.plugins.Toast) {
            // Fallback to web toast
            Utils.showToast(message, 'info');
            return;
        }

        try {
            await this.plugins.Toast.show({
                text: message,
                duration: duration === 'long' ? 'long' : 'short',
                position: position
            });
        } catch (error) {
            console.error('Toast error:', error);
            Utils.showToast(message, 'info');
        }
    }

    // ==================== SHARING ====================

    async share(options) {
        if (!this.isNative || !this.plugins.Share) {
            // Web fallback - copy to clipboard or open email
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: options.title,
                        text: options.text,
                        url: options.url
                    });
                    return;
                } catch (error) {
                    console.error('Web share error:', error);
                }
            }
            Utils.showToast('Sharing only works in native app', 'warning');
            return;
        }

        try {
            await this.plugins.Share.share({
                title: options.title || 'Share',
                text: options.text || '',
                url: options.url || '',
                dialogTitle: options.dialogTitle || 'Share via'
            });
            
            await this.hapticFeedback('light');
        } catch (error) {
            if (error.message !== 'Share canceled') {
                console.error('Share error:', error);
                Utils.showToast('Failed to share', 'error');
            }
        }
    }

    async shareInvoice(invoiceData) {
        await this.share({
            title: `Invoice #${invoiceData.number}`,
            text: `Invoice for ${invoiceData.customer} - ${invoiceData.amount}`,
            url: invoiceData.url || '',
            dialogTitle: 'Share Invoice'
        });
    }

    async shareReport(reportData) {
        await this.share({
            title: reportData.title || 'Business Report',
            text: reportData.summary || '',
            url: reportData.url || '',
            dialogTitle: 'Share Report'
        });
    }

    // ==================== NETWORK ====================

    async checkNetworkStatus() {
        if (!this.isNative || !this.plugins.Network) {
            return { 
                connected: navigator.onLine,
                connectionType: 'unknown'
            };
        }

        try {
            const status = await this.plugins.Network.getStatus();
            return status;
        } catch (error) {
            console.error('Network check error:', error);
            return { 
                connected: navigator.onLine,
                connectionType: 'unknown'
            };
        }
    }

    async listenToNetworkChanges(callback) {
        if (!this.isNative || !this.plugins.Network) {
            // Web fallback
            window.addEventListener('online', () => callback({ connected: true }));
            window.addEventListener('offline', () => callback({ connected: false }));
            return;
        }

        try {
            await this.plugins.Network.addListener('networkStatusChange', callback);
        } catch (error) {
            console.error('Network listener error:', error);
        }
    }

    // ==================== STATUS BAR ====================

    async setStatusBarColor(color) {
        if (!this.isNative || !this.plugins.StatusBar) return;
        
        try {
            await this.plugins.StatusBar.setBackgroundColor({ color });
        } catch (error) {
            console.error('Status bar color error:', error);
        }
    }

    async hideStatusBar() {
        if (!this.isNative || !this.plugins.StatusBar) return;
        
        try {
            await this.plugins.StatusBar.hide();
        } catch (error) {
            console.error('Status bar hide error:', error);
        }
    }

    async showStatusBar() {
        if (!this.isNative || !this.plugins.StatusBar) return;
        
        try {
            await this.plugins.StatusBar.show();
        } catch (error) {
            console.error('Status bar show error:', error);
        }
    }

    // ==================== APP LIFECYCLE ====================

    async addAppStateListener(callback) {
        if (!this.isNative || !this.plugins.App) return;
        
        try {
            await this.plugins.App.addListener('appStateChange', callback);
        } catch (error) {
            console.error('App state listener error:', error);
        }
    }

    async addBackButtonListener(callback) {
        if (!this.isNative || !this.plugins.App) return;
        
        try {
            await this.plugins.App.addListener('backButton', callback);
        } catch (error) {
            console.error('Back button listener error:', error);
        }
    }

    async exitApp() {
        if (!this.isNative || !this.plugins.App) return;
        
        try {
            await this.plugins.App.exitApp();
        } catch (error) {
            console.error('Exit app error:', error);
        }
    }

    // ==================== UTILITY METHODS ====================

    async getDeviceInfo() {
        if (!this.isNative) {
            return {
                platform: 'web',
                model: navigator.userAgent,
                osVersion: 'unknown',
                manufacturer: 'unknown'
            };
        }

        try {
            const { Device } = await import('@capacitor/device');
            const info = await Device.getInfo();
            return info;
        } catch (error) {
            console.error('Device info error:', error);
            return {
                platform: this.getPlatform(),
                model: 'unknown',
                osVersion: 'unknown',
                manufacturer: 'unknown'
            };
        }
    }

    // ==================== INTEGRATION HELPERS ====================

    // Call this when user completes an action successfully
    async onSuccess(message) {
        await this.hapticSuccess();
        if (message) {
            await this.showToast(message, 'short');
        }
    }

    // Call this when user encounters an error
    async onError(message) {
        await this.hapticError();
        if (message) {
            await this.showToast(message, 'long');
        }
    }

    // Call this for warnings
    async onWarning(message) {
        await this.hapticWarning();
        if (message) {
            await this.showToast(message, 'short');
        }
    }

    // Call this for button clicks
    async onButtonClick() {
        await this.hapticFeedback('light');
    }

    // Call this for important actions
    async onImportantAction() {
        await this.hapticFeedback('heavy');
    }
}

// Create and export singleton
export const nativeFeatures = new NativeFeatures();
