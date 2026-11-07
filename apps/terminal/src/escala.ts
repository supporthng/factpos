/**
 * Escala automática de la Terminal según la pantalla.
 * El diseño base es 1536 × 864 (un monitor Full HD con Windows al 125 %, lo más común hoy). En pantallas
 * más pequeñas todo se reduce en proporción para que quepa; en las grandes crece solo un poco.
 * Cada terminal puede además elegir su tamaño: Automático, o más compacto o más grande.
 */
const BASE_ANCHO = 1536;
const BASE_ALTO = 864;
const CLAVE = "factpos.tamano";

export type Tamano = "muy-pequeno" | "pequeno" | "normal" | "grande" | "muy-grande";
export const TAMANOS: Record<Tamano, { nombre: string; factor: number }> = {
  "muy-pequeno": { nombre: "Muy compacto", factor: 0.72 },
  pequeno: { nombre: "Compacto", factor: 0.86 },
  normal: { nombre: "Automático", factor: 1 },
  grande: { nombre: "Grande", factor: 1.12 },
  "muy-grande": { nombre: "Muy grande", factor: 1.25 },
};

export function leerTamano(): Tamano {
  try { return (localStorage.getItem(CLAVE) as Tamano) || "normal"; } catch { return "normal"; }
}
export function guardarTamano(t: Tamano) {
  try { localStorage.setItem(CLAVE, t); } catch { /* sin almacenamiento */ }
  aplicarEscala();
}

export function aplicarEscala() {
  const bruto = Math.min(window.innerWidth / BASE_ANCHO, window.innerHeight / BASE_ALTO);
  // En pantallas grandes (Full HD, 2K) crece solo un poco: antes llenaba todo y se veía enorme
  const auto = bruto > 1 ? 1 + (bruto - 1) * 0.3 : bruto;
  const escala = Math.max(0.5, Math.min(2, auto * TAMANOS[leerTamano()].factor));
  document.documentElement.style.setProperty("--escala", escala.toFixed(3));
  // Con «Grande» o «Muy grande» los nombres del carrito crecen solo un poco (la tercera parte): se compensa el resto del zoom
  const f = TAMANOS[leerTamano()].factor;
  document.documentElement.style.setProperty("--comp-nombres", (f > 1 ? (1 + (f - 1) * 0.35) / f : 1).toFixed(3));
}

export function iniciarEscala() {
  aplicarEscala();
  window.addEventListener("resize", aplicarEscala);
}

/** Tema de esta terminal: claro (predeterminado) u oscuro. */
export type Tema = "claro" | "oscuro";
const CLAVE_TEMA = "factpos.tema";
export function leerTema(): Tema {
  try { return localStorage.getItem(CLAVE_TEMA) === "oscuro" ? "oscuro" : "claro"; } catch { return "claro"; }
}
export function aplicarTema() {
  document.documentElement.dataset.tema = leerTema();
}
export function guardarTema(t: Tema) {
  try { localStorage.setItem(CLAVE_TEMA, t); } catch { /* sin almacenamiento */ }
  aplicarTema();
  window.dispatchEvent(new Event("factpos:tema"));
}
