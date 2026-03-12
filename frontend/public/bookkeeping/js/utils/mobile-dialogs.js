// ==================== MOBILE-FRIENDLY DIALOGS ====================
// Replaces native alert(), prompt(), confirm() with custom modals
// Works perfectly in Capacitor mobile apps

export class MobileDialogs {
    
    /**
     * Show a custom prompt dialog (replaces window.prompt)
     * @param {string} message - The prompt message
     * @param {string} defaultValue - Default input value
     * @param {string} inputType - Input type (text, number, date, etc.)
     * @returns {Promise<string|null>} - User input or null if cancelled
     */
    static async prompt(message, defaultValue = '', inputType = 'text') {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'mobile-dialog-overlay';
            modal.innerHTML = `
                <div class="mobile-dialog prompt-dialog">
                    <div class="dialog-content">
                        <h3 class="dialog-title">${message}</h3>
                        <input 
                            type="${inputType}" 
                            class="dialog-input" 
                            value="${defaultValue}"
                            placeholder="${defaultValue}"
                        />
                        <div class="dialog-buttons">
                            <button class="dialog-btn cancel-btn">Cancel</button>
                            <button class="dialog-btn ok-btn">OK</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            const input = modal.querySelector('.dialog-input');
            const okBtn = modal.querySelector('.ok-btn');
            const cancelBtn = modal.querySelector('.cancel-btn');
            
            // Focus and select input
            setTimeout(() => {
                input.focus();
                if (inputType === 'text') {
                    input.select();
                }
            }, 100);
            
            // Handle Enter key
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    okBtn.click();
                }
            });
            
            okBtn.addEventListener('click', () => {
                const value = input.value.trim();
                modal.remove();
                resolve(value || null);
            });
            
            cancelBtn.addEventListener('click', () => {
                modal.remove();
                resolve(null);
            });
            
            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve(null);
                }
            });
        });
    }
    
    /**
     * Show a custom confirm dialog (replaces window.confirm)
     * @param {string} message - The confirmation message
     * @param {string} confirmText - Text for confirm button (default: 'Confirm')
     * @param {string} cancelText - Text for cancel button (default: 'Cancel')
     * @returns {Promise<boolean>} - true if confirmed, false if cancelled
     */
    static async confirm(message, confirmText = 'Confirm', cancelText = 'Cancel') {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'mobile-dialog-overlay';
            modal.innerHTML = `
                <div class="mobile-dialog confirm-dialog">
                    <div class="dialog-content">
                        <div class="dialog-icon">⚠️</div>
                        <p class="dialog-message">${message}</p>
                        <div class="dialog-buttons">
                            <button class="dialog-btn cancel-btn">${cancelText}</button>
                            <button class="dialog-btn confirm-btn">${confirmText}</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            const confirmBtn = modal.querySelector('.confirm-btn');
            const cancelBtn = modal.querySelector('.cancel-btn');
            
            confirmBtn.addEventListener('click', () => {
                modal.remove();
                resolve(true);
            });
            
            cancelBtn.addEventListener('click', () => {
                modal.remove();
                resolve(false);
            });
            
            // Close on backdrop click (counts as cancel)
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve(false);
                }
            });
        });
    }
    
    /**
     * Show an alert (uses existing toast system)
     * @param {string} message - The alert message
     * @param {string} type - Type: 'success', 'error', 'warning', 'info'
     */
    static alert(message, type = 'info') {
        // Use the existing Utils.showToast if available
        if (typeof Utils !== 'undefined' && Utils.showToast) {
            Utils.showToast(message, type);
        } else {
            // Fallback to native alert
            alert(message);
        }
    }
    
    /**
     * Show a custom alert dialog with OK button
     * @param {string} message - The alert message
     * @param {string} title - Dialog title (optional)
     * @returns {Promise<void>}
     */
    static async alertDialog(message, title = 'Alert') {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'mobile-dialog-overlay';
            modal.innerHTML = `
                <div class="mobile-dialog alert-dialog">
                    <div class="dialog-content">
                        <h3 class="dialog-title">${title}</h3>
                        <p class="dialog-message">${message}</p>
                        <div class="dialog-buttons">
                            <button class="dialog-btn ok-btn">OK</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            const okBtn = modal.querySelector('.ok-btn');
            
            okBtn.addEventListener('click', () => {
                modal.remove();
                resolve();
            });
            
            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve();
                }
            });
        });
    }
    
    /**
     * Check if running in Capacitor (mobile app)
     * @returns {boolean}
     */
    static isCapacitor() {
        return window.Capacitor !== undefined;
    }
    
    /**
     * Show a loading dialog
     * @param {string} message - Loading message
     * @returns {Object} - Dialog object with close() method
     */
    static showLoading(message = 'Loading...') {
        const modal = document.createElement('div');
        modal.className = 'mobile-dialog-overlay loading-dialog';
        modal.innerHTML = `
            <div class="mobile-dialog">
                <div class="dialog-content">
                    <div class="loading-spinner"></div>
                    <p class="dialog-message">${message}</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        return {
            close: () => modal.remove(),
            updateMessage: (newMessage) => {
                const msgEl = modal.querySelector('.dialog-message');
                if (msgEl) msgEl.textContent = newMessage;
            }
        };
    }
}

// Export for use in other modules
window.MobileDialogs = MobileDialogs;
