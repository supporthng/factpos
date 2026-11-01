import { createHash, createPrivateKey, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { asegurarTunel, cloudflareListo } from "./cloudflare.js";
import { rutasInvitaciones } from "./invitaciones.js";
import { verificarSoftware } from "../fiscal/verificacion-software.js";
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
export const huella = (t: string) => createHash("sha256").update(`factpos:licencia:${t}`).digest("hex");
export const igual = (a: string | null, b: string) => !!a && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
  // Tolera comillas, saltos de línea, espacios o formato PEM al pegarla en Vercel
  const limpia = k.replace(/-----(BEGIN|END)[^-]*-----/g, "").replace(/["'\s]/g, "");
  try { createPrivateKey({ key: Buffer.from(limpia, "base64"), format: "der", type: "pkcs8" }); }
  catch { throw new ErrorNegocio("LICENCIAS_CLAVE_PRIVADA del portal no es válida (debe ser la llave privada Ed25519 PKCS#8 en base64). Corríjala en Vercel › Environment Variables.", 503); }
  return limpia;
}

interface FilaLicencia {
  id: string; cliente_id: string; sucursales: number; modulos: string[]; vence: string; estado: string;
  instalacion_id: string | null; secreto_hash: string | null; slug: string; nombre: string; rnc: string | null; cliente_activo: boolean;
  plan_nombre: string | null; plan_actualiza: boolean | null;
}
const SELECT_LIC = `SELECT l.id, l.cliente_id, l.sucursales, l.modulos, to_char(l.vence, 'YYYY-MM-DD') AS vence, l.estado,
                           l.instalacion_id, l.secreto_hash, c.slug, c.nombre, c.rnc, c.activo AS cliente_activo,
                           p.nombre AS plan_nombre, p.permite_actualizaciones AS plan_actualiza
                      FROM portal_licencias l JOIN portal_clientes c ON c.id = l.cliente_id LEFT JOIN portal_planes p ON p.id = l.plan_id`;

function emitir(l: FilaLicencia, instalacion: string) {
  const datos: DatosLicencia = {
    v: 1, id: l.id, cliente: { id: l.cliente_id, nombre: l.nombre, slug: l.slug, rnc: l.rnc },
    instalacion, sucursales: l.sucursales, modulos: l.modulos, ...(l.plan_nombre ? { plan: l.plan_nombre } : {}), emitida: new Date().toISOString(), vence: l.vence,
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

// Altas de solicitudes: máximo 20 instalaciones nuevas por hora desde una misma dirección
const altas = new Map<string, { n: number; desde: number }>();
function limitarAltas(ip: string) {
  const ahora = Date.now();
  const x = altas.get(ip);
  if (!x || ahora - x.desde > 3_600_000) { altas.set(ip, { n: 1, desde: ahora }); return; }
  if (++x.n > 20) throw new ErrorNegocio("Demasiadas solicitudes desde esta dirección. Intente más tarde.", 429);
}

const contacto = z.object({
  instalacionId: uuid,
  version: z.string().max(40).optional(),
  sucursalesEnUso: z.number().int().min(0).max(9999).optional(),
  apiUrl: z.string().url().max(200).optional(),
  /** Comprobantes e-CF emitidos por mes (la nube del cliente reporta el mes actual y el anterior) */
  ecf: z.object({ meses: z.array(z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/), emitidos: z.number().int().min(0).max(10_000_000) })).max(3) }).optional(),
});

async function guardarUsoEcf(licenciaId: string, ecf: z.infer<typeof contacto>["ecf"]) {
  for (const m of ecf?.meses ?? [])
    await pool.query(
      `INSERT INTO portal_ecf_uso (licencia_id, mes, emitidos) VALUES ($1,$2,$3)
       ON CONFLICT (licencia_id, mes) DO UPDATE SET emitidos = EXCLUDED.emitidos, actualizado_en = now()`, [licenciaId, m.mes, m.emitidos]);
}

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
      await c.query(
        `INSERT INTO portal_instalaciones (id, estado, secreto_hash, version_app, sucursales_en_uso, api_url, licencia_id, resuelta_en)
         VALUES ($1,'ASIGNADA',$2,$3,$4,$5,$6,now())
         ON CONFLICT (id) DO UPDATE SET estado = 'ASIGNADA', secreto_hash = $2, version_app = $3, sucursales_en_uso = $4, licencia_id = $6, resuelta_en = now(), ultimo_contacto = now()`,
        [b.instalacionId, huella(secreto), b.version ?? null, b.sucursalesEnUso ?? null, b.apiUrl ?? null, l.id]);
      for (const m of b.ecf?.meses ?? [])
        await c.query(`INSERT INTO portal_ecf_uso (licencia_id, mes, emitidos) VALUES ($1,$2,$3)
                       ON CONFLICT (licencia_id, mes) DO UPDATE SET emitidos = EXCLUDED.emitidos, actualizado_en = now()`, [l.id, m.mes, m.emitidos]);
      return { licencia: emitir(l, b.instalacionId), secreto, cliente: { nombre: l.nombre, slug: l.slug } };
    });
  });

  app.post("/licencias/renovar", async (req) => {
    const b = contacto.extend({ licenciaId: uuid, secreto: z.string().min(20).max(80) }).parse(req.body);
    const l = (await pool.query<FilaLicencia>(`${SELECT_LIC} WHERE l.id = $1`, [b.licenciaId])).rows[0];
    if (l && l.instalacion_id === b.instalacionId && !igual(l.secreto_hash, huella(b.secreto))) {
      const t = (await pool.query("SELECT traslado_en FROM portal_licencias WHERE id = $1", [l.id])).rows[0];
      if (t?.traslado_en) throw new ErrorNegocio("TRASLADADA: esta licencia se movió a otro equipo. Este equipo quedó solo en modo consulta.", 409);
    }
    if (!l || l.instalacion_id !== b.instalacionId || !igual(l.secreto_hash, huella(b.secreto))) {
      frenar(req.ip ?? "?");
      throw new ErrorNegocio("Esta instalación no está autorizada para esa licencia. Actívela de nuevo con su clave.", 401);
    }
    await pool.query("UPDATE portal_licencias SET ultimo_contacto = now(), version_app = $2, sucursales_en_uso = $3 WHERE id = $1",
      [l.id, b.version ?? null, b.sucursalesEnUso ?? null]);
    await pool.query("UPDATE portal_instalaciones SET ultimo_contacto = now(), version_app = $2, sucursales_en_uso = $3 WHERE id = $1",
      [b.instalacionId, b.version ?? null, b.sucursalesEnUso ?? null]);
    await guardarUsoEcf(l.id, b.ecf).catch(() => undefined);
    if (l.estado !== "ACTIVA" || !l.cliente_activo) throw new ErrorNegocio("Esta licencia está suspendida. Comuníquese con su proveedor.", 403);
    return { licencia: emitir(l, b.instalacionId) };
  });

  // -------- Traslado a otro equipo: se mueve el servidor completo (licencia + base de datos + configuración).
  // El equipo viejo pierde su secreto en cuanto se inicia: no puede renovar y queda en modo consulta.
  const normalizarTraslado = (t: string) => "TRS-" + (t.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^TRS/, "").match(/.{1,4}/g) ?? []).join("-");
  const MAX_TRASLADOS_ANIO = 3;

  app.post("/licencias/traslado/iniciar", async (req) => {
    const b = contacto.extend({ licenciaId: uuid, secreto: z.string().min(20).max(80) }).parse(req.body);
    return enTransaccion(async (c) => {
      const l = (await c.query<FilaLicencia>(`${SELECT_LIC} WHERE l.id = $1 FOR UPDATE OF l`, [b.licenciaId])).rows[0];
      if (!l || l.instalacion_id !== b.instalacionId || !igual(l.secreto_hash, huella(b.secreto))) {
        frenar(req.ip ?? "?");
        throw new ErrorNegocio("Esta instalación no está autorizada para esa licencia.", 401);
      }
      if (l.estado !== "ACTIVA" || !l.cliente_activo) throw new ErrorNegocio("Esta licencia está suspendida. Comuníquese con su proveedor.", 403);
      const n = (await c.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM portal_eventos WHERE licencia_id = $1 AND tipo = 'TRASLADO_INICIADO' AND creado_en > now() - interval '365 days'", [l.id])).rows[0].n;
      if (n >= MAX_TRASLADOS_ANIO) throw new ErrorNegocio(`Esta licencia ya se trasladó ${n} veces en el último año. Comuníquese con su proveedor para autorizar otro traslado.`, 429);
      const codigo = "TRS-" + Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("")).join("-");
      await c.query(
        "UPDATE portal_licencias SET secreto_hash = $2, traslado_hash = $3, traslado_en = now(), actualizado_en = now() WHERE id = $1",
        [l.id, huella(randomBytes(24).toString("base64url")), huella(codigo)]);
      await evento(c, { licenciaId: l.id, clienteId: l.cliente_id, tipo: "TRASLADO_INICIADO", detalle: { instalacion: b.instalacionId, version: b.version } });
      return { codigo };
    });
  });

  app.post("/licencias/traslado/completar", async (req) => {
    const b = contacto.extend({ licenciaId: uuid, codigo: z.string().trim().min(10).max(30) }).parse(req.body);
    return enTransaccion(async (c) => {
      const l = (await c.query<FilaLicencia & { traslado_hash: string | null; traslado_en: string | null }>(
        `${SELECT_LIC.replace("FROM portal_licencias l", ", l.traslado_hash, l.traslado_en FROM portal_licencias l")} WHERE l.id = $1 FOR UPDATE OF l`, [b.licenciaId])).rows[0];
      const vigente = !!l?.traslado_en && Date.now() - new Date(l.traslado_en).getTime() < 30 * 86400_000;
      if (!l || l.instalacion_id !== b.instalacionId || !vigente || !igual(l.traslado_hash, huella(normalizarTraslado(b.codigo)))) {
        frenar(req.ip ?? "?");
        throw new ErrorNegocio("Código de traslado no válido o vencido (dura 30 días). Inicie el traslado de nuevo desde el equipo anterior.", 404);
      }
      if (l.estado !== "ACTIVA" || !l.cliente_activo) throw new ErrorNegocio("Esta licencia está suspendida. Comuníquese con su proveedor.", 403);
      const secreto = randomBytes(24).toString("base64url");
      await c.query(
        `UPDATE portal_licencias SET secreto_hash = $2, traslado_hash = NULL, traslado_en = NULL, ultimo_contacto = now(),
                version_app = $3, sucursales_en_uso = $4, actualizado_en = now() WHERE id = $1`,
        [l.id, huella(secreto), b.version ?? null, b.sucursalesEnUso ?? null]);
      await c.query("UPDATE portal_instalaciones SET secreto_hash = $2, ultimo_contacto = now() WHERE id = $1", [b.instalacionId, huella(secreto)]);
      if (b.apiUrl) await c.query("UPDATE portal_clientes SET api_url = $2 WHERE id = $1", [l.cliente_id, b.apiUrl]);
      await evento(c, { licenciaId: l.id, clienteId: l.cliente_id, tipo: "TRASLADO_COMPLETADO", detalle: { instalacion: b.instalacionId, version: b.version } });
      return { licencia: emitir(l, b.instalacionId), secreto };
    });
  });

  /** Planes que se pueden pedir (los ve el cliente en su formulario «Solicitar activación»). */
  app.get("/licencias/planes", async () => (await pool.query(
    `SELECT id, nombre, descripcion, precio_sucursal::float AS "precioSucursal", periodo, sucursales_incluidas AS "sucursalesIncluidas", permite_actualizaciones AS "permiteActualizaciones"
       FROM portal_planes WHERE activo ORDER BY orden, nombre`)).rows);

  /**
   * Solicitud de activación: el cliente (en su prueba) pide su licencia con sus datos y el plan que quiere.
   * Llega al portal como solicitud PENDIENTE; el proveedor lo contacta, confirma el pago y la aprueba.
   * Con la solicitud ya enviada, el mismo endpoint (sin datos) sirve para consultar si ya la aprobaron:
   * entonces la respuesta trae la licencia. La primera vez entrega un secreto que solo esa instalación conoce.
   */
  app.post("/licencias/solicitar", async (req) => {
    const b = contacto.extend({
      secreto: z.string().min(20).max(80).optional(),
      solicitud: z.object({
        empresa: z.string().trim().min(2).max(120),
        rnc: z.string().trim().regex(/^\d{9}(\d{2})?$/, "RNC de 9 u 11 dígitos"),
        correo: z.string().trim().email("Correo inválido").max(120),
        telefono: z.string().trim().min(7, "Teléfono inválido").max(30),
        contacto: z.string().trim().max(120).nullable().optional(),
        planId: uuid.nullable().optional(),
        sucursales: z.number().int().min(1).max(999),
        mensaje: z.string().trim().max(500).nullable().optional(),
        equipo: z.string().trim().max(80).nullable().optional(),
      }).optional(),
    }).parse(req.body);
    const ex = (await pool.query<{ estado: string; secreto_hash: string; licencia_id: string | null }>(
      "SELECT estado, secreto_hash, licencia_id FROM portal_instalaciones WHERE id = $1", [b.instalacionId])).rows[0];
    const sol = b.solicitud;
    const campos = (x: NonNullable<typeof sol>) => [x.empresa, x.rnc, x.equipo ?? null, x.correo, x.telefono, x.contacto ?? null, x.planId ?? null, x.sucursales, x.mensaje ?? null];

    if (!ex) {
      if (!sol) throw new ErrorNegocio("Primero envíe la solicitud de activación con sus datos", 404);
      limitarAltas(req.ip ?? "?");
      const secreto = randomBytes(24).toString("base64url");
      await pool.query(
        `INSERT INTO portal_instalaciones (id, secreto_hash, version_app, sucursales_en_uso, api_url, empresa, rnc, equipo, correo, telefono, contacto, plan_id, sucursales_solicitadas, mensaje)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [b.instalacionId, huella(secreto), b.version ?? null, b.sucursalesEnUso ?? null, b.apiUrl ?? null, ...campos(sol)]);
      await evento(pool, { tipo: "SOLICITUD", detalle: { instalacion: b.instalacionId, empresa: sol.empresa, plan: sol.planId ?? null, sucursales: sol.sucursales } });
      return { estado: "PENDIENTE", secreto };
    }
    if (!b.secreto || !igual(ex.secreto_hash, huella(b.secreto))) {
      frenar(req.ip ?? "?");
      throw new ErrorNegocio("Esta instalación ya está registrada en el portal y no se pudo comprobar. Pida a su proveedor que la revise o use una clave de activación.", 409);
    }
    await pool.query("UPDATE portal_instalaciones SET version_app = $2, sucursales_en_uso = $3, api_url = COALESCE($4, api_url), ultimo_contacto = now() WHERE id = $1",
      [b.instalacionId, b.version ?? null, b.sucursalesEnUso ?? null, b.apiUrl ?? null]);
    if (sol && ex.estado !== "ASIGNADA") {
      // Corrige o reenvía la solicitud (también reabre una rechazada)
      await pool.query(
        `UPDATE portal_instalaciones SET empresa = $2, rnc = $3, equipo = $4, correo = $5, telefono = $6, contacto = $7, plan_id = $8, sucursales_solicitadas = $9, mensaje = $10,
                estado = 'PENDIENTE', resuelta_en = NULL, solicitada_en = now() WHERE id = $1`, [b.instalacionId, ...campos(sol)]);
      return { estado: "PENDIENTE" };
    }
    if (ex.estado === "ASIGNADA" && ex.licencia_id) {
      const l = (await pool.query<FilaLicencia>(`${SELECT_LIC} WHERE l.id = $1`, [ex.licencia_id])).rows[0];
      if (!l || l.instalacion_id !== b.instalacionId) return { estado: "LIBERADA" };
      if (l.estado !== "ACTIVA" || !l.cliente_activo) return { estado: "SUSPENDIDA" };
      await pool.query("UPDATE portal_licencias SET ultimo_contacto = now(), version_app = $2, sucursales_en_uso = $3 WHERE id = $1", [l.id, b.version ?? null, b.sucursalesEnUso ?? null]);
      return { estado: "ASIGNADA", licencia: emitir(l, b.instalacionId) };
    }
    return { estado: ex.estado };
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

  /** Estado público de la certificación del software ante la DGII (lo consultan los servidores de los clientes). */
  app.get("/licencias/certificacion-dgii", async () => {
    const r = (await pool.query(
      "SELECT autorizado, to_char(autorizado_fecha, 'YYYY-MM-DD') AS fecha, software_nombre AS nombre, software_version AS version, pasos FROM portal_certificacion_dgii WHERE id = 1")).rows[0];
    const hechos = Object.values((r?.pasos ?? {}) as Record<string, { estado?: string }>).filter((x) => x.estado === "HECHO").length;
    return { autorizado: !!r?.autorizado, fecha: r?.fecha ?? null, software: r?.nombre ?? "FactPOS", version: r?.version ?? null, pasosHechos: hechos, totalPasos: 15 };
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
    if (token) {
      let d: DatosLicencia;
      try { d = leerLicencia(token); } catch { throw new ErrorNegocio("Licencia inválida", 401); }
      const l = (await pool.query<FilaLicencia>(`${SELECT_LIC} WHERE l.id = $1`, [d.id])).rows[0];
      if (!l || l.estado !== "ACTIVA" || !l.cliente_activo) throw new ErrorNegocio("La licencia no está activa: comuníquese con su proveedor", 403);
      if (l.instalacion_id && l.instalacion_id !== d.instalacion) throw new ErrorNegocio("Licencia de otra instalación", 403);
      if (l.plan_actualiza === false) throw new ErrorNegocio(`Su plan (${l.plan_nombre}) no incluye actualizaciones automáticas. Comuníquese con su proveedor.`, 403);
    } else {
      // Sin licencia (versión de prueba): solo si el proveedor lo permite en Portal › Reglas
      const instalacion = uuid.safeParse(String(req.headers["x-instalacion"] ?? ""));
      const permitido = (await pool.query<{ prueba_actualiza: boolean }>("SELECT prueba_actualiza FROM portal_config WHERE id = 1")).rows[0]?.prueba_actualiza;
      if (!instalacion.success || !permitido) throw new ErrorNegocio("Active la licencia para recibir actualizaciones", 402);
      await evento(pool, { tipo: "PRUEBA_DESCARGA", detalle: { instalacion: instalacion.data } });
    }
    const v = await ultimaVersion();
    if (!v?.asset) throw new ErrorNegocio("No hay un paquete publicado para descargar", 404);
    return { version: v.version, url: await urlDescarga(v.asset) };
  });

  /** Reglas y contacto que ven las instalaciones (públicas: no llevan nada sensible). */
  app.get("/licencias/politica", async () => {
    const c = (await pool.query(
      `SELECT prueba_actualiza AS "pruebaActualiza", plazo_horas AS "plazoHoras", contacto_nombre AS nombre, contacto_telefono AS telefono, contacto_whatsapp AS whatsapp, contacto_correo AS correo
         FROM portal_config WHERE id = 1`)).rows[0];
    return { pruebaActualiza: !!c?.pruebaActualiza, plazoHoras: c?.plazoHoras ?? 24, contacto: { nombre: c?.nombre ?? null, telefono: c?.telefono ?? null, whatsapp: c?.whatsapp ?? null, correo: c?.correo ?? null } };
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
              l.ultimo_contacto AS "ultimoContacto", l.version_app AS "versionApp", l.sucursales_en_uso AS "sucursalesEnUso",
              l.respaldo_extra_gb AS "respaldoExtraGb", l.lector_cupo AS "lectorCupo",
              COALESCE((SELECT u.usadas FROM portal_lector_uso u WHERE u.licencia_id = l.id AND u.mes = to_char(now() AT TIME ZONE 'America/Santo_Domingo', 'YYYY-MM')), 0) AS "lectorUsadas", l.plan_id AS "planId", p.nombre AS plan, l.precio_sucursal AS "precioEspecial", p.periodo,
              COALESCE(l.precio_sucursal, p.precio_sucursal)::float AS "precioSucursal"
         FROM portal_clientes c LEFT JOIN portal_licencias l ON l.cliente_id = c.id LEFT JOIN portal_planes p ON p.id = l.plan_id
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
    planId: uuid.nullable().optional(),
    precioSucursal: z.number().min(0).max(1_000_000).nullable().optional(),   // precio especial; null = el del plan
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
      await c.query(`INSERT INTO portal_licencias (id, cliente_id, sucursales, modulos, vence, estado, clave_hash, clave_pista, notas, plan_id, precio_sucursal)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [lic, id, b.licencia.sucursales, b.licencia.modulos, b.licencia.vence, b.licencia.estado, huella(clave), clave.slice(-4), b.licencia.notas ?? null,
         b.licencia.planId ?? null, b.licencia.precioSucursal ?? null]);
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
      `UPDATE portal_licencias SET sucursales = $2, vence = $3, modulos = $4, estado = $5, notas = COALESCE($6, notas),
              plan_id = CASE WHEN $7 THEN $8 ELSE plan_id END, precio_sucursal = CASE WHEN $9 THEN $10 ELSE precio_sucursal END, actualizado_en = now()
        WHERE cliente_id = $1 RETURNING id`,
      [id, b.sucursales, b.vence, b.modulos, b.estado, b.notas ?? null, "planId" in b, b.planId ?? null, "precioSucursal" in b, b.precioSucursal ?? null]);
    if (!r.rowCount) throw new ErrorNegocio("El cliente no tiene licencia", 404);
    await evento(pool, { licenciaId: r.rows[0].id, clienteId: id, tipo: b.estado === "SUSPENDIDA" ? "SUSPENDIDA" : "RENOVADA", detalle: b, usuarioId: usuarioDe(req) });
    return { ok: true };
  });

  /**
   * Renovar: suma meses a la fecha de vencimiento (o a hoy, si ya venció) y registra el cobro.
   * La nube del cliente recoge la licencia nueva sola (12 h) o al pulsar «Actualizar ahora».
   */
  app.post("/central/portal/clientes/:id/renovar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ meses: z.number().int().min(1).max(60), monto: z.number().min(0).max(100_000_000).nullable().optional(),
      referencia: z.string().trim().max(120).nullable().optional() }).parse(req.body);
    const r = await pool.query<{ id: string; vence: string }>(
      `UPDATE portal_licencias SET vence = (GREATEST(vence, (now() AT TIME ZONE 'America/Santo_Domingo')::date) + make_interval(months => $2))::date,
              estado = 'ACTIVA', actualizado_en = now()
        WHERE cliente_id = $1 RETURNING id, to_char(vence, 'YYYY-MM-DD') AS vence`, [id, b.meses]);
    if (!r.rowCount) throw new ErrorNegocio("El cliente no tiene licencia", 404);
    await evento(pool, { licenciaId: r.rows[0].id, clienteId: id, tipo: "RENOVADA", detalle: { meses: b.meses, monto: b.monto ?? null, referencia: b.referencia ?? null, vence: r.rows[0].vence }, usuarioId: usuarioDe(req) });
    return { vence: r.rows[0].vence };
  });

  // ---- Planes
  const esquemaPlan = z.object({
    codigo: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, "Código: 2 a 30 letras minúsculas, números o guiones"),
    nombre: z.string().trim().min(2).max(60),
    descripcion: z.string().trim().max(300).nullable().optional(),
    precioSucursal: z.number().min(0).max(1_000_000),
    periodo: z.enum(["MENSUAL", "ANUAL"]),
    sucursalesIncluidas: z.number().int().min(1).max(999),
    modulos: z.array(z.string().max(30)).max(30).default([]),
    permiteActualizaciones: z.boolean().default(true),
    activo: z.boolean().default(true),
    orden: z.number().int().min(0).max(999).default(0),
  });
  app.get("/central/portal/planes", async () => (await pool.query(
    `SELECT p.id, p.codigo, p.nombre, p.descripcion, p.precio_sucursal::float AS "precioSucursal", p.periodo, p.sucursales_incluidas AS "sucursalesIncluidas",
            p.modulos, p.permite_actualizaciones AS "permiteActualizaciones", p.activo, p.orden,
            (SELECT COUNT(*)::int FROM portal_licencias l WHERE l.plan_id = p.id) AS clientes
       FROM portal_planes p ORDER BY p.orden, p.nombre`)).rows);
  app.post("/central/portal/planes", async (req, rep) => {
    const b = esquemaPlan.parse(req.body);
    try {
      const id = uuidv7();
      await pool.query(`INSERT INTO portal_planes (id, codigo, nombre, descripcion, precio_sucursal, periodo, sucursales_incluidas, modulos, permite_actualizaciones, activo, orden)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, b.codigo, b.nombre, b.descripcion ?? null, b.precioSucursal, b.periodo, b.sucursalesIncluidas, b.modulos, b.permiteActualizaciones, b.activo, b.orden]);
      rep.code(201);
      return { id };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErrorNegocio(`Ya existe un plan con el código «${b.codigo}»`, 409);
      throw e;
    }
  });
  app.put("/central/portal/planes/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = esquemaPlan.parse(req.body);
    try {
      const r = await pool.query(
        `UPDATE portal_planes SET codigo = $2, nombre = $3, descripcion = $4, precio_sucursal = $5, periodo = $6, sucursales_incluidas = $7, modulos = $8,
                permite_actualizaciones = $9, activo = $10, orden = $11 WHERE id = $1 RETURNING id`,
        [id, b.codigo, b.nombre, b.descripcion ?? null, b.precioSucursal, b.periodo, b.sucursalesIncluidas, b.modulos, b.permiteActualizaciones, b.activo, b.orden]);
      if (!r.rowCount) throw new ErrorNegocio("Plan no encontrado", 404);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErrorNegocio(`Ya existe un plan con el código «${b.codigo}»`, 409);
      throw e;
    }
    return { ok: true };
  });

  // ---- Reglas y contacto
  app.get("/central/portal/reglas", async () => (await pool.query(
    `SELECT prueba_actualiza AS "pruebaActualiza", plazo_horas AS "plazoHoras", contacto_nombre AS "contactoNombre", contacto_telefono AS "contactoTelefono",
            contacto_whatsapp AS "contactoWhatsapp", contacto_correo AS "contactoCorreo" FROM portal_config WHERE id = 1`)).rows[0]);
  app.put("/central/portal/reglas", async (req) => {
    const b = z.object({
      pruebaActualiza: z.boolean(), plazoHoras: z.number().int().min(1).max(720),
      contactoNombre: z.string().trim().max(80).nullable(), contactoTelefono: z.string().trim().max(30).nullable(),
      contactoWhatsapp: z.string().trim().max(30).nullable(), contactoCorreo: z.string().trim().max(120).nullable(),
    }).parse(req.body);
    await pool.query(
      `UPDATE portal_config SET prueba_actualiza = $1, contacto_nombre = $2, contacto_telefono = $3, contacto_whatsapp = $4, contacto_correo = $5, plazo_horas = $6, actualizado_en = now() WHERE id = 1`,
      [b.pruebaActualiza, b.contactoNombre || null, b.contactoTelefono || null, b.contactoWhatsapp || null, b.contactoCorreo || null, b.plazoHoras]);
    await evento(pool, { tipo: "REGLAS", detalle: { pruebaActualiza: b.pruebaActualiza }, usuarioId: usuarioDe(req) });
    return { ok: true };
  });


  // ---- Facturación electrónica como complemento: planes por rango, plan de cada cliente, uso mensual y margen
  const esquemaPlanEcf = z.object({
    codigo: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, "Código: 2 a 30 letras minúsculas, números o guiones"),
    nombre: z.string().trim().min(2).max(60),
    maxMes: z.number().int().min(1).max(10_000_000),
    costoUsd: z.number().min(0).max(1_000_000),
    precioUsd: z.number().min(0).max(1_000_000),
    activo: z.boolean().default(true),
    orden: z.number().int().min(0).max(999).default(0),
  });
  app.get("/central/portal/ecf-planes", async () => (await pool.query(
    `SELECT p.id, p.codigo, p.nombre, p.max_mes AS "maxMes", p.costo_usd::float AS "costoUsd", p.precio_usd::float AS "precioUsd", p.activo, p.orden,
            (SELECT COUNT(*)::int FROM portal_licencias l WHERE l.ecf_plan_id = p.id) AS clientes
       FROM portal_ecf_planes p ORDER BY p.orden, p.max_mes`)).rows);
  app.post("/central/portal/ecf-planes", async (req, rep) => {
    const b = esquemaPlanEcf.parse(req.body);
    try {
      const id = uuidv7();
      await pool.query("INSERT INTO portal_ecf_planes (id, codigo, nombre, max_mes, costo_usd, precio_usd, activo, orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, b.codigo, b.nombre, b.maxMes, b.costoUsd, b.precioUsd, b.activo, b.orden]);
      rep.code(201);
      return { id };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErrorNegocio(`Ya existe un rango con el código «${b.codigo}»`, 409);
      throw e;
    }
  });
  app.put("/central/portal/ecf-planes/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = esquemaPlanEcf.parse(req.body);
    try {
      const r = await pool.query(
        "UPDATE portal_ecf_planes SET codigo = $2, nombre = $3, max_mes = $4, costo_usd = $5, precio_usd = $6, activo = $7, orden = $8 WHERE id = $1 RETURNING id",
        [id, b.codigo, b.nombre, b.maxMes, b.costoUsd, b.precioUsd, b.activo, b.orden]);
      if (!r.rowCount) throw new ErrorNegocio("Rango no encontrado", 404);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErrorNegocio(`Ya existe un rango con el código «${b.codigo}»`, 409);
      throw e;
    }
    return { ok: true };
  });
  /** Espacio extra de respaldos en la nube que contrató el cliente (GB, se suma al tope base). */
  app.put("/central/portal/clientes/:id/respaldo-extra", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ gb: z.number().int().min(0).max(1000) }).parse(req.body);
    const r = await pool.query("UPDATE portal_licencias SET respaldo_extra_gb = $2, actualizado_en = now() WHERE cliente_id = $1 RETURNING id", [id, b.gb]);
    if (!r.rowCount) throw new ErrorNegocio("Ese cliente no tiene licencia", 404);
    await evento(pool, { clienteId: id, licenciaId: r.rows[0].id, tipo: "RESPALDO_ESPACIO", detalle: b, usuarioId: usuarioDe(req) });
    return { ok: true };
  });
  /** Asigna (o quita) el plan de facturación electrónica de un cliente. */
  app.put("/central/portal/clientes/:id/ecf", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ planId: uuid.nullable(), precioUsd: z.number().min(0).max(1_000_000).nullable().optional() }).parse(req.body);
    const r = await pool.query("UPDATE portal_licencias SET ecf_plan_id = $2, ecf_precio_usd = $3, actualizado_en = now() WHERE cliente_id = $1 RETURNING id",
      [id, b.planId, b.planId ? b.precioUsd ?? null : null]);
    if (!r.rowCount) throw new ErrorNegocio("Ese cliente no tiene licencia", 404);
    await evento(pool, { clienteId: id, licenciaId: r.rows[0].id, tipo: "PLAN_ECF", detalle: b, usuarioId: usuarioDe(req) });
    return { ok: true };
  });
  app.put("/central/portal/ecf-tasa", async (req) => {
    const b = z.object({ tasa: z.number().min(1).max(10_000).nullable() }).parse(req.body);
    await pool.query("UPDATE portal_config SET ecf_tasa_dop = $1, actualizado_en = now() WHERE id = 1", [b.tasa]);
    return { ok: true };
  });
  /** Resumen del mes: uso de cada cliente contra su rango, alertas, ingreso, costo y margen (USD). */
  app.get("/central/portal/ecf-resumen", async () => {
    const mes = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 7);
    const [y, m] = mes.split("-").map(Number);
    const anterior = m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
    const planes = (await pool.query<{ id: string; nombre: string; maxMes: number; costoUsd: number; precioUsd: number }>(
      `SELECT id, nombre, max_mes AS "maxMes", costo_usd::float AS "costoUsd", precio_usd::float AS "precioUsd" FROM portal_ecf_planes WHERE activo ORDER BY max_mes`)).rows;
    const filas = (await pool.query<{
      clienteId: string; slug: string; cliente: string; planId: string | null; plan: string | null; maxMes: number | null; costoUsd: number | null;
      precioPlan: number | null; precioEspecial: number | null; actual: number | null; previo: number | null; ultimo: string | null;
    }>(
      `SELECT c.id AS "clienteId", c.slug, c.nombre AS cliente, l.ecf_plan_id AS "planId", p.nombre AS plan, p.max_mes AS "maxMes",
              p.costo_usd::float AS "costoUsd", p.precio_usd::float AS "precioPlan", l.ecf_precio_usd::float AS "precioEspecial",
              (SELECT emitidos FROM portal_ecf_uso u WHERE u.licencia_id = l.id AND u.mes = $1) AS actual,
              (SELECT emitidos FROM portal_ecf_uso u WHERE u.licencia_id = l.id AND u.mes = $2) AS previo,
              (SELECT MAX(actualizado_en) FROM portal_ecf_uso u WHERE u.licencia_id = l.id) AS ultimo
         FROM portal_clientes c JOIN portal_licencias l ON l.cliente_id = c.id LEFT JOIN portal_ecf_planes p ON p.id = l.ecf_plan_id
        WHERE c.activo ORDER BY c.nombre`, [mes, anterior])).rows;
    const clientes = filas.map((f) => {
      const actual = f.actual ?? 0, previo = f.previo ?? 0;
      const precio = f.planId ? f.precioEspecial ?? f.precioPlan ?? 0 : 0;
      const costo = f.planId ? f.costoUsd ?? 0 : 0;
      let estado: "sin-plan" | "ok" | "cerca" | "excedido" | "sin-datos" = "ok";
      if (!f.planId) estado = actual > 0 || previo > 0 ? "sin-plan" : "sin-datos";
      else if (f.maxMes && actual > f.maxMes) estado = "excedido";
      else if (f.maxMes && actual >= f.maxMes * 0.8) estado = "cerca";
      // Dos meses seguidos pasado de su rango (o ya pasado este mes con gran margen): se sugiere el rango que le corresponde
      const sugerir = f.planId && f.maxMes && actual > f.maxMes && previo > f.maxMes;
      const siguiente = sugerir || (f.planId && f.maxMes && actual > f.maxMes) ? planes.find((x) => x.maxMes >= Math.max(actual, previo)) ?? null : null;
      return {
        clienteId: f.clienteId, slug: f.slug, cliente: f.cliente, planId: f.planId, plan: f.plan, maxMes: f.maxMes,
        precioEspecial: f.precioEspecial, precioUsd: precio, costoUsd: costo, margenUsd: Math.round((precio - costo) * 100) / 100,
        actual, anterior: previo, pct: f.maxMes ? Math.round((actual / f.maxMes) * 100) : null, estado,
        dosMesesExcedido: !!sugerir, sugerido: siguiente ? { id: siguiente.id, nombre: siguiente.nombre } : null,
        ultimoReporte: f.ultimo,
      };
    });
    const activos = clientes.filter((x) => x.planId);
    const ingresoUsd = activos.reduce((a, x) => a + x.precioUsd, 0), costoUsd = activos.reduce((a, x) => a + x.costoUsd, 0);
    const tasa = (await pool.query<{ t: number | null }>("SELECT ecf_tasa_dop::float AS t FROM portal_config WHERE id = 1")).rows[0]?.t ?? null;
    return {
      mes, tasaDop: tasa, clientes,
      totales: { conPlan: activos.length, ingresoUsd, costoUsd, margenUsd: Math.round((ingresoUsd - costoUsd) * 100) / 100,
                 excedidos: clientes.filter((x) => x.estado === "excedido").length, cerca: clientes.filter((x) => x.estado === "cerca").length,
                 sinPlan: clientes.filter((x) => x.estado === "sin-plan").length },
    };
  });

  // ---- Certificación del software ante la DGII (una sola para todo FactPOS) ----
  /** ¿Puede FactPOS facturar con e-CF? Requisito por requisito, con lo que falta paso a paso. */
  app.get("/central/portal/verificacion-ecf", async () => verificarSoftware(app));
  app.get("/central/portal/certificacion-dgii", async () => (await pool.query(
    `SELECT tipo_registro AS "tipoRegistro", software_nombre AS "softwareNombre", software_version AS "softwareVersion",
            url_recepcion AS "urlRecepcion", url_aprobacion AS "urlAprobacion", url_autenticacion AS "urlAutenticacion",
            pasos, autorizado, to_char(autorizado_fecha, 'YYYY-MM-DD') AS "autorizadoFecha", referencia, notas, actualizado_en AS "actualizadoEn"
       FROM portal_certificacion_dgii WHERE id = 1`)).rows[0]);
  app.put("/central/portal/certificacion-dgii", async (req) => {
    const url = z.string().trim().max(300).nullable().optional();
    const b = z.object({
      tipoRegistro: z.enum(["EMISOR", "PROVEEDOR"]), softwareNombre: z.string().trim().min(1).max(80), softwareVersion: z.string().trim().max(40).nullable().optional(),
      urlRecepcion: url, urlAprobacion: url, urlAutenticacion: url,
      pasos: z.record(z.string().regex(/^\d{1,2}$/), z.object({
        estado: z.enum(["PENDIENTE", "EN_CURSO", "HECHO"]), nota: z.string().trim().max(300).optional(), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })),
      autorizado: z.boolean(), autorizadoFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      referencia: z.string().trim().max(120).nullable().optional(), notas: z.string().trim().max(2000).nullable().optional(),
    }).parse(req.body);
    await pool.query(
      `UPDATE portal_certificacion_dgii SET tipo_registro = $1, software_nombre = $2, software_version = $3, url_recepcion = $4, url_aprobacion = $5,
              url_autenticacion = $6, pasos = $7::jsonb, autorizado = $8, autorizado_fecha = $9, referencia = $10, notas = $11,
              actualizado_en = now(), actualizado_por = $12 WHERE id = 1`,
      [b.tipoRegistro, b.softwareNombre, b.softwareVersion || null, b.urlRecepcion || null, b.urlAprobacion || null, b.urlAutenticacion || null,
       JSON.stringify(b.pasos), b.autorizado, b.autorizado ? b.autorizadoFecha ?? null : null, b.referencia || null, b.notas || null, usuarioDe(req)]);
    await evento(pool, { tipo: "CERTIFICACION_DGII", detalle: { autorizado: b.autorizado, hechos: Object.values(b.pasos).filter((x) => x.estado === "HECHO").length }, usuarioId: usuarioDe(req) });
    return { ok: true };
  });

  // ---- Instalaciones detectadas y solicitudes de activación
  app.get("/central/portal/instalaciones", async (req) => {
    const { estado } = z.object({ estado: z.enum(["PENDIENTE", "ASIGNADA", "RECHAZADA", "LIBERADA"]).optional() }).parse(req.query);
    return (await pool.query(
      `SELECT i.id, i.estado, i.empresa, i.rnc, i.equipo, i.version_app AS "versionApp", i.sucursales_en_uso AS "sucursalesEnUso", i.api_url AS "apiUrl",
              i.solicitada_en AS "solicitadaEn", i.ultimo_contacto AS "ultimoContacto", i.nota, c.id AS "clienteId", c.nombre AS cliente, c.slug,
              i.correo, i.telefono, i.contacto, i.plan_id AS "planId", p.nombre AS plan, i.sucursales_solicitadas AS "sucursalesSolicitadas", i.mensaje
         FROM portal_instalaciones i LEFT JOIN portal_licencias l ON l.id = i.licencia_id LEFT JOIN portal_clientes c ON c.id = l.cliente_id
         LEFT JOIN portal_planes p ON p.id = i.plan_id
        WHERE ($1::text IS NULL OR i.estado = $1)
        ORDER BY (i.estado = 'PENDIENTE') DESC, i.solicitada_en DESC LIMIT 300`, [estado ?? null])).rows;
  });

  /** Aprobar: asigna la instalación a un cliente que ya existe, o crea uno con los datos de la solicitud. */
  app.post("/central/portal/instalaciones/:id/aprobar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      clienteId: uuid.optional(),
      cliente: esquemaCliente.optional(),
      licencia: esquemaLicencia.partial({ estado: true, modulos: true }),
    }).refine((x) => !!x.clienteId !== !!x.cliente, "Elija un cliente existente o cree uno nuevo").parse(req.body);
    const u = usuarioDe(req);
    return enTransaccion(async (c) => {
      const inst = (await c.query<{ estado: string; secreto_hash: string; version_app: string | null; sucursales_en_uso: number | null; api_url: string | null }>(
        "SELECT estado, secreto_hash, version_app, sucursales_en_uso, api_url FROM portal_instalaciones WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!inst) throw new ErrorNegocio("Solicitud no encontrada", 404);
      if (inst.estado === "ASIGNADA") throw new ErrorNegocio("Esta instalación ya tiene licencia asignada", 409);
      let clienteId = b.clienteId, licId: string;
      if (clienteId) {
        const l = (await c.query<{ id: string; instalacion_id: string | null }>("SELECT id, instalacion_id FROM portal_licencias WHERE cliente_id = $1 FOR UPDATE", [clienteId])).rows[0];
        if (!l) throw new ErrorNegocio("Ese cliente no tiene licencia", 404);
        if (l.instalacion_id && l.instalacion_id !== id) throw new ErrorNegocio("Ese cliente ya tiene otra instalación activada. Libérela primero (en su ficha).", 409);
        licId = l.id;
        await c.query(
          `UPDATE portal_licencias SET sucursales = $2, vence = $3, plan_id = $4, precio_sucursal = COALESCE($5, precio_sucursal), modulos = $6 WHERE id = $1`,
          [licId, b.licencia.sucursales, b.licencia.vence, b.licencia.planId ?? null, b.licencia.precioSucursal ?? null, b.licencia.modulos ?? []]);
      } else {
        clienteId = uuidv7(); licId = uuidv7();
        const k = b.cliente!;
        try {
          await c.query(`INSERT INTO portal_clientes (id, slug, nombre, rnc, contacto, correo, telefono, api_url, notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [clienteId, k.slug, k.nombre, k.rnc ?? null, k.contacto ?? null, k.correo ?? null, k.telefono ?? null, k.apiUrl ?? null, k.notas ?? null]);
        } catch (e) {
          if ((e as { code?: string }).code === "23505") throw new ErrorNegocio(`Ya existe un cliente con el nombre corto «${k.slug}»`, 409);
          throw e;
        }
        await c.query(`INSERT INTO portal_licencias (id, cliente_id, sucursales, modulos, vence, estado, plan_id, precio_sucursal) VALUES ($1,$2,$3,$4,$5,'ACTIVA',$6,$7)`,
          [licId, clienteId, b.licencia.sucursales, b.licencia.modulos ?? [], b.licencia.vence, b.licencia.planId ?? null, b.licencia.precioSucursal ?? null]);
        await evento(c, { licenciaId: licId, clienteId, tipo: "CREADA", detalle: { via: "solicitud", ...b.licencia }, usuarioId: u });
      }
      await c.query(
        `UPDATE portal_licencias SET instalacion_id = $2, secreto_hash = $3, activada_en = COALESCE(activada_en, now()), ultimo_contacto = now(),
                version_app = $4, sucursales_en_uso = $5, estado = 'ACTIVA', actualizado_en = now() WHERE id = $1`,
        [licId, id, inst.secreto_hash, inst.version_app, inst.sucursales_en_uso]);
      if (inst.api_url) await c.query("UPDATE portal_clientes SET api_url = COALESCE(api_url, $2) WHERE id = $1", [clienteId, inst.api_url]);
      await c.query("UPDATE portal_instalaciones SET estado = 'ASIGNADA', licencia_id = $2, resuelta_en = now() WHERE id = $1", [id, licId]);
      await evento(c, { licenciaId: licId, clienteId, tipo: "ACTIVADA", detalle: { via: "solicitud", instalacion: id }, usuarioId: u });
      return { clienteId };
    });
  });

  app.post("/central/portal/instalaciones/:id/rechazar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nota: z.string().trim().max(300).nullable().optional() }).parse(req.body ?? {});
    const r = await pool.query("UPDATE portal_instalaciones SET estado = 'RECHAZADA', nota = $2, resuelta_en = now() WHERE id = $1 AND estado <> 'ASIGNADA' RETURNING id", [id, b.nota ?? null]);
    if (!r.rowCount) throw new ErrorNegocio("Solicitud no encontrada o ya asignada", 404);
    await evento(pool, { tipo: "SOLICITUD_RECHAZADA", detalle: { instalacion: id, nota: b.nota ?? null }, usuarioId: usuarioDe(req) });
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
    await pool.query("UPDATE portal_instalaciones SET estado = 'LIBERADA', licencia_id = NULL, resuelta_en = now() WHERE licencia_id = $1", [r.rows[0].id]);
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
  await rutasInvitaciones(app);
  await rutasPaginas(app);
}

// -------------------------------------------------------------------------------------------
// Versiones publicadas (GitHub Releases). Repositorio privado: GITHUB_TOKEN con permiso de lectura.
// -------------------------------------------------------------------------------------------
interface Publicada { version: string; notas: string | null; publicada: string | null; asset: { url: string; descarga: string } | null; setup: { url: string; descarga: string; nombre: string } | null }
let cacheVersion: { v: Publicada | null; t: number } | null = null;
const encabezadosGitHub = (extra: Record<string, string> = {}) => ({
  "user-agent": "factpos-portal", accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}), ...extra,
});
export async function ultimaVersion(): Promise<Publicada | null> {
  if (cacheVersion && Date.now() - cacheVersion.t < 10 * 60_000) return cacheVersion.v;
  const repo = process.env.FACTPOS_REPO || "supporthng/factpos";
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, { headers: encabezadosGitHub(), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const lista = (await r.json()) as { tag_name: string; draft: boolean; body: string | null; published_at: string | null;
      assets: { name: string; url: string; browser_download_url: string; updated_at?: string }[] }[];
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
    const v = encontrada ? { version: encontrada.version, notas: encontrada.rel.body, publicada: encontrada.asset.updated_at ?? encontrada.rel.published_at, // la etiqueta «ultima» se reutiliza: su fecha propia no cambia, la del archivo sí
      asset: { url: encontrada.asset.url, descarga: encontrada.asset.browser_download_url },
      setup: (() => { const a = encontrada.rel.assets.find((x) => /^FactPOS-Setup-.*\.exe$/i.test(x.name)); return a ? { url: a.url, descarga: a.browser_download_url, nombre: a.name } : null; })() } : null;
    cacheVersion = { v, t: Date.now() };
    return v;
  } catch {
    return cacheVersion?.v ?? null;
  }
}
/** Repositorio privado: GitHub entrega una dirección firmada y temporal del archivo. */
export async function urlDescarga(a: { url: string; descarga: string }) {
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
