// pwa/sw.js

const CACHE_NAME = 'jxo-app-installer-v1';
const SHELL_FILES = [
  '/',                   // adjust if your index.html lives at a sub‑path
  '/index.html',
  '/pwa/manifest.json',
  '/pwa/sw.js',
  '/pwa/icon-192.png',       // your PWA icons
  '/pwa/icon-512.png'
];

// Install: cache the shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // For same‑origin navigation requests (your app shell), do cache‑first
  if (event.request.mode === 'navigate' ||
      (event.request.method === 'GET' && url.origin === location.origin)) {
    event.respondWith(
      caches.match(event.request)
        .then(resp => resp || fetch(event.request))
    );
    return;
  }

  // For everything else, try network then cache
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        // optionally cache fetched assets:
        // if (url.origin === location.origin) {
        //   caches.open(CACHE_NAME).then(cache => cache.put(event.request, resp.clone()));
        // }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
