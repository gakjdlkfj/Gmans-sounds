// Basic offline cache for static assets.
const CACHE = 'ossb-pro-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then(resp => resp || fetch(event.request).then(networkResp => {
        // cache new GETs
        if (event.request.method === 'GET') {
          const copy = networkResp.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return networkResp;
      }))
    );
  }
});
