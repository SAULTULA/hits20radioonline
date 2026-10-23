const CACHE_NAME = 'radio-hits2o-v4';
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
  // Ignorar las peticiones al stream de audio
  if (event.request.url.includes('condoristream.com') || event.request.url.includes('radiosmundiales.com')) {
    return;
  }

  // Para el HTML (navegación), intentamos ir a la red primero para siempre tener la última versión,
  // y si falla (sin internet), recurrimos a la caché.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Para el resto (CSS, imágenes, JS), usamos Caché primero, y si no está, vamos a la red.
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});
