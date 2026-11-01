/**
 * Pantalla del cliente: la caja (ventana principal) publica lo que se vende y la segunda ventana lo muestra.
 * Viajan por BroadcastChannel (mismo equipo, mismo navegador); la última foto queda en localStorage para
 * que la ventana del cliente aparezca ya al día si se abre o se recarga a mitad de una venta.
 */
export interface OfertaPantalla { id: string; titulo: string; texto: string; precio: string; imagen: string | null; activa: boolean; desde: string | null; hasta: string | null }
export interface ConfigPantalla { activa: boolean; bienvenida: string; segundos: number; ofertas: OfertaPantalla[] }
export interface DatosMarca { empresa: string; logo: string | null; primario: string; secundario: string | null; pantalla: Partial<ConfigPantalla> }
export interface LineaPantalla { nombre: string; cantidad: string; precio: string; total: string; descuento: string }
export interface Carrito { fase: "venta" | "cobro"; /** Solo con comprobante fiscal (a nombre del cliente); si no, nunca se muestra */ cliente?: string | null; lineas: LineaPantalla[]; subtotal: string; descuento: string; itbis: string; total: string }
export interface Gracias { total: string; cambio: string; en: number }

const CANAL = "factpos-pantalla-cliente";
const K_MARCA = "factpos.pc.marca", K_CARRITO = "factpos.pc.carrito", K_GRACIAS = "factpos.pc.gracias";
export type Mensaje = { tipo: "marca"; d: DatosMarca } | { tipo: "carrito"; d: Carrito } | { tipo: "gracias"; d: Gracias };

let canal: BroadcastChannel | null = null;
const abrir = () => (canal ??= typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CANAL));
let ultimaMarca = "";

function guardar(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }
export function leerGuardado<T>(k: "marca" | "carrito" | "gracias"): T | null {
  try { return JSON.parse(localStorage.getItem({ marca: K_MARCA, carrito: K_CARRITO, gracias: K_GRACIAS }[k]) ?? "null"); } catch { return null; }
}

export function publicarMarca(d: DatosMarca) {
  const t = JSON.stringify(d);
  if (t === ultimaMarca) return;          // las imágenes pesan: solo se reenvía si cambió
  ultimaMarca = t;
  guardar(K_MARCA, d);
  abrir()?.postMessage({ tipo: "marca", d } satisfies Mensaje);
}
export function publicarCarrito(d: Carrito) {
  guardar(K_CARRITO, d);
  abrir()?.postMessage({ tipo: "carrito", d } satisfies Mensaje);
}
export function publicarGracias(d: Gracias) {
  guardar(K_GRACIAS, d);
  abrir()?.postMessage({ tipo: "gracias", d } satisfies Mensaje);
}
export function escuchar(fn: (m: Mensaje) => void) {
  const c = new BroadcastChannel(CANAL);
  c.onmessage = (e) => fn(e.data as Mensaje);
  return () => c.close();
}

/** Abre la segunda ventana (en la aplicación de escritorio la abre en la otra pantalla). */
export function abrirPantallaCliente() {
  window.open(location.pathname + location.search + "#/cliente", "factpos-pantalla-cliente", "popup,width=1100,height=700");
}
