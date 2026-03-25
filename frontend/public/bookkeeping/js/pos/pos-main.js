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
        console.log('🚀 POS System initializing...');

        // Load dark mode
        POSUI.loadDarkModePreference();

        // Setup dark mode toggle
        document.getElementById('dark-mode-toggle')?.addEventListener('click', () => {
            POSUI.toggleDarkMode();
        });

        // Setup auth listener
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                state.currentUser = user;
                console.log('✅ User logged in:', user.email);

                // Get user role first
                const userRole = await POSData.getUserRole();
                console.log('User role:', userRole);

                // Update UI
                const emailDisplay = `User: ${user.email}${userRole.assignedOutlet ? ` (${userRole.assignedOutlet})` : ''}`;
                document.getElementById('user-email').textContent = emailDisplay;

                // Load data based on role
                await this.loadData();

                // Initialize modules
                POSProducts.init();
                POSCart.init();
                await POSScanner.init();

                this.initialized = true;
                console.log('✅ POS Ready');

            } else {
                // No user - redirect to login
                console.log('No user, redirecting...');
                window.location.href = new URL('index.html', window.location.href).href;
            }
        });
    },

    async loadData() {
        try {
            // Load products using POSData (handles role-based loading)
            const products = await POSData.loadProducts();
            
            console.log(`✅ Loaded ${products.length} products`);

            // Update products display
            POSProducts.setProducts(products);

        } catch (error) {
            console.error('Error loading data:', error);
            POSUI.showNotification('Error loading products', 'error');
        }
    }
};
