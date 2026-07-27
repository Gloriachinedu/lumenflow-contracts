/**
 * LumenFlow Service Worker
 * Caches static frontend assets and mock data for offline use.
 * Strategy: Cache-first for static assets, network-first for API calls.
 */

const CACHE_NAME = 'lumenflow-v1.0.0';

/**
 * Static assets to pre-cache on service worker install.
 * These files make up the app shell — everything needed to load the UI offline.
 */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/history.html',
  '/receipt.html',
  '/multisig.html',
  '/payment-history.html',
  '/payment-history-paginated.html',
  '/styles.css',
  '/lumenflow-shared.js',
  '/receipt.js',
  '/multisig.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/**
 * Mock receipt data cached for offline demo use.
 * Enables the receipt page to show a meaningful demo when offline.
 */
const OFFLINE_RECEIPT_MOCK = {
  payment: {
    order_id: 'OFFLINE_DEMO',
    merchant_address: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON',
    payer: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
    token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    amount: '50000000',
    status: 'Completed',
    paid_at: String(Math.floor(Date.now() / 1000) - 3600),
    refunded_amount: '0',
    memo: 'Offline Demo Receipt',
  },
  merchant: { name: 'LumenFlow Demo Store', verified: true },
  refunds: [],
};

// ── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache all static assets. Non-critical assets are cached individually
      // so a single 404 doesn't prevent the SW from activating.
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            // Log but don't fail install for optional/placeholder assets
            console.warn(`[SW] Could not pre-cache ${url}:`, err.message);
          })
        )
      );
    }).then(() => {
      // Cache offline mock data as a special key
      return caches.open(CACHE_NAME).then((cache) => {
        const mockResponse = new Response(JSON.stringify(OFFLINE_RECEIPT_MOCK), {
          headers: { 'Content-Type': 'application/json' },
        });
        return cache.put('/__offline_receipt_mock__', mockResponse);
      });
    }).then(() => {
      // Activate immediately without waiting for existing tabs to close
      return self.skipWaiting();
    })
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests; let cross-origin (CDN, RPC) pass through
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Soroban RPC calls: network-first, no caching
  if (url.pathname.includes('/soroban/rpc') || url.pathname.includes('/rpc')) {
    event.respondWith(fetch(request).catch(() => offlineRpcResponse()));
    return;
  }

  // Static HTML / CSS / JS / images: cache-first, fallback to network then offline page
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Serve from cache, refresh in background (stale-while-revalidate)
        refreshCache(request);
        return cachedResponse;
      }

      // Not in cache — fetch from network and cache the response
      return fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => offlineFallback(request));
    })
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Background cache refresh (stale-while-revalidate).
 * Silently updates the cache without blocking the response.
 */
function refreshCache(request) {
  fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
      }
    })
    .catch(() => { /* offline — skip refresh */ });
}

/**
 * Fallback for requests that are not in cache and network is unavailable.
 * Returns the cached receipt page for HTML requests, or a minimal offline JSON response.
 */
function offlineFallback(request) {
  const url = new URL(request.url);

  // HTML pages: serve the cached receipt page as a generic offline shell
  if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
    return caches.match('/receipt.html').then((cached) => {
      if (cached) return cached;
      return new Response(
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Offline – LumenFlow</title></head>' +
        '<body style="font-family:system-ui;text-align:center;padding:4rem 1rem">' +
        '<h1 style="color:#6c47ff">LumenFlow</h1>' +
        '<p>You are offline. Please check your connection and try again.</p>' +
        '</body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      );
    });
  }

  // JSON / API requests
  return new Response(
    JSON.stringify({ error: 'offline', message: 'No network connection available.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Generic offline response for RPC calls when no network is available.
 */
function offlineRpcResponse() {
  return new Response(
    JSON.stringify({ error: 'offline', message: 'Soroban RPC is unavailable while offline.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

// ── Message handling ──────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Allow clients to request the offline mock receipt data
  if (event.data && event.data.type === 'GET_OFFLINE_MOCK') {
    caches.open(CACHE_NAME).then((cache) =>
      cache.match('/__offline_receipt_mock__')
    ).then((response) => {
      if (response) {
        response.json().then((data) => {
          event.source.postMessage({ type: 'OFFLINE_MOCK_DATA', data });
        });
      }
    });
  }
});
