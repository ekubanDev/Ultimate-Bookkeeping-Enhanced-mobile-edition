// ==================== ENHANCED EMAIL SERVICE ====================

/**
 * Email Service
 * Handles automated email notifications, templates, and delivery
 */

import { CONFIG } from '../config/firebase.js';
import { Utils } from '../utils/utils.js';
import { emailTemplates } from '../config/email-templates.js';

class EmailService {
    constructor() {
        this.initialized = false;
        this.emailJS = null;
        this.settings = {
            serviceId: CONFIG.emailJS?.serviceId || 'default_service',
            templateId: CONFIG.emailJS?.templateId || 'default_template',
            publicKey: CONFIG.emailJS?.publicKey || '',
            fromName: 'Ultimate Bookkeeping',
            fromEmail: 'noreply@bookkeeping.app'
        };
    }

    async init() {
        if (this.initialized) return;
        
        // EmailJS is already initialized in app.js
        if (window.emailjs) {
            this.emailJS = window.emailjs;
            this.initialized = true;
            console.log('✅ Email Service initialized');
        } else {
            console.warn('⚠️ EmailJS not loaded');
        }
    }

    // ==================== SEND METHODS ====================

    async sendEmail(to, subject, htmlBody, plainText = '') {
        if (!this.initialized) {
            await this.init();
        }

        if (!this.emailJS) {
            console.error('EmailJS not initialized');
            return { success: false, error: 'Email service not available' };
        }

        try {
            const templateParams = {
                to_email: to,
                from_name: this.settings.fromName,
                subject: subject,
                html_body: htmlBody,
                plain_text: plainText || this.stripHtml(htmlBody),
                reply_to: this.settings.fromEmail
            };

            const response = await this.emailJS.send(
                this.settings.serviceId,
                this.settings.templateId,
                templateParams
            );

            console.log('✅ Email sent successfully:', response);
            return { success: true, response };
        } catch (error) {
            console.error('❌ Email send failed:', error);
            return { success: false, error: error.text || error.message };
        }
    }

    // ==================== AUTOMATED NOTIFICATIONS ====================

    async sendLowStockAlert(product, recipients) {
        const subject = `⚠️ Low Stock Alert: ${product.name}`;
        const html = emailTemplates.lowStockAlert(product);
        
        const results = [];
        for (const email of recipients) {
            const result = await this.sendEmail(email, subject, html);
            results.push({ email, ...result });
        }
        
        return results;
    }

    async sendSaleConfirmation(sale, customerEmail) {
        const subject = `✅ Purchase Confirmation #${sale.id}`;
        const html = emailTemplates.saleConfirmation(sale);
        
        return await this.sendEmail(customerEmail, subject, html);
    }

    async sendInvoice(invoice, customerEmail) {
        const subject = `📄 Invoice #${invoice.invoiceNumber}`;
        const html = emailTemplates.invoice(invoice);
        
        return await this.sendEmail(customerEmail, subject, html);
    }

    async sendDailySummary(summary, adminEmail) {
        const subject = `📊 Daily Business Summary - ${Utils.formatDate(new Date())}`;
        const html = emailTemplates.dailySummary(summary);
        
        return await this.sendEmail(adminEmail, subject, html);
    }

    async sendWeeklySummary(summary, adminEmail) {
        const subject = `📈 Weekly Business Report`;
        const html = emailTemplates.weeklySummary(summary);
        
        return await this.sendEmail(adminEmail, subject, html);
    }

    async sendSettlementNotification(settlement, managerEmail) {
        const subject = `💰 Settlement Statement #${settlement.settlementNumber}`;
        const html = emailTemplates.settlement(settlement);
        
        return await this.sendEmail(managerEmail, subject, html);
    }

    async sendExpenseApprovalRequest(expense, approverEmail) {
        const subject = `📝 Expense Approval Required: ${expense.description}`;
        const html = emailTemplates.expenseApproval(expense);
        
        return await this.sendEmail(approverEmail, subject, html);
    }

    async sendConsignmentConfirmation(consignment, outletEmail) {
        const subject = `📦 Consignment Delivery #${consignment.id}`;
        const html = emailTemplates.consignmentConfirmation(consignment);
        
        return await this.sendEmail(outletEmail, subject, html);
    }

    async sendCustomerWelcome(customer) {
        const subject = `Welcome to ${this.settings.fromName}! 🎉`;
        const html = emailTemplates.customerWelcome(customer);
        
        return await this.sendEmail(customer.email, subject, html);
    }

    // ==================== SCHEDULED REPORTS ====================

    scheduleDaily(time, callback) {
        // Schedule daily report at specific time (e.g., "09:00")
        const [hours, minutes] = time.split(':');
        
        const scheduleNext = () => {
            const now = new Date();
            const scheduled = new Date();
            scheduled.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            
            if (scheduled <= now) {
                scheduled.setDate(scheduled.getDate() + 1);
            }
            
            const delay = scheduled.getTime() - now.getTime();
            
            setTimeout(() => {
                callback();
                scheduleNext(); // Schedule next occurrence
            }, delay);
            
            console.log(`📅 Daily report scheduled for ${scheduled.toLocaleString()}`);
        };
        
        scheduleNext();
    }

    scheduleWeekly(dayOfWeek, time, callback) {
        // Schedule weekly report (0 = Sunday, 1 = Monday, etc.)
        const [hours, minutes] = time.split(':');
        
        const scheduleNext = () => {
            const now = new Date();
            const scheduled = new Date();
            scheduled.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            
            const currentDay = scheduled.getDay();
            const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
            
            if (daysUntilTarget === 0 && scheduled <= now) {
                scheduled.setDate(scheduled.getDate() + 7);
            } else {
                scheduled.setDate(scheduled.getDate() + daysUntilTarget);
            }
            
            const delay = scheduled.getTime() - now.getTime();
            
            setTimeout(() => {
                callback();
                scheduleNext(); // Schedule next occurrence
            }, delay);
            
            console.log(`📅 Weekly report scheduled for ${scheduled.toLocaleString()}`);
        };
        
        scheduleNext();
    }

    // ==================== BULK OPERATIONS ====================

    async sendBulkEmails(recipients, subject, htmlBody) {
        const results = [];
        const batchSize = 5; // Send in batches to avoid rate limits
        
        for (let i = 0; i < recipients.length; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);
            
            const batchResults = await Promise.all(
                batch.map(email => this.sendEmail(email, subject, htmlBody))
            );
            
            results.push(...batchResults);
            
            // Wait between batches
            if (i + batchSize < recipients.length) {
                await this.delay(2000);
            }
        }
        
        return results;
    }

    // ==================== HELPERS ====================

    stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    validateEmail(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    }

    // ==================== PREFERENCES ====================

    async saveUserPreferences(userId, preferences) {
        // Save to localStorage for now
        // In production, save to Firebase
        const key = `email_prefs_${userId}`;
        localStorage.setItem(key, JSON.stringify(preferences));
    }

    async getUserPreferences(userId) {
        const key = `email_prefs_${userId}`;
        const stored = localStorage.getItem(key);
        
        if (stored) {
            return JSON.parse(stored);
        }
        
        // Default preferences
        return {
            lowStockAlerts: true,
            dailySummary: true,
            weeklySummary: true,
            saleConfirmations: true,
            settlementNotifications: true,
            expenseApprovals: true
        };
    }

    async unsubscribe(userId, notificationType) {
        const prefs = await this.getUserPreferences(userId);
        prefs[notificationType] = false;
        await this.saveUserPreferences(userId, prefs);
    }

    // ==================== TESTING ====================

    async sendTestEmail(toEmail) {
        const subject = 'Test Email from Bookkeeping App';
        const html = `
            <h2>Test Email</h2>
            <p>This is a test email from your bookkeeping application.</p>
            <p>If you received this, email notifications are working correctly! ✅</p>
            <p><small>Sent at: ${new Date().toLocaleString()}</small></p>
        `;
        
        return await this.sendEmail(toEmail, subject, html);
    }
}

// Create and export singleton
export const emailService = new EmailService();
