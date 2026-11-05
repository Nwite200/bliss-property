/* Bliss Legacy Limited — PWA service worker.
   Static assets only. API and authenticated financial data are never cached. */
const CACHE_VERSION = "bliss-pwa-v5";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const CORE_ASSETS = [
  "/",
  "/offline",
  "/manifest.json",
  "/assets/css/styles.css",
  "/assets/css/motion.css",
  "/assets/js/intro-config.js",
  "/assets/js/motion.js",
  "/assets/js/pwa.js",
  "/assets/js/mobile-nav.js",
  "/assets/js/components.js",
  "/assets/js/data/properties.js",
  "/assets/images/bliss-legacy-logo.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/icon-maskable-512.png",
  "/assets/icons/apple-touch-icon.png",
  "/assets/icons/favicon-32.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => Promise.allSettled(CORE_ASSETS.map(asset => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== STATIC_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses, receipts, reports, payments or authenticated data.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then(cached => cached || caches.match("/offline"))
      )
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname === "/manifest.json") {
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
