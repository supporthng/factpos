/**
 * Tamaño de la pantalla de la Administración (por equipo).
 * «Automático» se adapta a la ventana: en una pantalla chica todo se reduce para que quepa y en una grande se deja
 * tal cual. Además se puede elegir más compacto o más grande.
 */
const BASE_ANCHO = 1440;
const BASE_ALTO = 810;
const CLAVE = "factpos.admin.tamano";

export type TamanoAdmin = "compacto" | "automatico" | "grande" | "muy-grande";
export const TAMANOS_ADMIN: Record<TamanoAdmin, { nombre: string; factor: number }> = {
  compacto: { nombre: "Compacto", factor: 0.85 },
  automatico: { nombre: "Automático", factor: 1 },
  grande: { nombre: "Grande", factor: 1.15 },
  "muy-grande": { nombre: "Muy grande", factor: 1.3 },
};

export function leerTamanoAdmin(): TamanoAdmin {
  try { const v = localStorage.getItem(CLAVE) as TamanoAdmin; return v in TAMANOS_ADMIN ? v : "automatico"; } catch { return "automatico"; }
}
export function guardarTamanoAdmin(t: TamanoAdmin) {
  try { localStorage.setItem(CLAVE, t); } catch { /* sin almacenamiento */ }
  aplicarEscalaAdmin();
}
export function aplicarEscalaAdmin() {
  const bruto = Math.min(window.innerWidth / BASE_ANCHO, window.innerHeight / BASE_ALTO);
  const auto = Math.max(0.7, Math.min(1, bruto)); // solo se reduce cuando la ventana es chica
  const escala = Math.max(0.6, Math.min(1.6, auto * TAMANOS_ADMIN[leerTamanoAdmin()].factor));
  document.documentElement.style.setProperty("--escala", escala.toFixed(3));
}
export function iniciarEscalaAdmin() {
  aplicarEscalaAdmin();
  window.addEventListener("resize", aplicarEscalaAdmin);
}
