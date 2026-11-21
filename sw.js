/* ==========================================================================
   TableTap — sw.js
   Service worker for installable standalone Kitchen and Floor PWA.
   ========================================================================== */

const CACHE_NAME = 'tabletap-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through network requests for local demo
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
