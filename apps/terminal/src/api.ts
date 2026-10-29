/** Conexión con el servidor local de la sucursal. */
const CLAVE = "factpos.terminal";

export interface Ajustes {
  servidor: string; // http://192.168.1.10:3000
  cajaId: string;
}

export function leerAjustes(): Ajustes | null {
  try {
    const v = localStorage.getItem(CLAVE);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export function guardarAjustes(a: Ajustes) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(a));
  } catch {
    /* almacenamiento no disponible */
  }
}

// --------------------------------------------------------------- Sesión del cajero
/** Quien entró con su PIN. Se guarda para que recargar la pantalla no lo saque. */
const CLAVE_SESION = "factpos.sesion-caja";
export interface SesionCaja { token: string; usuario: { id: string; nombre: string }; cajaId: string }
let sesion: SesionCaja | null = null;
try {
  const v = localStorage.getItem(CLAVE_SESION);
  sesion = v ? JSON.parse(v) : null;
  // Vencida (16 h): se descarta
  if (sesion && JSON.parse(atob(sesion.token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).exp < Date.now()) sesion = null;
} catch { sesion = null; }

export const sesionCaja = () => sesion;
export function fijarSesionCaja(s: SesionCaja | null) {
  sesion = s;
  try {
    if (s) localStorage.setItem(CLAVE_SESION, JSON.stringify(s));
    else localStorage.removeItem(CLAVE_SESION);
  } catch { /* sin almacenamiento */ }
}

/** Aviso cuando una petición no llega al servidor (lo usa la contingencia). */
let perdida: (() => void) | null = null;
export const alPerderConexion = (f: () => void) => { perdida = f; };

export class ErrorApi extends Error {
  constructor(mensaje: string, public estado: number) {
    super(mensaje);
  }
}

export async function api<T = any>(servidor: string, ruta: string, opciones: { metodo?: string; cuerpo?: unknown } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(servidor.replace(/\/$/, "") + ruta, {
      method: opciones.metodo ?? (opciones.cuerpo ? "POST" : "GET"),
      headers: {
        ...(opciones.cuerpo ? { "content-type": "application/json" } : {}),
        ...(sesion ? { "x-sesion-caja": sesion.token } : {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });
  } catch {
    perdida?.();
    throw new ErrorApi("No hay conexión con el servidor de la sucursal", 0);
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    // La sesión venció o es de otra caja: se vuelve a pedir el PIN
    if (r.status === 401 && datos.sesion) window.dispatchEvent(new Event("factpos:sesion-vencida"));
    throw new ErrorApi(datos.error ?? `Error ${r.status}`, r.status);
  }
  return datos as T;
}

export const rd = (v: string | number) =>
  "RD$" + Number(v).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
