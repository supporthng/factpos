/**
 * Tamaño de la pantalla de la Administración (por equipo).
 * «Automático» se adapta a la ventana: en una pantalla chica todo se reduce para que quepa y en una grande se deja
 * tal cual. Además se puede elegir más compacto o más grande.
 */
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
  // «Automático» ya NO reduce la pantalla (en ventanas chicas dejaba las letras diminutas y deformaba el diseño): se ve a tamaño normal y
  // la página se desplaza si hace falta. Solo cambia el tamaño si la persona elige Compacto, Grande o Muy grande.
  const escala = Math.max(0.6, Math.min(1.6, TAMANOS_ADMIN[leerTamanoAdmin()].factor));
  document.documentElement.style.setProperty("--escala", (Math.round(escala * 100) / 100).toString());
}
export function iniciarEscalaAdmin() {
  aplicarEscalaAdmin();
  window.addEventListener("resize", aplicarEscalaAdmin);
}
