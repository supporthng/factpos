import { useEffect, useState } from "react";

/**
 * Logo sin su fondo blanco: los píxeles casi blancos se vuelven transparentes (con borde suave), así el logo
 * se ve sobre cualquier color de pantalla. Si el logo resulta oscuro, se le agrega un resplandor claro para que se lea.
 */
const cache = new Map<string, { url: string; oscuro: boolean }>();

function procesar(src: string): Promise<{ url: string; oscuro: boolean }> {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return mal(new Error("sin tamaño"));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, w, h);
        let suma = 0, n = 0;
        for (let i = 0; i < d.data.length; i += 4) {
          const m = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]);
          // 250+ = fondo blanco (transparente); entre 215 y 250 se difumina para no dejar halo
          const a = m >= 250 ? 0 : m > 215 ? Math.round(((250 - m) / 35) * 255) : 255;
          d.data[i + 3] = Math.min(d.data[i + 3], a);
          if (d.data[i + 3] > 128) { suma += 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]; n++; }
        }
        g.putImageData(d, 0, 0);
        ok({ url: c.toDataURL("image/png"), oscuro: n > 0 && suma / n < 120 });
      } catch (e) { mal(e as Error); }
    };
    img.onerror = () => mal(new Error("no cargó"));
    img.src = src;
  });
}

export function LogoSinFondo({ src, className }: { src: string; className?: string }) {
  const [r, setR] = useState<{ url: string; oscuro: boolean } | null>(cache.get(src) ?? null);
  useEffect(() => {
    if (cache.has(src)) return setR(cache.get(src)!);
    let vigente = true;
    procesar(src).then((x) => { cache.set(src, x); if (vigente) setR(x); }).catch(() => {});
    return () => { vigente = false; };
  }, [src]);
  // Mientras se procesa (o si no se pudo) se muestra el original
  return <img className={(className ?? "") + (r?.oscuro ? " logo-oscuro" : "")} src={r?.url ?? src} alt="" />;
}
