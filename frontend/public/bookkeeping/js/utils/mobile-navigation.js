// ==================== MOBILE NAVIGATION MODULE ====================
/**
 * Handles responsive navigation behavior
 * - Hamburger menu toggle
 * - Slide-out sidebar
 * - Overlay backdrop
 * - Auto-close on menu selection
 * - Accessibility features
 */

class MobileNavigation {
    constructor() {
        this.sidebar = null;
        this.overlay = null;
        this.toggleBtn = null;
        this.closeBtn = null;
        this.menuItems = [];
        this.isOpen = false;
        
        this.init();
    }
    
    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }
    
    setup() {
        console.log('📱 Initializing Mobile Navigation...');
        
        // Get elements
        this.sidebar = document.getElementById('mobile-sidebar');
        this.overlay = document.getElementById('sidebar-overlay');
        this.toggleBtn = document.getElementById('mobile-menu-toggle');
        this.closeBtn = document.getElementById('close-sidebar');
        this.menuItems = document.querySelectorAll('.mobile-sidebar nav ul li[data-section]');
        
        // Verify elements exist
        if (!this.sidebar || !this.overlay || !this.toggleBtn) {
            console.warn('⚠️ Mobile navigation elements not found');
            return;
        }
        
        // Bind events
        this.bindEvents();
        
        // Handle initial state
        this.handleResize();
        
        console.log('✅ Mobile Navigation initialized');
    }
    
    bindEvents() {
        // Toggle sidebar on hamburger click
        this.toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openSidebar();
        });
        
        // Close sidebar on X button click
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.closeSidebar());
        }
        
        // Close sidebar on overlay click
        this.overlay.addEventListener('click', () => this.closeSidebar());
        
        // Close sidebar when menu item clicked (mobile only)
        this.menuItems.forEach(item => {
            item.addEventListener('click', () => {
                if (this.isMobileView()) {
                    setTimeout(() => this.closeSidebar(), 150);
                }
            });
        });
        
        // Close on POS menu click
        const posMenuItem = document.getElementById('pos-menu-item');
        if (posMenuItem) {
            posMenuItem.addEventListener('click', () => {
                if (this.isMobileView()) {
                    setTimeout(() => this.closeSidebar(), 150);
                }
            });
        }
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
        
        // Handle escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.closeSidebar();
            }
        });
        
        // Prevent scroll when touching sidebar
        this.sidebar.addEventListener('touchmove', (e) => {
            if (this.isOpen) {
                e.stopPropagation();
            }
        }, { passive: false });
    }
    
    openSidebar() {
        if (this.isOpen) return;
        
        console.log('📱 Opening sidebar');
        
        this.sidebar.classList.add('active');
        this.overlay.classList.add('active');
        document.body.classList.add('sidebar-open');
        
        // Update ARIA attributes
        this.toggleBtn.setAttribute('aria-expanded', 'true');
        this.overlay.setAttribute('aria-hidden', 'false');
        
        // Prevent background scroll
        document.body.style.overflow = 'hidden';
        
        this.isOpen = true;
        
        // Focus management for accessibility
        if (this.closeBtn) {
            setTimeout(() => this.closeBtn.focus(), 100);
        }
    }
    
    closeSidebar() {
        if (!this.isOpen) return;
        
        console.log('📱 Closing sidebar');
        
        this.sidebar.classList.remove('active');
        this.overlay.classList.remove('active');
        document.body.classList.remove('sidebar-open');
        
        // Update ARIA attributes
        this.toggleBtn.setAttribute('aria-expanded', 'false');
        this.overlay.setAttribute('aria-hidden', 'true');
        
        // Restore scroll
        document.body.style.overflow = '';
        
        this.isOpen = false;
        
        // Return focus to toggle button
        this.toggleBtn.focus();
    }
    
    handleResize() {
        // Close sidebar when resizing to desktop
        if (!this.isMobileView() && this.isOpen) {
            this.closeSidebar();
        }
    }
    
    isMobileView() {
        return window.innerWidth <= 767; /* Tablet 768+ uses in-flow nav, so only use sidebar on phone */
    }
    
    // Public API
    toggle() {
        if (this.isOpen) {
            this.closeSidebar();
        } else {
            this.openSidebar();
        }
    }
    
    close() {
        this.closeSidebar();
    }
    
    open() {
        this.openSidebar();
    }
}

// ==================== SWIPE GESTURE SUPPORT (OPTIONAL) ====================
/**
 * Adds swipe gesture support for opening/closing sidebar
 * Swipe from left edge to open
 * Swipe left while open to close
 */
class SwipeGesture {
    constructor(mobileNav) {
        this.mobileNav = mobileNav;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchEndX = 0;
        this.touchEndY = 0;
        this.minSwipeDistance = 50;
        this.edgeThreshold = 30; // pixels from left edge
        
        this.init();
    }
    
    init() {
        document.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
        document.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: true });
        document.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });
    }
    
    handleTouchStart(e) {
        if (e.touches.length !== 1) return;
        
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
    }
    
    handleTouchMove(e) {
        if (e.touches.length !== 1) return;
        
        this.touchEndX = e.touches[0].clientX;
        this.touchEndY = e.touches[0].clientY;
    }
    
    handleTouchEnd(e) {
        const swipeDistanceX = this.touchEndX - this.touchStartX;
        const swipeDistanceY = Math.abs(this.touchEndY - this.touchStartY);
        
        // Ensure it's a horizontal swipe (not vertical scroll)
        if (swipeDistanceY > 50) return;
        
        // Swipe from left edge to open
        if (!this.mobileNav.isOpen && 
            this.touchStartX < this.edgeThreshold && 
            swipeDistanceX > this.minSwipeDistance) {
            this.mobileNav.openSidebar();
        }
        
        // Swipe left to close
        if (this.mobileNav.isOpen && swipeDistanceX < -this.minSwipeDistance) {
            this.mobileNav.closeSidebar();
        }
    }
}

// ==================== BOTTOM NAV ====================
class BottomNavigation {
    constructor() {
        this.bar = document.getElementById('bottom-nav');
        if (!this.bar) return;

        this.items = this.bar.querySelectorAll('.bottom-nav-item[data-section]');
        this.moreBtn = document.getElementById('bottom-nav-more');

        this.items.forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.dataset.section;
                if (window.appController) {
                    window.appController.navigateToSection(section);
                }
                this.setActive(section);
            });
        });

        if (this.moreBtn) {
            this.moreBtn.addEventListener('click', () => {
                if (window.mobileNav) window.mobileNav.openSidebar();
            });
        }

        const observer = new MutationObserver(() => this.syncActive());
        const navUl = document.querySelector('.mobile-sidebar nav ul');
        if (navUl) observer.observe(navUl, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }

    setActive(section) {
        this.bar.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
        const match = this.bar.querySelector(`.bottom-nav-item[data-section="${section}"]`);
        if (match) match.classList.add('active');
    }

    syncActive() {
        const activeLi = document.querySelector('.mobile-sidebar nav ul li.active');
        if (activeLi) this.setActive(activeLi.dataset.section);
    }
}

// ==================== INITIALIZATION ====================
let mobileNavInstance = null;
let swipeGestureInstance = null;
let bottomNavInstance = null;

function initMobileNavigation() {
    try {
        mobileNavInstance = new MobileNavigation();
        swipeGestureInstance = new SwipeGesture(mobileNavInstance);
        bottomNavInstance = new BottomNavigation();

        window.mobileNav = mobileNavInstance;
    } catch (error) {
        console.error('Failed to initialize mobile navigation:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileNavigation);
} else {
    initMobileNavigation();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MobileNavigation, SwipeGesture };
}
