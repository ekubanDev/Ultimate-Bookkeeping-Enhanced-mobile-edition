// ==================== POS UI (pos11.html style) ====================

export const POSUI = {
    
    // Show notification toast
    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        if (!notification) return;

        notification.textContent = message;
        notification.className = `notification show ${type === 'error' ? 'error' : ''}`;

        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    },

    // Format currency
    formatCurrency(amount) {
        return `₵${parseFloat(amount).toFixed(2)}`;
    },

    // Toggle dark mode
    toggleDarkMode() {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('dark-mode', isDark);
        
        const btn = document.getElementById('dark-mode-toggle');
        if (btn) {
            btn.innerHTML = isDark ? 
                '<i class="fas fa-sun"></i> Light Mode' : 
                '<i class="fas fa-moon"></i> Dark Mode';
        }
    },

    // Load dark mode preference
    loadDarkModePreference() {
        const isDark = localStorage.getItem('dark-mode') === 'true';
        if (isDark) {
            document.body.classList.add('dark-mode');
            const btn = document.getElementById('dark-mode-toggle');
            if (btn) btn.innerHTML = '<i class="fas fa-sun"></i> Light Mode';
        }
    }
};
