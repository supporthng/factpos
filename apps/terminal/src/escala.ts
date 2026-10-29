/**
 * Escala automática de la Terminal según la pantalla.
 * El diseño base es 1366 × 768 (la pantalla de caja más común). En pantallas
 * más grandes o más pequeñas todo crece o se reduce en proporción, y cada
 * terminal puede además elegir un tamaño de letra (Normal, Grande, Muy grande).
 */
const BASE_ANCHO = 1366;
const BASE_ALTO = 768;
const CLAVE = "factpos.tamano";

export type Tamano = "normal" | "grande" | "muy-grande";
export const TAMANOS: Record<Tamano, { nombre: string; factor: number }> = {
  normal: { nombre: "Normal", factor: 1 },
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
  const auto = Math.min(window.innerWidth / BASE_ANCHO, window.innerHeight / BASE_ALTO);
  const escala = Math.max(0.75, Math.min(2, auto * TAMANOS[leerTamano()].factor));
  document.documentElement.style.setProperty("--escala", escala.toFixed(3));
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
