const CACHE_NAME = 'jxo-installer-cache-v1';
const URLS_TO_CACHE = ['.', 'index.html', 'script.js', 'apps.json', 'manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(resp => resp || fetch(event.request))
  );
});
