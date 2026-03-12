const CACHE_VERSION = 'ubk-v4';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;
const CDN_CACHE = `cdn-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/bookkeeping/',
  '/bookkeeping/index.html',
  '/bookkeeping/pos.html',
  '/bookkeeping/css/styles.css',
  '/bookkeeping/css/themes.css',
  '/bookkeeping/css/responsive.css',
  '/bookkeeping/css/mobile-dialogs.css',
  '/bookkeeping/css/enhancements.css',
  '/bookkeeping/css/enhanced-dashboard.css',
  '/bookkeeping/css/ai-chat.css',
  '/bookkeeping/css/pos.css',
  '/bookkeeping/js/app.js',
  '/bookkeeping/js/pos-app.js',
  '/bookkeeping/js/config/firebase.js',
  '/bookkeeping/js/config/email-templates.js',
  '/bookkeeping/js/utils/state.js',
  '/bookkeeping/js/utils/utils.js',
  '/bookkeeping/js/utils/mobile-dialogs.js',
  '/bookkeeping/js/utils/mobile-navigation.js',
  '/bookkeeping/js/utils/financial-reports-modal.js',
  '/bookkeeping/js/controllers/app-controller.js',
  '/bookkeeping/js/controllers/pos-controller.js',
  '/bookkeeping/js/services/firebase-service.js',
  '/bookkeeping/js/services/data-loader.js',
  '/bookkeeping/js/services/activity-logger.js',
  '/bookkeeping/js/services/offline-sync.js',
  '/bookkeeping/js/services/email-service.js',
  '/bookkeeping/js/services/export-service.js',
  '/bookkeeping/js/services/i18n-service.js',
  '/bookkeeping/js/services/enhanced-dashboard.js',
  '/bookkeeping/js/services/ai-chat.js',
  '/bookkeeping/js/services/native-features.js',
  '/bookkeeping/js/services/stock-alerts.js',
  '/bookkeeping/js/services/form-validator.js',
  '/bookkeeping/js/services/profit-analysis.js',
  '/bookkeeping/js/services/customer-credit.js',
  '/bookkeeping/js/services/sales-returns.js',
  '/bookkeeping/js/services/recurring-expenses.js',
  '/bookkeeping/js/services/stock-transfer.js',
  '/bookkeeping/js/services/pdf-export.js',
  '/bookkeeping/js/services/barcode-scanner.js',
  '/bookkeeping/js/pos/pos-main.js',
  '/bookkeeping/js/pos/pos-ui.js',
  '/bookkeeping/js/pos/pos-cart.js',
  '/bookkeeping/js/pos/pos-checkout.js',
  '/bookkeeping/js/pos/pos-data.js',
  '/bookkeeping/js/pos/pos-invoice.js',
  '/bookkeeping/js/pos/pos-modal.js',
  '/bookkeeping/js/pos/pos-products.js',
  '/bookkeeping/js/pos/pos-scanner.js',
  '/bookkeeping/locales/en.json',
  '/bookkeeping/locales/fr.json',
  '/bookkeeping/locales/tw.json',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
  '/manifest.json'
];

const CDN_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'www.gstatic.com'
];

const API_PATTERNS = [
  '/api/',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com'
];

// ==================== INSTALL ====================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Use allSettled so one missing file doesn't break the whole install
      return Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Failed to cache:', url, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== DYNAMIC_CACHE && k !== CDN_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ==================== FETCH ====================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API requests: network-first
  if (API_PATTERNS.some((p) => url.href.includes(p))) {
    event.respondWith(networkFirst(request, DYNAMIC_CACHE));
    return;
  }

  // CDN resources: stale-while-revalidate
  if (CDN_ORIGINS.some((origin) => url.hostname.includes(origin))) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  // App shell and static assets: cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ==================== CACHING STRATEGIES ====================

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return offlineFallback(request);
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || networkFetch;
}

function offlineFallback(request) {
  if (request.destination === 'document') {
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Offline</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,' +
      '"Segoe UI",Roboto,sans-serif;background:#0f1419;color:#e1e8ed;display:flex;align-items:center;justify-content:center;' +
      'min-height:100vh;padding:2rem;text-align:center}.c{max-width:400px}.i{font-size:4rem;margin-bottom:1.5rem}' +
      'h1{font-size:1.5rem;margin-bottom:.75rem;color:#fff}p{color:#8899a6;line-height:1.6;margin-bottom:1.5rem}' +
      'button{background:#007bff;color:#fff;border:none;padding:.875rem 2rem;border-radius:8px;font-size:1rem;' +
      'cursor:pointer;min-height:44px}button:active{opacity:.8}</style></head>' +
      '<body><div class="c"><div class="i">&#128244;</div><h1>You\'re Offline</h1>' +
      '<p>Check your connection and try again. Changes made offline will sync when you reconnect.</p>' +
      '<button onclick="location.reload()">Try Again</button></div></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
  return new Response('', { status: 503, statusText: 'Offline' });
}

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-operations') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'TRIGGER_SYNC' }));
      })
    );
  }
});

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Ultimate Bookkeeping', {
      body: data.body || 'New notification',
      icon: '/assets/icons/icon-192x192.png',
      badge: '/assets/icons/icon-72x72.png',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/bookkeeping/' },
      actions: data.actions || []
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/bookkeeping/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes('/bookkeeping/'));
      return existing ? existing.focus() : self.clients.openWindow(targetUrl);
    })
  );
});

console.log('[SW] Service worker loaded');
