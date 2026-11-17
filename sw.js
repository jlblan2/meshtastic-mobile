// Offline cache for the app's own files (and the map library). Map tiles are
// never cached: they are only useful online and would fill the phone.
// Bump CACHE whenever any file below changes.
const CACHE = 'meshmobile-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './disclaimer.js',
  './schema.js',
  './proto.js',
  './lora.js',
  './radio.js',
  './backup.js',
  './demo.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './Meshtastic%20Mobile%20Guide.pdf',   // so the guide opens with no signal
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('meshmobile-') && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const own = url.origin === self.location.origin && url.pathname.startsWith(new URL('./', self.location).pathname);
  const leaflet = url.hostname === 'unpkg.com' && url.pathname.includes('/leaflet@');
  if (!own && !leaflet) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request, { ignoreSearch: own }).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((resp) => {
          if (resp.ok || resp.type === 'opaque') cache.put(event.request, resp.clone());
          return resp;
        });
      })
    )
  );
});
