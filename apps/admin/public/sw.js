// Service worker mínimo: permite instalar la app y abrirla aunque falle la red
// (los datos siempre se piden en vivo a la central).
const CACHE = "factpos-admin-v7";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./manifest.webmanifest", "./iconos/factpos-192.png"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Solo los archivos de la app; los datos (/central/...) siempre van en vivo
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/central")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./"))),
  );
});
