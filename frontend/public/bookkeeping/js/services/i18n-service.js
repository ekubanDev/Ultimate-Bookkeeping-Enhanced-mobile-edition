// ==================== INTERNATIONALIZATION SERVICE ====================

/**
 * i18n Service
 * Handles multi-language support, translations, and localization
 */

import { Utils } from '../utils/utils.js';

class I18nService {
    constructor() {
        this.currentLanguage = 'en';
        this.translations = {};
        this.supportedLanguages = {
            en: { name: 'English', nativeName: 'English', flag: '🇬🇧', rtl: false },
            tw: { name: 'Twi', nativeName: 'Twi', flag: '🇬🇭', rtl: false },
            fr: { name: 'French', nativeName: 'Français', flag: '🇫🇷', rtl: false },
            ar: { name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', rtl: true },
            es: { name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', rtl: false }
        };
        this.initialized = false;
    }

    async init() {
        // Load saved language preference
        const saved = localStorage.getItem('app_language');
        if (saved && this.supportedLanguages[saved]) {
            this.currentLanguage = saved;
        } else {
            // Auto-detect browser language
            this.currentLanguage = this.detectLanguage();
        }

        // Load translations
        await this.loadTranslations(this.currentLanguage);
        
        // Apply language
        this.applyLanguage();
        
        this.initialized = true;
        console.log('✅ i18n Service initialized:', this.currentLanguage);
    }

    detectLanguage() {
        const browserLang = navigator.language.split('-')[0];
        return this.supportedLanguages[browserLang] ? browserLang : 'en';
    }

    async loadTranslations(lang) {
        try {
            // Try multiple paths for locales
            const paths = [
                `/bookkeeping/locales/${lang}.json`,
                `./locales/${lang}.json`,
                `/locales/${lang}.json`
            ];
            
            let loaded = false;
            for (const path of paths) {
                try {
                    const response = await fetch(path);
                    if (response.ok) {
                        const contentType = response.headers.get('content-type');
                        if (contentType && contentType.includes('application/json')) {
                            this.translations[lang] = await response.json();
                            console.log(`📖 Loaded translations for ${lang} from ${path}`);
                            loaded = true;
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
            
            if (!loaded) {
                console.warn(`Failed to load translations for ${lang}, using defaults`);
                // Set empty translations to prevent repeated attempts
                this.translations[lang] = {};
            }
        } catch (error) {
            console.error('Error loading translations:', error);
            this.translations[lang] = {};
        }
    }

    async setLanguage(lang) {
        if (!this.supportedLanguages[lang]) {
            console.error('Unsupported language:', lang);
            return;
        }

        // Load translations if not already loaded
        if (!this.translations[lang]) {
            await this.loadTranslations(lang);
        }

        this.currentLanguage = lang;
        localStorage.setItem('app_language', lang);
        
        this.applyLanguage();
        
        Utils.showToast(`Language changed to ${this.supportedLanguages[lang].name}`, 'success');
        
        // Reload page to apply new language (optional)
        // window.location.reload();
    }

    applyLanguage() {
        // Set document direction for RTL languages
        document.documentElement.dir = this.supportedLanguages[this.currentLanguage].rtl ? 'rtl' : 'ltr';
        document.documentElement.lang = this.currentLanguage;

        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.t(key);
            
            // Only update if we have a valid translation (not just the key)
            if (translation && translation !== key) {
                if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                    element.placeholder = translation;
                } else {
                    // Preserve icons and other HTML - only update text
                    const icon = element.querySelector('i');
                    if (icon) {
                        element.innerHTML = icon.outerHTML + ' ' + translation;
                    } else {
                        element.textContent = translation;
                    }
                }
            }
            // If no translation found, keep original content
        });

        // Update page title
        const titleKey = document.querySelector('title')?.getAttribute('data-i18n');
        if (titleKey) {
            const titleTranslation = this.t(titleKey);
            // Only update if valid translation
            if (titleTranslation && titleTranslation !== titleKey) {
                document.title = titleTranslation;
            }
        }
    }

    t(key, params = {}) {
        // Get translation for current language
        const keys = key.split('.');
        let translation = this.translations[this.currentLanguage];

        // Navigate through nested keys
        for (const k of keys) {
            if (translation && translation[k]) {
                translation = translation[k];
            } else {
                // Fallback to English
                translation = this.translations['en'];
                for (const k of keys) {
                    if (translation && translation[k]) {
                        translation = translation[k];
                    } else {
                        return key; // Return key if translation not found
                    }
                }
                break;
            }
        }

        // Replace parameters
        if (typeof translation === 'string') {
            Object.keys(params).forEach(param => {
                translation = translation.replace(`{${param}}`, params[param]);
            });
        }

        return translation || key;
    }

    // Formatting utilities

    formatCurrency(amount) {
        const locales = {
            en: 'en-US',
            tw: 'ak-GH',
            fr: 'fr-FR',
            ar: 'ar-SA',
            es: 'es-ES'
        };

        const currencies = {
            en: 'GHS',
            tw: 'GHS',
            fr: 'EUR',
            ar: 'SAR',
            es: 'EUR'
        };

        return new Intl.NumberFormat(locales[this.currentLanguage] || 'en-US', {
            style: 'currency',
            currency: currencies[this.currentLanguage] || 'GHS'
        }).format(amount);
    }

    formatDate(date) {
        const locales = {
            en: 'en-US',
            tw: 'ak-GH',
            fr: 'fr-FR',
            ar: 'ar-SA',
            es: 'es-ES'
        };

        return new Intl.DateTimeFormat(locales[this.currentLanguage] || 'en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }).format(new Date(date));
    }

    formatNumber(number) {
        const locales = {
            en: 'en-US',
            tw: 'ak-GH',
            fr: 'fr-FR',
            ar: 'ar-SA',
            es: 'es-ES'
        };

        return new Intl.NumberFormat(locales[this.currentLanguage] || 'en-US').format(number);
    }

    getSupportedLanguages() {
        return Object.entries(this.supportedLanguages).map(([code, info]) => ({
            code,
            ...info
        }));
    }

    getCurrentLanguage() {
        return this.currentLanguage;
    }

    getCurrentLanguageInfo() {
        return this.supportedLanguages[this.currentLanguage];
    }
}

// Create and export singleton
export const i18nService = new I18nService();

// Export translate function for convenience
export const t = (key, params) => i18nService.t(key, params);
