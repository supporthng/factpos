import { useEffect, useState } from "react";

/**
 * Foto de producto sin el fondo: muchas fotos vienen con fondo blanco, gris claro o con degradado pegado en el archivo.
 * Se toma el color del borde completo y, si es claro y parejo, se borra desde los bordes hacia adentro
 * (sin tocar el blanco que esté dentro del producto). Si el navegador no deja leer la foto (otro sitio sin permiso),
 * se muestra tal cual. El resultado se guarda en memoria para no repetir el trabajo.
 */
const cache = new Map<string, string | null>();

function procesar(img: HTMLImageElement): string | null {
  const escala = Math.min(1, 220 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * escala)), h = Math.max(1, Math.round(img.naturalHeight * escala));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h); // si la foto no tiene permiso, lanza y se muestra la original
  const px = d.data;
  const at = (x: number, y: number) => (y * w + x) * 4;
  // si ya trae transparencia en las esquinas, no hay nada que quitar
  const esquinas = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  if (esquinas.some((i) => px[i + 3] < 200)) return null;
  // Color del fondo: la mediana de todo el borde (aguanta degradados suaves, ruido de JPG y sombras en una esquina)
  const borde: number[] = [];
  for (let x = 0; x < w; x++) { borde.push(at(x, 0), at(x, h - 1)); }
  for (let y = 1; y < h - 1; y++) { borde.push(at(0, y), at(w - 1, y)); }
  const mediana = (k: number) => { const v = borde.map((i) => px[i + k]).sort((m, n) => m - n); return v[v.length >> 1]; };
  const media = [mediana(0), mediana(1), mediana(2)];
  const lum = (media[0] * 299 + media[1] * 587 + media[2] * 114) / 1000;
  if (lum < 140) return null; // fondo oscuro: se deja (podría comerse un producto oscuro)
  const dist = (i: number, r: number, g2: number, b2: number) => Math.hypot(px[i] - r, px[i + 1] - g2, px[i + 2] - b2);
  const parecidos = borde.filter((i) => dist(i, media[0], media[1], media[2]) < 48).length;
  if (parecidos < borde.length * 0.6) return null; // el borde no es un fondo parejo (producto pegado al borde, escena, etc.)
  const visto = new Uint8Array(w * h);
  const cola: number[] = [];
  // Un píxel es fondo si se parece al color del fondo (tolerancia amplia) o, si viene pegado a fondo ya borrado, si cambia poco respecto a su vecino (degradados y sombras suaves)
  const meter = (x: number, y: number, desde: number) => {
    const k = y * w + x;
    if (visto[k]) return;
    const i = k * 4;
    const alFondo = dist(i, media[0], media[1], media[2]);
    const alVecino = desde < 0 ? 999 : dist(i, px[desde * 4], px[desde * 4 + 1], px[desde * 4 + 2]);
    if (alFondo < 40 || (alFondo < 90 && alVecino < 9)) { visto[k] = 1; cola.push(k); }
  };
  for (let x = 0; x < w; x++) { meter(x, 0, -1); meter(x, h - 1, -1); }
  for (let y = 0; y < h; y++) { meter(0, y, -1); meter(w - 1, y, -1); }
  while (cola.length) {
    const k = cola.pop()!; const x = k % w, y = (k / w) | 0;
    if (x > 0) meter(x - 1, y, k); if (x < w - 1) meter(x + 1, y, k); if (y > 0) meter(x, y - 1, k); if (y < h - 1) meter(x, y + 1, k);
  }
  let borrados = 0;
  for (let k = 0; k < w * h; k++) if (visto[k]) { px[k * 4 + 3] = 0; borrados++; }
  if (borrados < w * h * 0.08) return null; // casi no había fondo: no vale la pena
  if (borrados > w * h * 0.97) return null; // se borró casi todo: algo salió mal, se deja la foto original
  // borde suave: los píxeles parecidos al fondo, pegados al fondo borrado, quedan semitransparentes
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    if (visto[k] || px[k * 4 + 3] === 0) continue;
    if (visto[k - 1] || visto[k + 1] || visto[k - w] || visto[k + w]) {
      const d0 = dist(k * 4, media[0], media[1], media[2]);
      if (d0 < 110) px[k * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0.25, (d0 - 40) / 70)));
    }
  }
  g.putImageData(d, 0, 0);
  return c.toDataURL("image/png");
}

function cargar(src: string): Promise<string | null> {
  if (cache.has(src)) return Promise.resolve(cache.get(src) ?? null);
  return new Promise((resolver) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      let r: string | null = null;
      try { r = procesar(im); } catch { r = null; }
      cache.set(src, r); resolver(r);
    };
    im.onerror = () => { cache.set(src, null); resolver(null); };
    im.src = src;
  });
}

export function ImagenSinFondo({ src }: { src: string }) {
  const [listo, setListo] = useState<string | null | undefined>(cache.has(src) ? cache.get(src) : undefined);
  useEffect(() => {
    let vivo = true;
    cargar(src).then((r) => { if (vivo) setListo(r); });
    return () => { vivo = false; };
  }, [src]);
  // mientras se procesa no se muestra la original (evita el parpadeo del fondo blanco)
  return <img src={listo ?? src} alt="" loading="lazy" decoding="async" style={listo === undefined ? { opacity: 0 } : undefined} />;
}
