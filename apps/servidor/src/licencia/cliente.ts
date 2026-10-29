import { readFileSync } from "node:fs";
import { estadoTunel, reportarTunel, tunelActivo } from "../tunel.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { config } from "../config.js";
import { evaluarLicencia, type ResultadoLicencia } from "./nucleo.js";
import { syncActiva } from "../sync/sucursal.js";

/**
 * Licencia en la instalación de un CLIENTE.
 *
 *  - Nube del cliente (MODO=central): se activa con la clave que da el proveedor,
 *    se renueva sola cada 12 h con el portal y se manda a las sucursales en la
 *    sincronización. Controla cuántas sucursales (tiendas) puede tener activas.
 *  - Servidor de sucursal: recibe la licencia de su nube, la verifica con la
 *    llave pública (sin internet) y, si venció y pasó la gracia, no deja vender
 *    (solo consulta). Nunca se borra nada.
 *
 * Al portal solo viajan: id de licencia, id de esta instalación, versión y
 * cuántas sucursales hay activas. Ningún dato del negocio.
 */
export const PORTAL_URL = () => (process.env.FACTPOS_PORTAL_URL || "https://factpos.vercel.app").replace(/\/+$/, "");
const PRUEBA_SUCURSALES = 2;
const RENOVAR_CADA_MS = 12 * 3600_000;

interface FilaLicencia {
  instalacion_id: string; token: string | null; secreto: string | null; prueba_desde: string;
  ultimo_contacto: string | null; ultimo_error: string | null;
}

export async function filaLicencia(): Promise<FilaLicencia> {
  const r = await pool.query<FilaLicencia>("SELECT instalacion_id, token, secreto, prueba_desde, ultimo_contacto, ultimo_error FROM licencia WHERE id = 1");
  if (r.rows[0]) return r.rows[0];
  await pool.query("INSERT INTO licencia (id, instalacion_id) VALUES (1, $1) ON CONFLICT (id) DO NOTHING", [uuidv7()]);
  return (await pool.query<FilaLicencia>("SELECT instalacion_id, token, secreto, prueba_desde, ultimo_contacto, ultimo_error FROM licencia WHERE id = 1")).rows[0];
}

let cache: { r: ResultadoLicencia; t: number } | null = null;
export const olvidarLicencia = () => { cache = null; };
export async function estadoLicencia(): Promise<ResultadoLicencia> {
  if (cache && Date.now() - cache.t < 60_000) return cache.r;
  const f = await filaLicencia();
  const r = evaluarLicencia(f.token, { instalacion: f.instalacion_id, pruebaDesde: f.prueba_desde });
  cache = { r, t: Date.now() };
  return r;
}

/** Antes de vender (servidor de sucursal): con la licencia vencida solo se consulta. */
export async function exigirLicenciaParaVender() {
  const r = await estadoLicencia().catch(() => null);
  if (r && !r.permiteVender) throw new ErrorNegocio(r.mensaje ?? "La licencia de FactPOS no está vigente", 402);
}

/** Máximo de sucursales (tiendas) activas que permite la licencia (o la prueba). */
export async function verificarCupoSucursal(c: { query: typeof pool.query }, empresaId: string, excluir?: string) {
  const r = await estadoLicencia();
  const maximo = r.datos?.sucursales ?? PRUEBA_SUCURSALES;
  const n = (await c.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM sucursales WHERE empresa_id = $1 AND activo AND tipo = 'TIENDA' AND ($2::uuid IS NULL OR id <> $2)",
    [empresaId, excluir ?? null])).rows[0].n;
  if (n >= maximo) {
    throw new ErrorNegocio(r.datos
      ? `Su licencia permite ${maximo} sucursal(es) activas y ya tiene ${n}. Para agregar otra, amplíe su licencia con su proveedor de FactPOS.`
      : `La versión de prueba permite ${maximo} sucursales. Active su licencia en Administración › Licencia.`, 402);
  }
}

// -------------------------------------------------------------------------------- portal
async function llamarPortal<T>(ruta: string, cuerpo: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${PORTAL_URL()}${ruta}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ErrorNegocio("No hay conexión con el portal de licencias de FactPOS. Revise el internet e intente de nuevo.", 502);
  }
  const d = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new ErrorNegocio(d.error ?? `El portal de licencias respondió ${r.status}`, r.status >= 500 ? 502 : r.status);
  return d;
}

const sucursalesEnUso = async () =>
  (await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM sucursales WHERE activo AND tipo = 'TIENDA'")).rows[0].n;
let version: string | undefined;
const versionApp = () => {
  if (version) return version;
  try {
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    version = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8")).version;
  } catch { version = process.env.npm_package_version; }
  return version;
};

export async function activarLicencia(clave: string, apiUrl?: string) {
  const f = await filaLicencia();
  apiUrl = estadoTunel().url ?? apiUrl; // master con túnel: la web y las sucursales entran por ahí
  const r = await llamarPortal<{ licencia: string; secreto: string; cliente: { nombre: string } }>("/licencias/activar", {
    clave, instalacionId: f.instalacion_id, version: versionApp(), sucursalesEnUso: await sucursalesEnUso(), apiUrl,
  });
  const e = evaluarLicencia(r.licencia, { instalacion: f.instalacion_id });
  if (e.error) throw new ErrorNegocio(`El portal devolvió una licencia que no se pudo verificar: ${e.error}`, 502);
  await pool.query("UPDATE licencia SET token = $1, secreto = $2, portal_url = $3, ultimo_contacto = now(), ultimo_error = NULL, actualizado_en = now() WHERE id = 1",
    [r.licencia, r.secreto, PORTAL_URL()]);
  olvidarLicencia();
  await reportarTunel(PORTAL_URL()).catch(() => false);
  return estadoLicencia();
}

export async function renovarLicencia() {
  const f = await filaLicencia();
  if (!f.token || !f.secreto) throw new ErrorNegocio("Esta instalación todavía no tiene licencia: actívela con su clave", 409);
  const actual = evaluarLicencia(f.token, { instalacion: f.instalacion_id });
  try {
    const r = await llamarPortal<{ licencia: string }>("/licencias/renovar", {
      licenciaId: actual.datos?.id, instalacionId: f.instalacion_id, secreto: f.secreto, version: versionApp(), sucursalesEnUso: await sucursalesEnUso(),
    });
    const e = evaluarLicencia(r.licencia, { instalacion: f.instalacion_id });
    if (e.error) throw new ErrorNegocio(`Licencia recibida inválida: ${e.error}`, 502);
    await pool.query("UPDATE licencia SET token = $1, ultimo_contacto = now(), ultimo_error = NULL, actualizado_en = now() WHERE id = 1", [r.licencia]);
  } catch (err) {
    // Se conserva la licencia que había: sigue valiendo hasta su fecha
    await pool.query("UPDATE licencia SET ultimo_error = $1 WHERE id = 1", [(err as Error).message.slice(0, 300)]);
    olvidarLicencia();
    throw err;
  }
  olvidarLicencia();
  return estadoLicencia();
}

/** Lo llama la vigilancia (cron): renueva si pasaron más de 12 h desde el último contacto. */
export async function renovarSiToca(log?: (m: string) => void) {
  if (config.modo !== "central" && !(config.modo === "sucursal" && !syncActiva())) return;
  const f = await filaLicencia();
  if (!f.token || !f.secreto) return;
  if (f.ultimo_contacto && Date.now() - new Date(f.ultimo_contacto).getTime() < RENOVAR_CADA_MS) return;
  await renovarLicencia().then(() => log?.("Licencia: renovada con el portal")).catch((e) => log?.(`Licencia: no se pudo renovar (${(e as Error).message})`));
}

/** Para la sincronización: lo que baja a las sucursales (sin el secreto). */
export async function licenciaParaSucursal() {
  const f = await filaLicencia();
  return { token: f.token, instalacionId: f.instalacion_id, pruebaDesde: f.prueba_desde };
}
/** En la sucursal: guarda la licencia que mandó su nube. */
export async function guardarLicenciaDeCentral(l: { token: string | null; instalacionId: string; pruebaDesde: string } | undefined) {
  if (!l) return;
  await pool.query(
    `INSERT INTO licencia (id, instalacion_id, token, prueba_desde) VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET instalacion_id = $1, token = $2, prueba_desde = $3, ultimo_contacto = now(), actualizado_en = now()
      WHERE licencia.token IS DISTINCT FROM $2 OR licencia.instalacion_id <> $1 OR licencia.prueba_desde <> $3`,
    [l.instalacionId, l.token, l.pruebaDesde]);
  olvidarLicencia();
}

const publico = (r: ResultadoLicencia) => ({
  estado: r.estado, permiteVender: r.permiteVender, dias: r.dias, mensaje: r.mensaje, error: r.error ?? null,
  cliente: r.datos?.cliente.nombre ?? null, sucursales: r.datos?.sucursales ?? null, vence: r.datos?.vence ?? null, modulos: r.datos?.modulos ?? [],
});

/** Servidor de sucursal: estado para la caja (aviso y bloqueo). */
export async function rutasLicenciaSucursal(app: FastifyInstance) {
  app.get("/licencia/estado", async () => publico(await estadoLicencia()));
  if (!syncActiva()) return; // tienda sola: usa la página completa (rutasLicenciaCentral)
  // Administración local: la licencia se ve, pero se activa y renueva en la nube
  app.get("/central/licencia", async () => {
    const f = await filaLicencia();
    return {
      ...publico(await estadoLicencia()), local: true,
      instalacionId: f.instalacion_id, activada: !!f.token, ultimoContacto: f.ultimo_contacto, ultimoError: null,
      portal: PORTAL_URL(), sucursalesEnUso: await sucursalesEnUso(),
    };
  });
}

/** Nube del cliente: página Administración › Licencia. */
export async function rutasLicenciaCentral(app: FastifyInstance) {
  app.get("/central/licencia", async () => {
    const f = await filaLicencia();
    // Si toca, se renueva en segundo plano (no hace esperar a la pantalla)
    renovarSiToca().catch(() => {});
    const e = await estadoLicencia();
    return {
      ...publico(e),
      instalacionId: f.instalacion_id, activada: !!f.token, ultimoContacto: f.ultimo_contacto, ultimoError: f.ultimo_error,
      portal: PORTAL_URL(), sucursalesEnUso: await sucursalesEnUso(),
      // Servidor master: dirección pública y acceso web por el portal
      tunel: tunelActivo() ? estadoTunel() : null,
      web: e.datos ? `${PORTAL_URL()}/${e.datos.cliente.slug}/` : null,
    };
  });
  app.post("/central/licencia/activar", async (req) => {
    const b = z.object({ clave: z.string().trim().min(16).max(40) }).parse(req.body);
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    const apiUrl = host ? `https://${String(host).split(",")[0]}` : undefined;
    return publico(await activarLicencia(b.clave, apiUrl?.includes("localhost") ? undefined : apiUrl));
  });
  app.post("/central/licencia/renovar", async () => publico(await renovarLicencia()));
}
