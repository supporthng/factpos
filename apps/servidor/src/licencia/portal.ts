import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { asegurarTunel, cloudflareListo } from "./cloudflare.js";
import { firmarLicencia, leerLicencia, DIAS_AVISO, DIAS_GRACIA, type DatosLicencia } from "./nucleo.js";

/**
 * PORTAL DEL PROVEEDOR (MODO=portal) — p. ej. https://factpos.vercel.app
 *
 * Aquí se administran los clientes que compraron FactPOS y sus licencias.
 * NO se guarda ningún dato de los clientes (ventas, productos, clientes…):
 * cada cliente tiene su propia nube (su Vercel + su Supabase).
 *
 *  Públicas (las llama la nube de cada cliente):
 *    POST /licencias/activar      { clave, instalacionId, … } → licencia firmada + secreto
 *    POST /licencias/renovar      { licenciaId, instalacionId, secreto, … } → licencia firmada al día
 *    GET  /licencias/cliente/:slug → nombre y dirección de la API del cliente (para su administración web)
 *  Administración del proveedor (con sesión): /central/portal/...
 *  Páginas:
 *    /             → administración del portal
 *    /<cliente>/   → administración web del cliente, conectada a SU nube
 */
const uuid = z.string().uuid();
const huella = (t: string) => createHash("sha256").update(`factpos:licencia:${t}`).digest("hex");
const igual = (a: string | null, b: string) => !!a && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const nuevaClave = () => "FPS-" + Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("")).join("-");
const normalizarClave = (t: string) => {
  const c = t.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^FPS/, "");
  return c.length === 16 ? `FPS-${c.match(/.{4}/g)!.join("-")}` : t.trim().toUpperCase();
};
/** Rutas que no pueden ser el nombre corto de un cliente */
const RESERVADAS = new Set(["central", "licencias", "salud", "assets", "iconos", "admin", "terminal", "alta", "sync", "cajas", "api", "portal",
  "descubrir", "sw.js", "manifest.webmanifest", "favicon.ico", "robots.txt", "clientes", "www"]);
export const slugValido = (s: string) => /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(s) && !RESERVADAS.has(s);

function llavePrivada() {
  const k = process.env.LICENCIAS_CLAVE_PRIVADA;
  if (!k) throw new ErrorNegocio("El portal no tiene LICENCIAS_CLAVE_PRIVADA configurada (Vercel › Environment Variables)", 503);
  return k;
}

interface FilaLicencia {
  id: string; cliente_id: string; sucursales: number; modulos: string[]; vence: string; estado: string;
  instalacion_id: string | null; secreto_hash: string | null; slug: string; nombre: string; rnc: string | null; cliente_activo: boolean;
}
const SELECT_LIC = `SELECT l.id, l.cliente_id, l.sucursales, l.modulos, to_char(l.vence, 'YYYY-MM-DD') AS vence, l.estado,
                           l.instalacion_id, l.secreto_hash, c.slug, c.nombre, c.rnc, c.activo AS cliente_activo
                      FROM portal_licencias l JOIN portal_clientes c ON c.id = l.cliente_id`;

function emitir(l: FilaLicencia, instalacion: string) {
  const datos: DatosLicencia = {
    v: 1, id: l.id, cliente: { id: l.cliente_id, nombre: l.nombre, slug: l.slug, rnc: l.rnc },
    instalacion, sucursales: l.sucursales, modulos: l.modulos, emitida: new Date().toISOString(), vence: l.vence,
  };
  return firmarLicencia(datos, llavePrivada());
}

const evento = (c: { query: typeof pool.query }, e: { licenciaId?: string | null; clienteId?: string | null; tipo: string; detalle?: unknown; usuarioId?: string | null }) =>
  c.query("INSERT INTO portal_eventos (id, licencia_id, cliente_id, tipo, detalle, usuario_id) VALUES ($1,$2,$3,$4,$5,$6)",
    [uuidv7(), e.licenciaId ?? null, e.clienteId ?? null, e.tipo, e.detalle ? JSON.stringify(e.detalle) : null, e.usuarioId ?? null]);

// Freno simple para quien pruebe claves al azar
const intentos = new Map<string, { n: number; desde: number }>();
function frenar(ip: string) {
  const ahora = Date.now();
  const x = intentos.get(ip);
  if (!x || ahora - x.desde > 15 * 60_000) { intentos.set(ip, { n: 1, desde: ahora }); return; }
  if (++x.n > 15) throw new ErrorNegocio("Demasiados intentos con claves equivocadas. Espere 15 minutos.", 429);
}

const contacto = z.object({
  instalacionId: uuid,
  version: z.string().max(40).optional(),
  sucursalesEnUso: z.number().int().min(0).max(9999).optional(),
  apiUrl: z.string().url().max(200).optional(),
});

export async function rutasPortal(app: FastifyInstance) {
  // ================================================================ PÚBLICAS (nube de cada cliente)
  app.post("/licencias/activar", async (req) => {
    const b = contacto.extend({ clave: z.string().trim().min(16).max(40) }).parse(req.body);
    const clave = normalizarClave(b.clave);
    return enTransaccion(async (c) => {
      const l = (await c.query<FilaLicencia>(`${SELECT_LIC} WHERE l.clave_hash = $1 FOR UPDATE OF l`, [huella(clave)])).rows[0];
      if (!l) { frenar(req.ip ?? "?"); throw new ErrorNegocio("Clave de activación no válida. Revísela o pídala a su proveedor.", 404); }
      if (l.estado !== "ACTIVA" || !l.cliente_activo) throw new ErrorNegocio("Esta licencia está suspendida. Comuníquese con su proveedor.", 403);
      if (l.instalacion_id && l.instalacion_id !== b.instalacionId) {
        await evento(c, { licenciaId: l.id, clienteId: l.cliente_id, tipo: "CONTACTO_RECHAZADO", detalle: { motivo: "otra instalación", instalacion: b.instalacionId } });
        throw new ErrorNegocio("Esta licencia ya está activada en otra instalación. Si cambió de nube, pídale a su proveedor que la libere.", 409);
      }
      const secreto = randomBytes(24).toString("base64url");
      await c.query(
        `UPDATE portal_licencias SET instalacion_id = $2, secreto_hash = $3, activada_en = COALESCE(activada_en, now()), ultimo_contacto = now(),
                version_app = $4, sucursales_en_uso = $5, actualizado_en = now() WHERE id = $1`,
        [l.id, b.instalacionId, huella(secreto), b.version ?? null, b.sucursalesEnUso ?? null]);
      if (b.apiUrl) await c.query("UPDATE portal_clientes SET api_url = COALESCE(api_url, $2) WHERE id = $1", [l.cliente_id, b.apiUrl]);
      await evento(c, { licenciaId: l.id, clienteId: l.cliente_id, tipo: "ACTIVADA", detalle: { instalacion: b.instalacionId, version: b.version } });
      return { licencia: emitir(l, b.instalacionId), secreto, cliente: { nombre: l.nombre, slug: l.slug } };
    });
  });

  app.post("/licencias/renovar", async (req) => {
    const b = contacto.extend({ licenciaId: uuid, secreto: z.string().min(20).max(80) }).parse(req.body);
    const l = (await pool.query<FilaLicencia>(`${SELECT_LIC} WHERE l.id = $1`, [b.licenciaId])).rows[0];
    if (!l || l.instalacion_id !== b.instalacionId || !igual(l.secreto_hash, huella(b.secreto))) {
      frenar(req.ip ?? "?");
      throw new ErrorNegocio("Esta instalación no está autorizada para esa licencia. Actívela de nuevo con su clave.", 401);
    }
    await pool.query("UPDATE portal_licencias SET ultimo_contacto = now(), version_app = $2, sucursales_en_uso = $3 WHERE id = $1",
      [l.id, b.version ?? null, b.sucursalesEnUso ?? null]);
    if (l.estado !== "ACTIVA" || !l.cliente_activo) throw new ErrorNegocio("Esta licencia está suspendida. Comuníquese con su proveedor.", 403);
    return { licencia: emitir(l, b.instalacionId) };
  });

  /** El servidor MASTER de un cliente informa la dirección actual de su túnel. */
  app.post("/licencias/tunel", async (req) => {
    const b = z.object({ licenciaId: uuid, instalacionId: uuid, secreto: z.string().min(20).max(80),
      url: z.string().regex(/^https:\/\/[a-z0-9.-]+(:\d+)?$/i, "Dirección de túnel inválida").max(200) }).parse(req.body);
    const l = (await pool.query<FilaLicencia>(`${SELECT_LIC} WHERE l.id = $1`, [b.licenciaId])).rows[0];
    if (!l || l.instalacion_id !== b.instalacionId || !igual(l.secreto_hash, huella(b.secreto))) {
      frenar(req.ip ?? "?");
      throw new ErrorNegocio("Esta instalación no está autorizada para esa licencia", 401);
    }
    // Si el cliente ya tiene dirección fija, solo esa vale (un túnel rápido viejo no la reemplaza)
    await pool.query("UPDATE portal_clientes SET api_url = $2 WHERE id = $1 AND (tunel_host IS NULL OR $2 = 'https://' || tunel_host)", [l.cliente_id, b.url]);
    await pool.query("UPDATE portal_licencias SET ultimo_contacto = now() WHERE id = $1", [l.id]);
    return { ok: true, web: `/${l.slug}/` };
  });

  /** Última versión publicada de FactPOS (GitHub Releases con etiqueta v1.2.3). */
  app.get("/licencias/version", async () => {
    const r = await ultimaVersion();
    if (!r) throw new ErrorNegocio("Todavía no hay versiones publicadas", 404);
    return { version: r.version, notas: r.notas, publicada: r.publicada };
  });

  /**
   * Descarga de una versión: solo para instalaciones con licencia válida (la licencia
   * firmada viaja en x-licencia). Devuelve una dirección de descarga temporal.
   */
  app.get("/licencias/descargar", async (req) => {
    const token = String(req.headers["x-licencia"] ?? "");
    let d: DatosLicencia;
    try { d = leerLicencia(token); } catch { throw new ErrorNegocio("Licencia inválida", 401); }
    const l = (await pool.query<FilaLicencia>(`${SELECT_LIC} WHERE l.id = $1`, [d.id])).rows[0];
    if (!l || l.estado !== "ACTIVA" || !l.cliente_activo) throw new ErrorNegocio("La licencia no está activa: comuníquese con su proveedor", 403);
    if (l.instalacion_id && l.instalacion_id !== d.instalacion) throw new ErrorNegocio("Licencia de otra instalación", 403);
    const v = await ultimaVersion();
    if (!v?.asset) throw new ErrorNegocio("No hay un paquete publicado para descargar", 404);
    return { version: v.version, url: await urlDescarga(v.asset) };
  });

  /**
   * El master pide su túnel FIJO (<empresa>.factpos.app). El portal lo crea en
   * Cloudflare la primera vez y entrega el token (cada vez, a la misma instalación).
   */
  app.post("/licencias/tunel/fijo", async (req) => {
    const b = z.object({ licenciaId: uuid, instalacionId: uuid, secreto: z.string().min(20).max(80),
      puerto: z.number().int().min(1).max(65535).default(3000) }).parse(req.body);
    if (!cloudflareListo()) throw new ErrorNegocio("El portal todavía no tiene configurado el túnel fijo (Cloudflare)", 503);
    const l = (await pool.query<FilaLicencia & { tunel_id: string | null }>(
      `SELECT l.id, l.cliente_id, l.estado, l.instalacion_id, l.secreto_hash, c.slug, c.activo AS cliente_activo, c.tunel_id
         FROM portal_licencias l JOIN portal_clientes c ON c.id = l.cliente_id WHERE l.id = $1`, [b.licenciaId])).rows[0];
    if (!l || l.instalacion_id !== b.instalacionId || !igual(l.secreto_hash, huella(b.secreto))) {
      frenar(req.ip ?? "?");
      throw new ErrorNegocio("Esta instalación no está autorizada para esa licencia", 401);
    }
    if (l.estado !== "ACTIVA" || !l.cliente_activo) throw new ErrorNegocio("La licencia está suspendida", 403);
    const t = await asegurarTunel(l.slug, l.tunel_id, b.puerto).catch((e: Error) => { throw new ErrorNegocio(e.message, 502); });
    await pool.query(
      `UPDATE portal_clientes SET tunel_id = $2, tunel_host = $3, tunel_creado_en = COALESCE(tunel_creado_en, now()), api_url = $4 WHERE id = $1`,
      [l.cliente_id, t.id, t.host, t.url]);
    await evento(pool, { licenciaId: l.id, clienteId: l.cliente_id, tipo: "TUNEL_FIJO", detalle: { host: t.host } });
    return { url: t.url, token: t.token };
  });

  app.get("/licencias/cliente/:slug", async (req) => {
    const { slug } = z.object({ slug: z.string().max(40) }).parse(req.params);
    const c = (await pool.query("SELECT nombre, slug, api_url AS \"apiUrl\" FROM portal_clientes WHERE slug = $1 AND activo", [slug.toLowerCase()])).rows[0];
    if (!c) throw new ErrorNegocio("Cliente no encontrado", 404);
    return c;
  });

  // ================================================================ ADMINISTRACIÓN DEL PROVEEDOR
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  app.get("/central/portal/clientes", async () => {
    const r = await pool.query(
      `SELECT c.id, c.slug, c.nombre, c.rnc, c.contacto, c.correo, c.telefono, c.api_url AS "apiUrl", c.notas, c.activo, c.creado_en AS "creadoEn", c.tunel_host AS "tunelHost",
              l.id AS "licenciaId", l.sucursales, l.modulos, to_char(l.vence, 'YYYY-MM-DD') AS vence, l.estado AS "estadoLicencia",
              l.clave_pista AS "clavePista", l.instalacion_id IS NOT NULL AS activada, l.activada_en AS "activadaEn",
              l.ultimo_contacto AS "ultimoContacto", l.version_app AS "versionApp", l.sucursales_en_uso AS "sucursalesEnUso"
         FROM portal_clientes c LEFT JOIN portal_licencias l ON l.cliente_id = c.id
        ORDER BY c.nombre`);
    return r.rows.map((x) => ({
      ...x,
      // Estado tal como lo verá el cliente (sin firma: solo por la fecha)
      estado: x.vence ? evaluarFecha(x.vence) : null,
    }));
  });

  const esquemaCliente = z.object({
    slug: z.string().trim().toLowerCase().refine(slugValido, "Nombre corto: 3 a 40 letras minúsculas, números o guiones (ej. royalliquorstore)"),
    nombre: z.string().trim().min(2).max(120),
    rnc: z.string().trim().regex(/^\d{9}(\d{2})?$/, "RNC de 9 u 11 dígitos").nullable().optional().or(z.literal("").transform(() => null)),
    contacto: z.string().trim().max(120).nullable().optional(),
    correo: z.string().trim().max(120).nullable().optional(),
    telefono: z.string().trim().max(30).nullable().optional(),
    apiUrl: z.string().trim().url("Dirección de la API inválida (ej. https://royalliquorstore-api.vercel.app)").max(200).nullable().optional()
      .or(z.literal("").transform(() => null)),
    notas: z.string().max(1000).nullable().optional(),
    activo: z.boolean().optional(),
  });
  const esquemaLicencia = z.object({
    sucursales: z.number().int().min(1).max(999),
    vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    modulos: z.array(z.string().max(30)).max(30).default([]),
    estado: z.enum(["ACTIVA", "SUSPENDIDA"]).default("ACTIVA"),
    notas: z.string().max(1000).nullable().optional(),
  });

  /** Cliente nuevo con su licencia; devuelve la clave de activación (se muestra UNA vez). */
  app.post("/central/portal/clientes", async (req, rep) => {
    const b = z.object({ cliente: esquemaCliente, licencia: esquemaLicencia }).parse(req.body);
    const u = usuarioDe(req);
    const r = await enTransaccion(async (c) => {
      const id = uuidv7(), lic = uuidv7(), clave = nuevaClave();
      try {
        await c.query(`INSERT INTO portal_clientes (id, slug, nombre, rnc, contacto, correo, telefono, api_url, notas)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, b.cliente.slug, b.cliente.nombre, b.cliente.rnc ?? null, b.cliente.contacto ?? null, b.cliente.correo ?? null,
           b.cliente.telefono ?? null, b.cliente.apiUrl ?? null, b.cliente.notas ?? null]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new ErrorNegocio(`Ya existe un cliente con el nombre corto «${b.cliente.slug}»`, 409);
        throw e;
      }
      await c.query(`INSERT INTO portal_licencias (id, cliente_id, sucursales, modulos, vence, estado, clave_hash, clave_pista, notas)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [lic, id, b.licencia.sucursales, b.licencia.modulos, b.licencia.vence, b.licencia.estado, huella(clave), clave.slice(-4), b.licencia.notas ?? null]);
      await evento(c, { licenciaId: lic, clienteId: id, tipo: "CREADA", detalle: b.licencia, usuarioId: u });
      return { id, licenciaId: lic, clave };
    });
    rep.code(201);
    return r;
  });

  app.put("/central/portal/clientes/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = esquemaCliente.partial().parse(req.body);
    try {
      const r = await pool.query(
        `UPDATE portal_clientes SET slug = COALESCE($2, slug), nombre = COALESCE($3, nombre), rnc = CASE WHEN $10 THEN $4 ELSE rnc END,
                contacto = COALESCE($5, contacto), correo = COALESCE($6, correo), telefono = COALESCE($7, telefono),
                api_url = CASE WHEN $11 THEN $8 ELSE api_url END, notas = COALESCE($9, notas), activo = COALESCE($12, activo)
          WHERE id = $1 RETURNING id`,
        [id, b.slug ?? null, b.nombre ?? null, b.rnc ?? null, b.contacto ?? null, b.correo ?? null, b.telefono ?? null, b.apiUrl ?? null,
         b.notas ?? null, "rnc" in b, "apiUrl" in b, b.activo ?? null]);
      if (!r.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErrorNegocio("Ese nombre corto ya lo usa otro cliente", 409);
      throw e;
    }
    return { ok: true };
  });

  /** Renovar o cambiar la licencia (fecha, sucursales, suspender). La nube del cliente la recoge sola. */
  app.put("/central/portal/clientes/:id/licencia", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = esquemaLicencia.parse(req.body);
    const r = await pool.query(
      `UPDATE portal_licencias SET sucursales = $2, vence = $3, modulos = $4, estado = $5, notas = COALESCE($6, notas), actualizado_en = now()
        WHERE cliente_id = $1 RETURNING id`,
      [id, b.sucursales, b.vence, b.modulos, b.estado, b.notas ?? null]);
    if (!r.rowCount) throw new ErrorNegocio("El cliente no tiene licencia", 404);
    await evento(pool, { licenciaId: r.rows[0].id, clienteId: id, tipo: b.estado === "SUSPENDIDA" ? "SUSPENDIDA" : "RENOVADA", detalle: b, usuarioId: usuarioDe(req) });
    return { ok: true };
  });

  /** Clave de activación nueva (la anterior deja de servir). Se muestra UNA vez. */
  app.post("/central/portal/clientes/:id/clave", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const clave = nuevaClave();
    const r = await pool.query("UPDATE portal_licencias SET clave_hash = $2, clave_pista = $3, actualizado_en = now() WHERE cliente_id = $1 RETURNING id",
      [id, huella(clave), clave.slice(-4)]);
    if (!r.rowCount) throw new ErrorNegocio("El cliente no tiene licencia", 404);
    await evento(pool, { licenciaId: r.rows[0].id, clienteId: id, tipo: "CLAVE_NUEVA", usuarioId: usuarioDe(req) });
    return { clave };
  });

  /** Libera la licencia de la nube donde estaba (para activarla en otra). */
  app.post("/central/portal/clientes/:id/liberar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      "UPDATE portal_licencias SET instalacion_id = NULL, secreto_hash = NULL, actualizado_en = now() WHERE cliente_id = $1 RETURNING id", [id]);
    if (!r.rowCount) throw new ErrorNegocio("El cliente no tiene licencia", 404);
    await evento(pool, { licenciaId: r.rows[0].id, clienteId: id, tipo: "LIBERADA", usuarioId: usuarioDe(req) });
    return { ok: true };
  });

  app.get("/central/portal/clientes/:id/eventos", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      `SELECT e.tipo, e.detalle, e.creado_en AS "creadoEn", u.nombre AS usuario
         FROM portal_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id WHERE e.cliente_id = $1 ORDER BY e.creado_en DESC LIMIT 100`, [id]);
    return r.rows;
  });

  // ================================================================ PÁGINAS
  await rutasPaginas(app);
}

// -------------------------------------------------------------------------------------------
// Versiones publicadas (GitHub Releases). Repositorio privado: GITHUB_TOKEN con permiso de lectura.
// -------------------------------------------------------------------------------------------
interface Publicada { version: string; notas: string | null; publicada: string | null; asset: { url: string; descarga: string } | null }
let cacheVersion: { v: Publicada | null; t: number } | null = null;
const encabezadosGitHub = (extra: Record<string, string> = {}) => ({
  "user-agent": "factpos-portal", accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}), ...extra,
});
async function ultimaVersion(): Promise<Publicada | null> {
  if (cacheVersion && Date.now() - cacheVersion.t < 10 * 60_000) return cacheVersion.v;
  const repo = process.env.FACTPOS_REPO || "supporthng/factpos";
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, { headers: encabezadosGitHub(), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const lista = (await r.json()) as { tag_name: string; draft: boolean; body: string | null; published_at: string | null;
      assets: { name: string; url: string; browser_download_url: string }[] }[];
    // La rama main publica bajo la etiqueta «ultima», no «vX.Y.Z».
    // La versión efectiva se obtiene del nombre del ZIP publicado.
    const candidatas = lista.filter((x) => !x.draft && (x.tag_name === "ultima" || /^v\d+\.\d+\.\d+$/.test(x.tag_name)));
    const publicadas = candidatas.flatMap((rel) => rel.assets
      .filter((a) => /^FactPOS-Instalador-\d+\.\d+\.\d+\.zip$/i.test(a.name))
      .map((asset) => ({ rel, asset, version: asset.name.match(/FactPOS-Instalador-(\d+\.\d+\.\d+)\.zip/i)![1] })));
    publicadas.sort((a, b) => {
      const aa = a.version.split(".").map(Number), bb = b.version.split(".").map(Number);
      return (bb[0] - aa[0]) || (bb[1] - aa[1]) || (bb[2] - aa[2]);
    });
    const encontrada = publicadas[0];
    const v = encontrada ? { version: encontrada.version, notas: encontrada.rel.body, publicada: encontrada.rel.published_at,
      asset: { url: encontrada.asset.url, descarga: encontrada.asset.browser_download_url } } : null;
    cacheVersion = { v, t: Date.now() };
    return v;
  } catch {
    return cacheVersion?.v ?? null;
  }
}
/** Repositorio privado: GitHub entrega una dirección firmada y temporal del archivo. */
async function urlDescarga(a: { url: string; descarga: string }) {
  if (!process.env.GITHUB_TOKEN) return a.descarga;
  const r = await fetch(a.url, { headers: encabezadosGitHub({ accept: "application/octet-stream" }), redirect: "manual", signal: AbortSignal.timeout(15_000) });
  const lugar = r.headers.get("location");
  if (!lugar) throw new ErrorNegocio(`No se pudo preparar la descarga (GitHub ${r.status})`, 502);
  return lugar;
}

/** Estado por fecha (para la lista del portal). */
function evaluarFecha(vence: string) {
  const dias = Math.ceil((new Date(`${vence}T23:59:59-04:00`).getTime() - Date.now()) / 86_400_000) - 1;
  return dias >= DIAS_AVISO ? "VIGENTE" : dias >= 0 ? "POR_VENCER" : dias >= -DIAS_GRACIA ? "GRACIA" : "VENCIDA";
}

// -------------------------------------------------------------------------------------------
// Administración web servida desde el portal:
//   /                  → la del PORTAL (clientes y licencias)
//   /<cliente>/...     → la del CLIENTE, conectada a la API de SU nube
// Los archivos de la administración van dentro del código (admin-embebido) para que
// funcionen igual en Vercel.
// -------------------------------------------------------------------------------------------
async function rutasPaginas(app: FastifyInstance) {
  // Se carga solo en el portal (pesa ~1 MB); la ruta fija permite que Vercel la incluya
  const { ARCHIVOS_ADMIN } = await import("../admin-embebido.js");
  // Sin embeber (desarrollo): se leen de apps/admin/dist
  const archivos = ARCHIVOS_ADMIN ?? leerCarpetaAdmin();
  const html = archivos["index.html"] ? Buffer.from(archivos["index.html"][1], "base64").toString("utf8") : null;

  const pagina = (rep: FastifyReply, conf: Record<string, unknown>) => {
    if (!html) return rep.code(503).type("text/plain; charset=utf-8").send("La administración no está incluida en esta compilación (npm run build).");
    const script = `<script>window.__FACTPOS__=${JSON.stringify(conf).replace(/</g, "\\u003c")}</script>`;
    return rep.type("text/html; charset=utf-8").header("cache-control", "no-cache").send(html.replace("<head>", `<head>${script}`));
  };
  const archivo = (rep: FastifyReply, ruta: string) => {
    const a = archivos[ruta];
    if (!a) return null;
    const inmutable = ruta.startsWith("assets/");
    return rep.type(a[0]).header("cache-control", inmutable ? "public, max-age=31536000, immutable" : "no-cache").send(Buffer.from(a[1], "base64"));
  };

  // Portal
  app.get("/", (_req, rep) => pagina(rep, { modo: "portal", api: "" }));
  for (const r of ["/assets/*", "/iconos/*", "/sw.js", "/manifest.webmanifest"]) {
    app.get(r, (req, rep) => archivo(rep, req.url.split("?")[0].slice(1)) ?? rep.code(404).send({ error: "No encontrado" }));
  }
  app.get("/favicon.ico", (_req, rep) => archivo(rep, "iconos/factpos.ico") ?? rep.code(404).send());

  // Clientes
  const cliente = async (slug: string) =>
    slugValido(slug) ? (await pool.query("SELECT nombre, slug, api_url FROM portal_clientes WHERE slug = $1 AND activo", [slug])).rows[0] : null;
  app.get("/:slug", async (req, rep) => {
    const { slug } = req.params as { slug: string };
    if (!(await cliente(slug.toLowerCase()))) return rep.code(404).type("text/html; charset=utf-8").send(noExiste());
    return rep.redirect(`/${slug.toLowerCase()}/`);
  });
  app.get("/:slug/*", async (req, rep) => {
    const { slug } = req.params as { slug: string };
    const resto = (req.params as { "*": string })["*"] ?? "";
    const c = await cliente(slug.toLowerCase());
    if (!c) return rep.code(404).type("text/html; charset=utf-8").send(noExiste());
    if (resto && resto !== "index.html") return archivo(rep, resto) ?? rep.code(404).send({ error: "No encontrado" });
    if (!c.api_url) return rep.type("text/html; charset=utf-8").send(sinNube(c.nombre));
    return pagina(rep, { modo: "cliente", slug: c.slug, cliente: c.nombre, api: c.api_url });
  });
}

function leerCarpetaAdmin() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../admin/dist");
  const tipos: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
  const r: Record<string, [string, string]> = {};
  const recorrer = (d: string) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else r[path.relative(dir, p).replaceAll("\\", "/")] = [tipos[path.extname(n)] ?? "application/octet-stream", readFileSync(p).toString("base64")];
    }
  };
  recorrer(dir);
  return r;
}

const simple = (titulo: string, texto: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo} · FactPOS</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#f4f6f8;color:#1d2733;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border-radius:14px;padding:32px 36px;max-width:480px;box-shadow:0 2px 12px rgba(20,40,60,.08)}h1{font-size:20px;margin:0 0 10px}</style></head>
<body><main><h1>${titulo}</h1><p>${texto}</p></main></body></html>`;
const noExiste = () => simple("No encontramos esa administración", "Revise la dirección que le dio su proveedor de FactPOS.");
const sinNube = (nombre: string) => simple(nombre.replace(/[<>&]/g, ""), "La administración de esta empresa todavía se está configurando. Vuelva a intentarlo más tarde o comuníquese con su proveedor de FactPOS.");
