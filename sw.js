const CACHE_NAME = 'radio-hits2o-v5';
const urlsToCache = [
  './index.html',
  './styles.css',
  './variables.css',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // REGLA ÚNICA: ignorar CUALQUIER request cross-origin.
  // El SW solo cachea recursos del propio sitio. Nunca intercepta APIs externas.
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Para navegación (HTML), red primero → caché como fallback offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Para assets locales (CSS, imágenes, JS): caché primero → red si no está.
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
