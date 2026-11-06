import { useEffect, useState } from "react";

/**
 * Foto de producto sin el fondo blanco: muchas fotos vienen con fondo blanco o gris claro pegado en el archivo.
 * Se detecta el color de las esquinas y, si es claro y parejo, se borra desde los bordes hacia adentro
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
  const media = [0, 1, 2].map((k) => esquinas.reduce((a, i) => a + px[i + k], 0) / 4);
  if (media.some((v) => v < 215)) return null; // fondo oscuro o de color: se deja
  if (esquinas.some((i) => [0, 1, 2].some((k) => Math.abs(px[i + k] - media[k]) > 14))) return null; // esquinas distintas
  const cerca = (i: number) => Math.hypot(px[i] - media[0], px[i + 1] - media[1], px[i + 2] - media[2]) < 34;
  const visto = new Uint8Array(w * h);
  const cola: number[] = [];
  const meter = (x: number, y: number) => { const k = y * w + x; if (!visto[k] && cerca(at(x, y))) { visto[k] = 1; cola.push(k); } };
  for (let x = 0; x < w; x++) { meter(x, 0); meter(x, h - 1); }
  for (let y = 0; y < h; y++) { meter(0, y); meter(w - 1, y); }
  while (cola.length) {
    const k = cola.pop()!; const x = k % w, y = (k / w) | 0;
    if (x > 0) meter(x - 1, y); if (x < w - 1) meter(x + 1, y); if (y > 0) meter(x, y - 1); if (y < h - 1) meter(x, y + 1);
  }
  let borrados = 0;
  for (let k = 0; k < w * h; k++) if (visto[k]) { px[k * 4 + 3] = 0; borrados++; }
  if (borrados < w * h * 0.08) return null; // casi no había fondo: no vale la pena
  // borde suave: los píxeles claros pegados al fondo borrado quedan semitransparentes
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    if (visto[k] || px[k * 4 + 3] === 0) continue;
    if (visto[k - 1] || visto[k + 1] || visto[k - w] || visto[k + w]) {
      const claro = (px[k * 4] + px[k * 4 + 1] + px[k * 4 + 2]) / 3;
      if (claro > 200) px[k * 4 + 3] = 110;
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
