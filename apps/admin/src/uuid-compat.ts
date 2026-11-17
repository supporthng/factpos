/**
 * `crypto.randomUUID` solo existe en páginas seguras (https o localhost). La administración y la caja se abren
 * por http desde otra PC de la red (http://10.0.0.5:3000), donde no existe y la pantalla quedaba en blanco.
 * Este relleno lo define con getRandomValues (sí disponible por http).
 */
function rellenarRandomUUID(): void {
  const c = globalThis.crypto as Crypto | undefined;
  if (!c || typeof c.randomUUID === "function") return;
  (c as { randomUUID: () => string }).randomUUID = () => {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

rellenarRandomUUID();
