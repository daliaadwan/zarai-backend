const CACHE_NAME = 'zarai-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/global.css',
  '/css/components.css',
  '/css/layout.css',
  '/css/mobile.css',
  '/js/app.js',
  '/js/firebase-connector.js',
  '/js/railway-connector.js',
  '/js/i18n.js',
  '/js/realtime.js',
  '/assets/logo.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
