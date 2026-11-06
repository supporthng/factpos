import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { ErrorNegocio } from "./db.js";

/**
 * Aprobaciones del supervisor.
 *
 * 1. El supervisor teclea su PIN en la terminal → /autorizar verifica que
 *    tenga el permiso y devuelve una AUTORIZACIÓN firmada, válida 10 minutos,
 *    para una acción concreta en esa caja.
 * 2. La terminal envía esa autorización junto con la acción (descuento,
 *    anulación…). El servidor la verifica y guarda quién aprobó.
 * El PIN nunca viaja dos veces ni queda guardado en la terminal.
 *
 * PIN_SECRETO debe ser el mismo en la central y en las sucursales
 * (los usuarios y sus PIN se sincronizan desde la central).
 */
// Se lee en cada uso: el alta de un servidor nuevo lo recibe de la central sin reiniciar
const secreto = () => process.env.PIN_SECRETO ?? "factpos-desarrollo-cambiar-en-produccion";
const VIGENCIA_MS = 10 * 60 * 1000;

export type Permiso = "venta.descuento" | "venta.precio" | "venta.anular" | "venta.corregir" | "cliente.precio" | "caja.retiro" | "caja.gasto" | "caja.salir" | "venta.credito";

export const hashPin = (empresaId: string, pin: string) =>
  createHmac("sha256", secreto()).update(`${empresaId}:${pin}`).digest("hex");

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const firmar = (cuerpo: string) => createHmac("sha256", secreto()).update(cuerpo).digest("base64url");

export interface Autorizacion { supervisorId: string; supervisor: string; permiso: Permiso; cajaId: string; expira: number }

export async function autorizarConPin(c: Pick<PoolClient, "query">, empresaId: string, cajaId: string, pin: string, permiso: Permiso) {
  const r = await c.query<{ id: string; nombre: string; permisos: string[] }>(
    `SELECT u.id, u.nombre, ro.permisos FROM usuarios u JOIN roles ro ON ro.id = u.rol_id
      WHERE u.empresa_id = $1 AND u.pin_hash = $2 AND u.activo`,
    [empresaId, hashPin(empresaId, pin)],
  );
  const u = r.rows[0];
  if (!u) throw new ErrorNegocio("PIN incorrecto", 401);
  // Salir con el turno abierto lo autoriza quien tenga ese permiso o sea supervisor (puede anular ventas)
  const tiene = u.permisos.includes("*") || u.permisos.includes(permiso) || (permiso === "caja.salir" && u.permisos.includes("venta.anular"));
  if (!tiene) {
    throw new ErrorNegocio(`${u.nombre} no tiene permiso para autorizar esta acción`, 403);
  }
  const a: Autorizacion = { supervisorId: u.id, supervisor: u.nombre, permiso, cajaId, expira: Date.now() + VIGENCIA_MS };
  const cuerpo = b64(JSON.stringify(a));
  return { token: `${cuerpo}.${firmar(cuerpo)}`, supervisor: u.nombre, expira: new Date(a.expira).toISOString() };
}

/**
 * ¿Este PIN es de un administrador o supervisor? (quien puede aprobar «caja.salir»: administrador, permiso propio o anular ventas).
 * Devuelve su nombre; lo usan las apps del verificador para cerrarse o cambiar de servidor.
 */
export async function supervisorPorPin(c: Pick<PoolClient, "query">, empresaId: string, pin: string): Promise<string> {
  const r = await c.query<{ nombre: string; permisos: string[] }>(
    `SELECT u.nombre, ro.permisos FROM usuarios u JOIN roles ro ON ro.id = u.rol_id
      WHERE u.empresa_id = $1 AND u.pin_hash = $2 AND u.activo`,
    [empresaId, hashPin(empresaId, pin)],
  );
  const u = r.rows[0];
  if (!u) throw new ErrorNegocio("PIN incorrecto", 401);
  if (!(u.permisos.includes("*") || u.permisos.includes("caja.salir") || u.permisos.includes("venta.anular"))) {
    throw new ErrorNegocio(`${u.nombre} no es administrador ni supervisor`, 403);
  }
  return u.nombre;
}

/** Autorización firmada para un usuario ya autenticado con el permiso (p. ej. el administrador que corrige una factura). */
export function autorizacionDirecta(supervisorId: string, supervisor: string, permiso: Permiso, cajaId: string): string {
  const a: Autorizacion = { supervisorId, supervisor, permiso, cajaId, expira: Date.now() + VIGENCIA_MS };
  const cuerpo = b64(JSON.stringify(a));
  return `${cuerpo}.${firmar(cuerpo)}`;
}

export function verificarAutorizacion(token: string | undefined, permiso: Permiso | Permiso[], cajaId: string): Autorizacion {
  if (!token) throw new ErrorNegocio("Esta acción requiere la aprobación de un supervisor", 403);
  const [cuerpo, firma] = token.split(".");
  const esperada = firmar(cuerpo ?? "");
  if (!firma || firma.length !== esperada.length || !timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) {
    throw new ErrorNegocio("Autorización inválida", 403);
  }
  const a: Autorizacion = JSON.parse(Buffer.from(cuerpo, "base64url").toString());
  if (!(Array.isArray(permiso) ? permiso : [permiso]).includes(a.permiso) || a.cajaId !== cajaId) throw new ErrorNegocio("La autorización no corresponde a esta acción", 403);
  if (a.expira < Date.now()) throw new ErrorNegocio("La autorización venció; pida la aprobación otra vez", 403);
  return a;
}
