/* ==========================================================================
   TableTap — sw.js
   Service worker for installable standalone Kitchen and Floor PWA, and for
   guest notifications (food ready, Google review reminder).
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

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { /* not JSON */ }
  event.waitUntil(self.registration.showNotification(data.title || 'TableTap', {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // The server only sends this site's pages or a checked Google review link.
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  if (url.protocol !== 'https:' && url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.openWindow(url.href));
});
