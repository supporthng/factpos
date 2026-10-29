/**
 * Tema camaleón: los colores de la marca del cliente, extraídos de su logo,
 * se convierten en los colores de la Terminal, la Administración y el ticket.
 *
 * Siempre se garantiza contraste legible (WCAG): si el color del logo es muy
 * claro o muy oscuro para un uso, se ajusta su luminosidad sin cambiar el tono.
 */
type RGB = [number, number, number];

export const hexARgb = (h: string): RGB => {
  const x = h.replace("#", "");
  const v = x.length === 3 ? x.split("").map((c) => c + c).join("") : x;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
};
export const rgbAHex = ([r, g, b]: RGB) =>
  "#" + [r, g, b].map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0")).join("");

function rgbAHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslARgb([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}

export function luminancia(hex: string) {
  const [r, g, b] = hexARgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contraste(a: string, b: string) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Cambia la luminosidad (0–1) conservando el tono y la saturación. */
export function conLuminosidad(hex: string, l: number) {
  const [h, s] = rgbAHsl(hexARgb(hex));
  return rgbAHex(hslARgb([h, s, Math.max(0, Math.min(1, l))]));
}

/** Aclara u oscurece el color lo mínimo necesario para alcanzar el contraste pedido sobre `fondo`. */
export function ajustarContraste(hex: string, fondo: string, minimo = 4.5) {
  if (contraste(hex, fondo) >= minimo) return hex;
  const [h, s, l] = rgbAHsl(hexARgb(hex));
  const oscurecer = luminancia(fondo) > 0.4;
  for (let i = 1; i <= 100; i++) {
    const nl = oscurecer ? l - i / 100 : l + i / 100;
    if (nl < 0 || nl > 1) break;
    const c = rgbAHex(hslARgb([h, s, nl]));
    if (contraste(c, fondo) >= minimo) return c;
  }
  return oscurecer ? "#000000" : "#ffffff";
}

/** Texto blanco o casi negro, el que más se lea sobre el color. */
export const textoSobre = (fondo: string) => (contraste("#ffffff", fondo) >= contraste("#111827", fondo) ? "#ffffff" : "#111827");

/** Mezcla dos colores (p = proporción del primero). */
export function mezclar(a: string, b: string, p: number) {
  const x = hexARgb(a), y = hexARgb(b);
  return rgbAHex([0, 1, 2].map((i) => x[i] * p + y[i] * (1 - p)) as RGB);
}

/**
 * Colores dominantes de un logo (píxeles RGBA de un canvas).
 * Ignora transparencias y prioriza los colores con más presencia y saturación;
 * los grises solo se proponen si el logo no tiene colores.
 */
export function extraerPaleta(pixeles: Uint8ClampedArray | number[], maximo = 6): string[] {
  const cubetas = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixeles.length; i += 4) {
    if (pixeles[i + 3] < 160) continue;
    const r = pixeles[i], g = pixeles[i + 1], b = pixeles[i + 2];
    const k = `${r >> 4},${g >> 4},${b >> 4}`;
    const c = cubetas.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++; c.r += r; c.g += g; c.b += b;
    cubetas.set(k, c);
  }
  const candidatos = [...cubetas.values()].map((c) => {
    const hex = rgbAHex([c.r / c.n, c.g / c.n, c.b / c.n]);
    const [, s, l] = rgbAHsl(hexARgb(hex));
    const neutro = s < 0.18 || l > 0.94 || l < 0.06;
    return { hex, n: c.n, neutro, peso: c.n * (neutro ? 0.15 : 0.5 + s) };
  });
  candidatos.sort((a, b) => b.peso - a.peso);
  const elegidos: string[] = [];
  for (const c of candidatos) {
    if (elegidos.every((e) => distancia(e, c.hex) > 60)) elegidos.push(c.hex);
    if (elegidos.length >= maximo) break;
  }
  // Primero los de color, luego los neutros
  return elegidos.sort((a, b) => Number(esNeutro(a)) - Number(esNeutro(b)));
}
const distancia = (a: string, b: string) => {
  const x = hexARgb(a), y = hexARgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
export const esNeutro = (hex: string) => {
  const [, s, l] = rgbAHsl(hexARgb(hex));
  return s < 0.18 || l > 0.94 || l < 0.06;
};

export interface Marca { primario: string; secundario?: string | null }

/** Variables CSS de la Administración (tema claro). */
export function temaAdmin(m: Marca): Record<string, string> {
  const blanco = "#ffffff";
  const primario = ajustarContraste(m.primario, blanco, 4.5);
  // Barra lateral: el secundario si es oscuro; si no, el primario muy oscuro
  const base = m.secundario && luminancia(m.secundario) < 0.12 ? m.secundario : conLuminosidad(m.primario, 0.18);
  const textoLateral = textoSobre(base);
  return {
    "--primario": primario,
    "--primario-suave": mezclar(primario, blanco, 0.12),
    "--texto-sobre-primario": textoSobre(primario),
    "--marca": base,
    "--marca-texto": textoLateral,
    "--marca-acento": ajustarContraste(m.primario, base, 3),
  };
}

/** Variables CSS de la Terminal (tema oscuro, alto contraste). */
/** Colores de la Terminal a partir de la marca. Sirve para el tema claro (predeterminado) y el oscuro. */
export function temaTerminal(m: Marca, fondo: "claro" | "oscuro" = "oscuro"): Record<string, string> {
  const panel = fondo === "claro" ? "#ffffff" : "#16202a";
  const boton = ajustarContraste(m.primario, "#ffffff", 4.5); // botón con texto blanco legible
  return {
    "--primario": ajustarContraste(m.primario, panel, 4.5),
    "--cobrar": boton,
    "--cobrar-hover": conLuminosidad(boton, Math.max(0, rgbAHsl(hexARgb(boton))[2] - 0.08)),
    "--texto-sobre-cobrar": "#ffffff",
    "--acento-marca": ajustarContraste(m.secundario && !esNeutro(m.secundario) ? m.secundario : m.primario, panel, 3),
    // Barra superior con el color de la marca (texto blanco legible)
    "--barra-marca": ajustarContraste(conLuminosidad(boton, Math.min(rgbAHsl(hexARgb(boton))[2], 0.3)), "#ffffff", 7),
  };
}
