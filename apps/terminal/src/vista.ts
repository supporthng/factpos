/** Con qué vista abre la caja: Caja clásica (escáner), Caja táctil (catálogo) o la última que se usó. Es una preferencia de cada caja. */
export type VistaInicial = "recordar" | "escaner" | "catalogo";
const clave = (cajaId: string) => `factpos.caja.${cajaId}.vistaInicial`;
const claveModo = (cajaId: string) => `factpos.caja.${cajaId}.modalidad`;

export function leerVistaInicial(cajaId: string): VistaInicial {
  try { const v = localStorage.getItem(clave(cajaId)); return v === "escaner" || v === "catalogo" ? v : "recordar"; } catch { return "recordar"; }
}
export function guardarVistaInicial(cajaId: string, v: VistaInicial) {
  try { if (v === "recordar") localStorage.removeItem(clave(cajaId)); else localStorage.setItem(clave(cajaId), v); } catch { /* sin almacenamiento */ }
}
/** La vista con la que abre la caja ahora. */
export function modoInicial(cajaId: string): "escaner" | "catalogo" {
  const v = leerVistaInicial(cajaId);
  if (v !== "recordar") return v;
  try {
    const guardado = localStorage.getItem(claveModo(cajaId)) ?? localStorage.getItem("factpos.modo");
    return guardado === "catalogo" ? "catalogo" : "escaner";
  } catch { return "escaner"; }
}
