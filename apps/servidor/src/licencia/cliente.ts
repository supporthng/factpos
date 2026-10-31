import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { estadoTunel, pedirTunelFijo, reportarTunel, tunelActivo } from "../tunel.js";
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
  // Master: con la licencia activa ya puede tener su dirección fija (<empresa>.factpos.app)
  const { guardarEnEnv } = await import("../sync/alta.js");
  pedirTunelFijo(PORTAL_URL(), guardarEnEnv).catch(() => false);
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


// ----------------------------------------------------------------- solicitud de activación
/**
 * El cliente prueba FactPOS 15 días. Si le interesa, pulsa «Solicitar activación», elige el plan y manda sus datos
 * (empresa, RNC, correo, teléfono). La solicitud llega al portal; el proveedor lo contacta (en el plazo que él defina),
 * confirma el pago y la aprueba. Entonces la licencia llega sola a esta instalación.
 * Hasta que el cliente pida la activación, esta instalación NO le dice nada al portal.
 */
export type EstadoSolicitud = { estado: "PENDIENTE" | "ASIGNADA" | "RECHAZADA" | "LIBERADA" | "SUSPENDIDA"; revisada: string } | null;
let solicitud: EstadoSolicitud = null;
let ultimaSolicitud = 0;
export const estadoSolicitud = () => solicitud;

export const DatosSolicitud = z.object({
  empresa: z.string().trim().min(2, "Escriba el nombre de la empresa").max(120),
  rnc: z.string().trim().regex(/^\d{9}(\d{2})?$/, "El RNC debe tener 9 u 11 dígitos"),
  correo: z.string().trim().email("Correo inválido").max(120),
  telefono: z.string().trim().min(7, "Teléfono inválido").max(30),
  contacto: z.string().trim().max(120).nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  sucursales: z.number().int().min(1).max(999),
  mensaje: z.string().trim().max(500).nullable().optional(),
});

/** Aplica lo que respondió el portal: si ya la aprobaron, guarda la licencia. */
async function aplicarRespuesta(f: FilaLicencia, r: { estado: NonNullable<EstadoSolicitud>["estado"]; secreto?: string; licencia?: string }) {
  if (r.secreto) await pool.query("UPDATE licencia SET secreto = $1, portal_url = $2, actualizado_en = now() WHERE id = 1", [r.secreto, PORTAL_URL()]);
  if (r.estado === "ASIGNADA" && r.licencia) {
    const e = evaluarLicencia(r.licencia, { instalacion: f.instalacion_id });
    if (e.error) throw new ErrorNegocio(`El portal devolvió una licencia que no se pudo verificar: ${e.error}`, 502);
    await pool.query("UPDATE licencia SET token = $1, ultimo_contacto = now(), ultimo_error = NULL, actualizado_en = now() WHERE id = 1", [r.licencia]);
    olvidarLicencia();
    await reportarTunel(PORTAL_URL()).catch(() => false);
    const { guardarEnEnv } = await import("../sync/alta.js");
    pedirTunelFijo(PORTAL_URL(), guardarEnEnv).catch(() => false);
  }
  solicitud = { estado: r.estado, revisada: new Date().toISOString() };
}

export async function enviarSolicitudActivacion(datos: z.infer<typeof DatosSolicitud>) {
  const f = await filaLicencia();
  if (f.token) throw new ErrorNegocio("Esta instalación ya tiene licencia", 409);
  const r = await llamarPortal<{ estado: NonNullable<EstadoSolicitud>["estado"]; secreto?: string; licencia?: string }>("/licencias/solicitar", {
    instalacionId: f.instalacion_id, secreto: f.secreto ?? undefined, version: versionApp(), sucursalesEnUso: await sucursalesEnUso(),
    apiUrl: estadoTunel().url ?? undefined, solicitud: { ...datos, equipo: hostname().slice(0, 80) },
  });
  await pool.query("UPDATE licencia SET solicitud_enviada_en = now(), solicitud_datos = $1 WHERE id = 1", [JSON.stringify(datos)]);
  await aplicarRespuesta(f, r);
  return solicitud;
}

/** Consulta si ya aprobaron la solicitud (solo si el cliente la envió). */
export async function sincronizarSolicitud(forzar = false): Promise<EstadoSolicitud> {
  if (!forzar && Date.now() - ultimaSolicitud < 5 * 60_000) return solicitud;
  ultimaSolicitud = Date.now();
  const f = await filaLicencia();
  if (f.token || !f.secreto || !(await solicitudEnviada())) return solicitud;
  const r = await llamarPortal<{ estado: NonNullable<EstadoSolicitud>["estado"]; secreto?: string; licencia?: string }>("/licencias/solicitar", {
    instalacionId: f.instalacion_id, secreto: f.secreto, version: versionApp(), sucursalesEnUso: await sucursalesEnUso(),
  });
  await aplicarRespuesta(f, r);
  return solicitud;
}

async function solicitudEnviada() {
  const r = (await pool.query<{ solicitud_enviada_en: string | null; solicitud_datos: Record<string, unknown> | null }>(
    "SELECT solicitud_enviada_en, solicitud_datos FROM licencia WHERE id = 1").catch(() => ({ rows: [] as { solicitud_enviada_en: string | null; solicitud_datos: Record<string, unknown> | null }[] }))).rows[0];
  return r?.solicitud_enviada_en ? { enviadaEn: r.solicitud_enviada_en, datos: r.solicitud_datos } : null;
}

/** Planes que ofrece el proveedor (para el formulario). Sin internet, lista vacía. */
let cachePlanes: { p: unknown[]; t: number } | null = null;
export async function planesPortal(): Promise<unknown[]> {
  if (cachePlanes && Date.now() - cachePlanes.t < 30 * 60_000) return cachePlanes.p;
  try {
    const r = await fetch(`${PORTAL_URL()}/licencias/planes`, { signal: AbortSignal.timeout(8_000) });
    const p = r.ok ? ((await r.json()) as unknown[]) : [];
    cachePlanes = { p, t: Date.now() };
    return p;
  } catch { return cachePlanes?.p ?? []; }
}

/** Lo llama la vigilancia (cron): renueva si pasaron más de 12 h desde el último contacto. */
export async function renovarSiToca(log?: (m: string) => void) {
  if (config.modo !== "central" && !(config.modo === "sucursal" && !syncActiva())) return;
  const f = await filaLicencia();
  if (!f.token) { await sincronizarSolicitud().catch(() => {}); return; } // sin licencia: consulta si aprobaron su solicitud
  if (!f.secreto) return;
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

/** Reglas y contacto del proveedor (Portal › Reglas). Se consulta poco y, sin internet, simplemente no hay datos. */
export interface Politica { pruebaActualiza: boolean; contacto: { nombre: string | null; telefono: string | null; whatsapp: string | null; correo: string | null } }
let cachePolitica: { p: Politica | null; t: number } | null = null;
export async function politicaPortal(): Promise<Politica | null> {
  if (cachePolitica && Date.now() - cachePolitica.t < 30 * 60_000) return cachePolitica.p;
  try {
    const r = await fetch(`${PORTAL_URL()}/licencias/politica`, { signal: AbortSignal.timeout(6_000) });
    const p = r.ok ? ((await r.json()) as Politica) : null;
    cachePolitica = { p, t: Date.now() };
    return p;
  } catch { return cachePolitica?.p ?? null; }
}

const publico = (r: ResultadoLicencia) => ({
  plan: r.datos?.plan ?? null,
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
    const e = await estadoLicencia();
    return {
      ...publico(e), local: true,
      instalacionId: f.instalacion_id, licenciaId: e.datos?.id ?? null, activada: !!f.token, ultimoContacto: f.ultimo_contacto, ultimoError: null,
      portal: PORTAL_URL(), sucursalesEnUso: await sucursalesEnUso(), politica: await politicaPortal(),
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
      instalacionId: f.instalacion_id, licenciaId: e.datos?.id ?? null, activada: !!f.token, ultimoContacto: f.ultimo_contacto, ultimoError: f.ultimo_error,
      portal: PORTAL_URL(), sucursalesEnUso: await sucursalesEnUso(), politica: await politicaPortal(), solicitud: estadoSolicitud(), solicitudEnviada: await solicitudEnviada(),
      empresa: (await pool.query("SELECT COALESCE(nombre_comercial, razon_social) AS nombre, rnc FROM empresas ORDER BY actualizado_en LIMIT 1").catch(() => ({ rows: [] }))).rows[0] ?? null,
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
  /** Archivo de la licencia aplicada (para guardarla o respaldarla). */
  app.get("/central/licencia/archivo", async () => {
    const f = await filaLicencia();
    if (!f.token) throw new ErrorNegocio("Esta instalación todavía no tiene licencia", 404);
    const e = evaluarLicencia(f.token, { instalacion: f.instalacion_id });
    const slug = (e.datos?.cliente.slug ?? "licencia").replace(/[^a-z0-9-]/gi, "");
    return { nombre: `licencia-factpos-${slug}.fpslic`, contenido: f.token.trim() + "\n" };
  });
  app.post("/central/licencia/renovar", async () => publico(await renovarLicencia()));
  /** «Comprobar ahora»: consulta al portal si ya aprobaron la solicitud de activación. */
  app.post("/central/licencia/comprobar", async () => {
    const sol = await sincronizarSolicitud(true).catch((e) => { throw e instanceof ErrorNegocio ? e : new ErrorNegocio((e as Error).message, 502); });
    return { solicitud: sol, ...publico(await estadoLicencia()) };
  });
  /** «Solicitar activación»: el cliente en prueba pide su licencia con sus datos y el plan que quiere. */
  app.post("/central/licencia/solicitar", async (req) => {
    const datos = DatosSolicitud.parse(req.body);
    const sol = await enviarSolicitudActivacion(datos);
    return { solicitud: sol, ...publico(await estadoLicencia()) };
  });
  app.get("/central/licencia/planes", async () => planesPortal());
}
