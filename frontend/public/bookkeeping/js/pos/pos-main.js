// ==================== POS MAIN (pos11.html style) ====================
import { auth } from '../config/firebase.js';
import { onAuthStateChanged } from '../config/firebase.js';
import { state } from '../utils/state.js';
import { POSUI } from './pos-ui.js';

import { POSData } from './pos-data.js';
import { POSProducts } from './pos-products.js';
import { POSCart } from './pos-cart.js';
import { POSScanner } from './pos-scanner.js';

export const POSMain = {
    initialized: false,

    async init() {
        POSUI.loadDarkModePreference();

        document.getElementById('dark-mode-toggle')?.addEventListener('click', () => {
            POSUI.toggleDarkMode();
        });

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                state.currentUser = user;

                const userRole = await POSData.getUserRole();

                const emailDisplay = `User: ${user.email}${userRole.assignedOutlet ? ` (${userRole.assignedOutlet})` : ''}`;
                document.getElementById('user-email').textContent = emailDisplay;

                await this.loadData();

                POSProducts.init();
                POSCart.init();
                await POSScanner.init();

                this.initialized = true;

            } else {
                window.location.href = new URL('index.html', window.location.href).href;
            }
        });
    },

    async loadData() {
        try {
            const products = await POSData.loadProducts();
            POSProducts.setProducts(products);
        } catch (error) {
            console.error('[POSMain] loadData error:', error);
            POSUI.showNotification('Error loading products', 'error');
        }
    }
};
