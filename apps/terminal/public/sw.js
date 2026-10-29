// FactPOS Caja: guarda la pantalla de la caja para poder abrirla aunque el
// servidor de la sucursal esté caído (contingencia). Los datos nunca se guardan
// aquí: los maneja la caja en su almacén local.
const CACHE = "factpos-caja-v3";
const BASE = new URL("./", self.location).pathname; // /terminal/

// Al instalar se guarda la página y TODOS sus archivos (js, css, letras, íconos)
async function guardarTodo() {
  const c = await caches.open(CACHE);
  const r = await fetch("./index.html", { cache: "no-store" });
  const html = await r.clone().text();
  await c.put("./index.html", r.clone());
  await c.put("./", r);
  const archivos = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
  await Promise.all(archivos.map(async (a) => {
    const x = await fetch(a).catch(() => null);
    if (!x?.ok) return;
    if (a.endsWith(".css")) {
      // Las letras y dibujos que pide la hoja de estilos
      const css = await x.clone().text();
      const base = new URL(a, self.location);
      const extra = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]).filter((u) => !u.startsWith("data:"));
      await Promise.all(extra.map((u) => { const abs = new URL(u, base).href; return fetch(abs).then((y) => (y.ok ? c.put(abs, y) : null)).catch(() => null); }));
    }
    await c.put(a, x);
  }));
}
self.addEventListener("install", (e) => {
  e.waitUntil(guardarTodo().catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("message", (e) => { if (e.data === "guardar") guardarTodo().catch(() => {}); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("factpos-caja-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const conTiempo = (p, ms) => Promise.race([p, new Promise((_, mal) => setTimeout(() => mal(new Error("tiempo")), ms))]);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Solo los archivos de la pantalla de la caja; las consultas al servidor van en vivo
  if (e.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  e.respondWith(
    conTiempo(fetch(e.request), 4000)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(async () => {
        const op = { ignoreVary: true, ignoreSearch: true };
        const r = (await caches.match(e.request, op)) || (e.request.mode === "navigate" ? await caches.match(BASE + "index.html", op) : undefined);
        return r || Response.error();
      }),
  );
});
