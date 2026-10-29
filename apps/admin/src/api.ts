/** Conexión con la administración central. */
const CLAVE = "factpos.admin";

export interface Sesion {
  servidor: string;   // URL de la central
  token: string;      // sesión firmada por el servidor (12 horas)
  empresaId: string;
  empresa: string;
  usuarioId: string;
  nombre: string;
  permisos: string[];
  /** Sucursales a las que tiene acceso (null = todas) */
  sucursales?: string[] | null;
}

export function leerSesion(): Sesion | null {
  try {
    const v = localStorage.getItem(CLAVE);
    const s = v ? JSON.parse(v) : null;
    return s?.token ? s : null; // sesiones viejas (sin contraseña) ya no sirven
  } catch {
    return null;
  }
}
export function guardarSesion(s: Sesion | null) {
  try {
    if (s) localStorage.setItem(CLAVE, JSON.stringify(s));
    else localStorage.removeItem(CLAVE);
  } catch { /* sin almacenamiento */ }
}

let sesion: Sesion | null = leerSesion();
export const fijarSesion = (s: Sesion | null) => { sesion = s; guardarSesion(s); };
export const sesionActual = () => sesion!;
export const puede = (permiso: string) => !!sesion && (sesion.permisos.includes("*") || sesion.permisos.includes(permiso));
/** Encabezados de autenticación para las descargas hechas con fetch directo. */
export const encabezados = (): Record<string, string> => (sesion ? { authorization: `Bearer ${sesion.token}` } : {});

export async function api<T = any>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; servidor?: string } = {}): Promise<T> {
  const base = (opciones.servidor ?? sesion?.servidor ?? "").replace(/\/$/, "");
  let r: Response;
  try {
    r = await fetch(base + ruta, {
      method: opciones.metodo ?? (opciones.cuerpo ? "POST" : "GET"),
      headers: {
        ...(opciones.cuerpo ? { "content-type": "application/json" } : {}),
        ...(sesion && !opciones.servidor ? encabezados() : {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });
  } catch {
    throw new Error("No hay conexión con la central");
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && datos.sesion) window.dispatchEvent(new Event("factpos:sesion-vencida"));
    throw new Error(datos.error ?? `Error ${r.status}`);
  }
  return datos as T;
}

export function urlCsv(ruta: string) {
  return `${sesion!.servidor.replace(/\/$/, "")}${ruta}${ruta.includes("?") ? "&" : "?"}formato=csv`;
}

/** Descarga CSV enviando el encabezado de empresa. */
export async function descargarCsv(ruta: string, nombre: string) {
  const r = await fetch(urlCsv(ruta), { headers: encabezados() });
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const rd = (v: string | number | null | undefined) =>
  "RD$" + Number(v ?? 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (v: string | number | null | undefined, dec = 0) =>
  Number(v ?? 0).toLocaleString("es-DO", { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const hoy = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
