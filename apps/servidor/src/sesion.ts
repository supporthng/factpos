import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Inicio de sesión y permisos.
 *
 *  - Administración: usuario + contraseña → sesión firmada (12 horas).
 *  - Caja: el cajero elige su nombre y teclea su PIN → sesión de esa caja (16 horas).
 *  - Servidor de sucursal → nube: clave de conexión propia de cada sucursal.
 *
 * Las sesiones son textos firmados con HMAC (no se guardan en la base): así
 * funcionan igual en Vercel (muchas instancias) y en el servidor local.
 */
const scrypt = promisify(scryptCb) as (clave: string, sal: Buffer, largo: number) => Promise<Buffer>;
const secreto = () => process.env.SESION_SECRETO ?? process.env.PIN_SECRETO ?? "factpos-desarrollo-cambiar-en-produccion";

// --------------------------------------------------------------- Contraseñas
export async function hashClave(clave: string) {
  const sal = randomBytes(16);
  const h = await scrypt(clave, sal, 32);
  return `scrypt$${sal.toString("base64url")}$${h.toString("base64url")}`;
}

export async function verificarClave(clave: string, guardado: string | null | undefined) {
  if (!guardado?.startsWith("scrypt$")) return false;
  const [, sal, h] = guardado.split("$");
  const calc = await scrypt(clave, Buffer.from(sal, "base64url"), 32);
  const esperado = Buffer.from(h, "base64url");
  return esperado.length === calc.length && timingSafeEqual(esperado, calc);
}

/** Contraseña aceptable: 4 caracteres o más. */
export function claveSegura(clave: string) {
  if (clave.length < 4) return "La contraseña debe tener al menos 4 caracteres";
  return null;
}

// --------------------------------------------------------------- Sesiones
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const firmar = (cuerpo: string) => createHmac("sha256", secreto()).update(`sesion:${cuerpo}`).digest("base64url");

export interface SesionAdmin { t: "admin"; u: string; e: string; n: string; p: string[]; exp: number }
export interface SesionCaja { t: "caja"; u: string; e: string; c: string; n: string; p: string[]; exp: number }
export type Sesion = SesionAdmin | SesionCaja;

/**
 * Sucursales que puede ver/operar el usuario de la administración (null = todas).
 * Lo pone el gancho de sesiones en la cabecera x-sucursales, nunca el navegador.
 */
export function sucursalesDe(req: { headers: Record<string, unknown> }): string[] | null {
  const h = req.headers["x-sucursales"];
  return typeof h === "string" && h ? h.split(",") : null;
}

export function crearToken(s: Omit<SesionAdmin, "exp"> | Omit<SesionCaja, "exp">, horas: number) {
  const cuerpo = b64(JSON.stringify({ ...s, exp: Date.now() + horas * 3600_000 }));
  return `${cuerpo}.${firmar(cuerpo)}`;
}

export function leerToken(token: string | undefined | null): Sesion | null {
  if (!token) return null;
  const [cuerpo, firma] = token.split(".");
  if (!cuerpo || !firma) return null;
  const esperada = firmar(cuerpo);
  if (firma.length !== esperada.length || !timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const s = JSON.parse(Buffer.from(cuerpo, "base64url").toString()) as Sesion;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export const tienePermiso = (permisos: string[], p: string) => permisos.includes("*") || permisos.includes(p);

// --------------------------------------------------------------- Catálogo de permisos
/** Lo que se puede marcar en cada rol (pantalla Usuarios y roles). */
export const PERMISOS: { id: string; grupo: "Caja" | "Administración"; nombre: string }[] = [
  { id: "venta.crear", grupo: "Caja", nombre: "Vender y abrir/cerrar su turno" },
  { id: "venta.descuento", grupo: "Caja", nombre: "Aprobar descuentos" },
  { id: "venta.anular", grupo: "Caja", nombre: "Aprobar anulaciones" },
  { id: "venta.corregir", grupo: "Caja", nombre: "Aprobar correcciones de factura" },
  { id: "cliente.precio", grupo: "Caja", nombre: "Cambiar el nivel de precio de un cliente" },
  { id: "caja.retiro", grupo: "Caja", nombre: "Aprobar retiros de efectivo" },
  { id: "caja.gasto", grupo: "Caja", nombre: "Aprobar gastos pagados desde la caja" },
  { id: "cxc.abono", grupo: "Caja", nombre: "Cobrar abonos de clientes a crédito" },
  { id: "admin.productos", grupo: "Administración", nombre: "Productos, categorías y proveedores" },
  { id: "admin.precios", grupo: "Administración", nombre: "Precios y ofertas" },
  { id: "admin.compras", grupo: "Administración", nombre: "Registrar compras" },
  { id: "admin.inventario", grupo: "Administración", nombre: "Ajustes, conteos y mínimos" },
  { id: "admin.traspasos", grupo: "Administración", nombre: "Pedidos y despacho de traspasos" },
  { id: "admin.recibir", grupo: "Administración", nombre: "Recibir traspasos en su tienda" },
  { id: "admin.cxc", grupo: "Administración", nombre: "Cuentas por cobrar" },
  { id: "admin.reportes", grupo: "Administración", nombre: "Ver reportes y resumen" },
  { id: "admin.fiscal", grupo: "Administración", nombre: "Facturación electrónica y padrón" },
  { id: "admin.config", grupo: "Administración", nombre: "Sucursales, terminales y marca" },
  { id: "admin.usuarios", grupo: "Administración", nombre: "Usuarios, roles y contraseñas" },
];

/**
 * Permiso que exige cada ruta de la administración.
 * Lectura (GET): basta con tener sesión, salvo usuarios/roles.
 * Escritura: el permiso de la sección. null = cualquier usuario con sesión.
 */
export function permisoDeRuta(metodo: string, ruta: string): string | null {
  const escribe = metodo !== "GET" && metodo !== "HEAD";
  if (ruta.startsWith("/central/usuarios") || ruta.startsWith("/central/roles")) return "admin.usuarios";
  if (!escribe) return null;
  if (/^\/central\/traspasos\/[^/]+\/recibir$/.test(ruta)) return "admin.recibir";
  const mapa: [RegExp, string][] = [
    [/^\/central\/(productos|categorias|proveedores)/, "admin.productos"],
    [/^\/central\/(precios|ofertas|cupones|empresa\/precios-por-sucursal)/, "admin.precios"],
    [/^\/central\/compras/, "admin.compras"],
    [/^\/central\/(inventario|ajustes|conteos|productos-existencia)/, "admin.inventario"],
    [/^\/central\/(traspasos|pedidos-sucursal)/, "admin.traspasos"],
    [/^\/central\/cxc/, "admin.cxc"],
    [/^\/central\/(fiscal|padron)/, "admin.fiscal"],
    [/^\/central\/(sucursales|terminales|marca|repartidores|incidentes|correo|alta)/, "admin.config"],
  ];
  return mapa.find(([re]) => re.test(ruta))?.[1] ?? "*";
}

/** Puede entrar a la administración quien tenga al menos un permiso de administración. */
export const puedeAdministrar = (permisos: string[]) => permisos.includes("*") || permisos.some((p) => p.startsWith("admin."));
