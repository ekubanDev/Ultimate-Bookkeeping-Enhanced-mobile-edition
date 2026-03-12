// ==================== POS MODAL (pos11.html style) ====================
export const POSModal = {
    close(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }
};
