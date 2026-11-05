/** Conexión con la administración central. */

/**
 * Configuración que pone el PORTAL al servir esta página:
 *   /             → { modo: "portal" }                      (clientes y licencias)
 *   /<cliente>/   → { modo: "cliente", slug, cliente, api } (la administración de ESE cliente)
 * Sin ella (servida por un servidor FactPOS o en desarrollo) funciona como siempre.
 */
export const CONFIG: { modo?: "portal" | "cliente"; slug?: string; cliente?: string; api?: string } =
  (window as unknown as { __FACTPOS__?: typeof CONFIG }).__FACTPOS__ ?? {};
export const enPortal = CONFIG.modo === "portal";
/** "sucursal" = administración LOCAL en el servidor de una tienda (sin internet); lo dice /central/sesion */
let modo: string | null = null;
export const fijarModoServidor = (m: string | null) => { modo = m; };
export const esLocal = () => modo === "sucursal";
// Cada cliente guarda su sesión aparte (todas las páginas comparten el dominio del portal)
const CLAVE = CONFIG.slug ? `factpos.admin:${CONFIG.slug}` : enPortal ? "factpos.admin:portal" : "factpos.admin";

// Credencial de este equipo para entrar por internet (la entrega el servidor al pedir acceso; ver SolicitarDispositivo)
const CLAVE_DISP = CONFIG.slug ? `factpos.dispositivo:${CONFIG.slug}` : "factpos.dispositivo";
// La credencial se guarda en varios sitios a la vez (memoria, localStorage, sessionStorage y cookie): si el navegador del celular
// borra o bloquea uno (pestaña privada, límites de Safari), los otros la conservan y el equipo no vuelve a pedir acceso.
let dispEnMemoria: string | null = null;
const COOKIE_DISP = "factpos_disp" + (CONFIG.slug ? "_" + CONFIG.slug : "");
const rutaCookie = CONFIG.slug ? "/" + CONFIG.slug : "/";
const leerCookie = (): string | null => { try { const m = document.cookie.split("; ").find((c) => c.startsWith(COOKIE_DISP + "=")); return m ? decodeURIComponent(m.slice(COOKIE_DISP.length + 1)) : null; } catch { return null; } };
export const leerDispositivo = (): string | null => {
  if (dispEnMemoria) return dispEnMemoria;
  let v: string | null = null;
  try { v = localStorage.getItem(CLAVE_DISP); } catch { /* sin almacenamiento */ }
  if (!v) { try { v = sessionStorage.getItem(CLAVE_DISP); } catch { /* sin almacenamiento */ } }
  if (!v) v = leerCookie();
  if (v) dispEnMemoria = v;
  return v;
};
export const fijarDispositivo = (d: string | null) => {
  dispEnMemoria = d;
  try { if (d) localStorage.setItem(CLAVE_DISP, d); else localStorage.removeItem(CLAVE_DISP); } catch { /* sin almacenamiento */ }
  try { if (d) sessionStorage.setItem(CLAVE_DISP, d); else sessionStorage.removeItem(CLAVE_DISP); } catch { /* sin almacenamiento */ }
  try { document.cookie = d ? `${COOKIE_DISP}=${encodeURIComponent(d)}; max-age=31536000; path=${rutaCookie}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}` : `${COOKIE_DISP}=; max-age=0; path=${rutaCookie}`; } catch { /* sin cookies */ }
};

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
    localStorage.removeItem(CLAVE); // versiones anteriores la dejaban guardada para siempre
    const v = sessionStorage.getItem(CLAVE);
    const s = v ? JSON.parse(v) : null;
    return s?.token ? s : null; // sesiones viejas (sin contraseña) ya no sirven
  } catch {
    return null;
  }
}
export function guardarSesion(s: Sesion | null) {
  try {
    // La sesión vive solo mientras la ventana está abierta: al cerrarla y abrirla de nuevo se piden las credenciales
    // (recargar la página no la pierde)
    if (s) sessionStorage.setItem(CLAVE, JSON.stringify(s));
    else sessionStorage.removeItem(CLAVE);
  } catch { /* sin almacenamiento */ }
}

let sesion: Sesion | null = leerSesion();
export const fijarSesion = (s: Sesion | null) => { sesion = s; guardarSesion(s); };
export const sesionActual = () => sesion!;
export const puede = (permiso: string) => !!sesion && (sesion.permisos.includes("*") || sesion.permisos.includes(permiso));
/** Encabezados de autenticación para las descargas hechas con fetch directo. */
export const encabezados = (): Record<string, string> => ({ ...(sesion ? { authorization: `Bearer ${sesion.token}` } : {}), ...(leerDispositivo() ? { "x-dispositivo": leerDispositivo()! } : {}) });

export async function api<T = any>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; servidor?: string } = {}): Promise<T> {
  const base = (opciones.servidor ?? sesion?.servidor ?? "").replace(/\/$/, "");
  let r: Response;
  try {
    r = await fetch(base + ruta, {
      method: opciones.metodo ?? (opciones.cuerpo ? "POST" : "GET"),
      headers: {
        ...(opciones.cuerpo ? { "content-type": "application/json" } : {}),
        ...(leerDispositivo() ? { "x-dispositivo": leerDispositivo()! } : {}),
        ...(sesion && !opciones.servidor ? encabezados() : {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });
  } catch {
    throw new Error("No hay conexión con la central");
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 403 && datos.dispositivo) window.dispatchEvent(new CustomEvent("factpos:dispositivo", { detail: { estado: datos.dispositivo, servidor: base } }));
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
