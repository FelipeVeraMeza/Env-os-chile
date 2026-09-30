// Service worker mínimo: permite instalar la app (PWA) y abrir la interfaz sin conexión.
// Los datos (API) siempre se piden a la red: nunca se sirven envíos desde caché.
const CACHE = 'envios-v9';
const BASE = ['./', 'index.html', 'css/app.css', 'config.js', 'js/app.js', 'js/api.js', 'js/ui.js',
  'js/vistas/comun.js', 'js/vistas/cliente.js', 'js/vistas/envios.js', 'js/vistas/repartidor.js', 'js/vistas/admin.js',
  'js/vistas/publico.js', 'icons/icono.svg', 'fonts/plus-jakarta-sans.woff2', 'manifest.webmanifest'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/q/') || url.origin !== location.origin) return;
  // Red primero; si no hay conexión, la copia en caché.
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request)));
});
