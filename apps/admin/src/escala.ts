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
  compacto: { nombre: "Compacto", factor: 0.9 },
  automatico: { nombre: "Automático", factor: 1 },
  grande: { nombre: "Grande", factor: 1.2 },
  "muy-grande": { nombre: "Muy grande", factor: 1.4 },
};

export function leerTamanoAdmin(): TamanoAdmin {
  try { const v = localStorage.getItem(CLAVE) as TamanoAdmin; return v in TAMANOS_ADMIN ? v : "automatico"; } catch { return "automatico"; }
}
export function guardarTamanoAdmin(t: TamanoAdmin) {
  try { localStorage.setItem(CLAVE, t); } catch { /* sin almacenamiento */ }
  aplicarEscalaAdmin();
}
export function aplicarEscalaAdmin() {
  // Las escalas fraccionarias vuelven borrosas las letras en Windows: «Automático» NO escala (1) salvo que la ventana sea muy chica,
  // y entonces lo hace en pasos de 0.1. Los tamaños elegidos a mano (Compacto, Grande…) sí aplican su factor.
  const bruto = Math.min(window.innerWidth / BASE_ANCHO, window.innerHeight / BASE_ALTO);
  const auto = bruto >= 0.8 ? 1 : Math.max(0.7, Math.floor(bruto * 10) / 10);
  const escala = Math.max(0.6, Math.min(1.6, auto * TAMANOS_ADMIN[leerTamanoAdmin()].factor));
  document.documentElement.style.setProperty("--escala", (Math.round(escala * 100) / 100).toString());
}
export function iniciarEscalaAdmin() {
  aplicarEscalaAdmin();
  window.addEventListener("resize", aplicarEscalaAdmin);
}
