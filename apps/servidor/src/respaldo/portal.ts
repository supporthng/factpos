import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { huella, igual } from "../licencia/portal.js";
import { destinoDeEntorno, presignar } from "./s3.js";

/**
 * Portal: guarda los respaldos cifrados de cada licencia en un almacenamiento compatible con S3 (Cloudflare R2, etc.).
 * Las instalaciones nunca ven las llaves: piden direcciones temporales (15 minutos) y el portal valida la licencia y el espacio.
 *   RESPALDO_S3_ENDPOINT / _BUCKET / _KEY_ID / _SECRET / _REGION    RESPALDO_MAX_GB (por licencia, 2 por defecto) + espacio extra contratado (portal_licencias.respaldo_extra_gb)
 */
const MAX_GB = () => Number(process.env.RESPALDO_MAX_GB ?? 2);
const credenciales = z.object({ licenciaId: z.string().uuid(), instalacionId: z.string().uuid(), secreto: z.string().min(20).max(80) });

/** Valida que la petición venga de la instalación activada de una licencia vigente. */
export async function autorizarLicencia(cuerpo: unknown) {
  const b = credenciales.parse(cuerpo);
  const l = (await pool.query<{ id: string; instalacion_id: string | null; secreto_hash: string | null; estado: string; cliente_activo: boolean; slug: string; extra_gb: number; lector_cupo: number }>(
    `SELECT l.id, l.instalacion_id, l.secreto_hash, l.estado, l.respaldo_extra_gb AS extra_gb, l.lector_cupo, c.activo AS cliente_activo, c.slug
       FROM portal_licencias l JOIN portal_clientes c ON c.id = l.cliente_id WHERE l.id = $1`, [b.licenciaId])).rows[0];
  if (!l || l.instalacion_id !== b.instalacionId || !igual(l.secreto_hash, huella(b.secreto)))
    throw new ErrorNegocio("Esta instalación no está autorizada para esa licencia.", 401);
  if (l.estado !== "ACTIVA" || !l.cliente_activo) throw new ErrorNegocio("Esta licencia está suspendida. Comuníquese con su proveedor.", 403);
  return l;
}

async function autorizar(cuerpo: unknown) {
  const l = await autorizarLicencia(cuerpo);
  const destino = destinoDeEntorno();
  if (!destino) throw new ErrorNegocio("La copia en la nube todavía no está disponible. Su proveedor la activará pronto.", 503);
  return { l, destino };
}

/** Se conservan los 30 más recientes y uno por mes de los últimos 12 meses */
async function podar(licenciaId: string, borrar: (objeto: string) => Promise<void>) {
  const r = (await pool.query<{ id: string; objeto: string; creado_en: string }>(
    "SELECT id, objeto, creado_en FROM portal_respaldos WHERE licencia_id = $1 AND confirmado ORDER BY creado_en DESC", [licenciaId])).rows;
  const mantener = new Set(r.slice(0, 30).map((x) => x.id));
  const meses = new Set<string>();
  for (const x of r) { const m = new Date(x.creado_en).toISOString().slice(0, 7); if (!meses.has(m) && meses.size < 12) { meses.add(m); mantener.add(x.id); } }
  for (const x of r.filter((y) => !mantener.has(y.id))) {
    await borrar(x.objeto).catch(() => undefined);
    await pool.query("DELETE FROM portal_respaldos WHERE id = $1", [x.id]);
  }
}

export async function rutasPortalRespaldo(app: FastifyInstance) {
  app.post("/licencias/respaldo/url", async (req) => {
    const { l, destino } = await autorizar(req.body);
    const b = z.object({ tamano: z.number().int().min(1).max(5 * 1024 ** 3), nombre: z.string().regex(/^[\w.-]{5,120}$/) }).parse(req.body);
    const usado = Number((await pool.query<{ n: string }>("SELECT COALESCE(sum(tamano),0) AS n FROM portal_respaldos WHERE licencia_id = $1", [l.id])).rows[0]!.n);
    const tope = MAX_GB() + l.extra_gb;
    if ((usado + b.tamano) / 1024 ** 3 > tope * 1.5) // margen: la poda libera espacio al confirmar
      throw new ErrorNegocio(`Se llenó el espacio de respaldos de su licencia (${tope} GB). Comuníquese con su proveedor para ampliarlo.`, 413);
    const objeto = `${l.id}/${new Date().getFullYear()}/${uuidv7().slice(0, 8)}-${b.nombre}.cif`;
    await pool.query("INSERT INTO portal_respaldos (id, licencia_id, objeto, tamano) VALUES ($1,$2,$3,$4)", [uuidv7(), l.id, objeto, b.tamano]);
    return { url: presignar(destino, "PUT", objeto, 900), objeto };
  });

  app.post("/licencias/respaldo/confirmar", async (req) => {
    const { l, destino } = await autorizar(req.body);
    const b = z.object({ objeto: z.string().max(300), tamano: z.number().int().min(1) }).parse(req.body);
    const r = await pool.query("UPDATE portal_respaldos SET confirmado = TRUE, tamano = $3 WHERE licencia_id = $1 AND objeto = $2", [l.id, b.objeto, b.tamano]);
    if (!r.rowCount) throw new ErrorNegocio("Respaldo desconocido", 404);
    await pool.query("DELETE FROM portal_respaldos WHERE licencia_id = $1 AND NOT confirmado AND creado_en < now() - interval '1 day'", [l.id]);
    await podar(l.id, async (o) => { await fetch(presignar(destino, "DELETE", o, 300), { method: "DELETE" }); });
    return { ok: true };
  });

  /** El cliente pide más espacio: queda como aviso para el proveedor (una solicitud por día) */
  app.post("/licencias/respaldo/solicitar-espacio", async (req) => {
    const { l } = await autorizar(req.body);
    const b = z.object({ gb: z.number().int().min(1).max(500) }).parse(req.body);
    const ya = await pool.query("SELECT 1 FROM portal_eventos WHERE licencia_id = $1 AND tipo = 'ESPACIO_SOLICITADO' AND creado_en > now() - interval '1 day'", [l.id]);
    if (ya.rowCount) return { ok: true, yaEnviada: true };
    const c = await pool.query<{ cliente_id: string }>("SELECT cliente_id FROM portal_licencias WHERE id = $1", [l.id]);
    await pool.query("INSERT INTO portal_eventos (id, licencia_id, cliente_id, tipo, detalle) VALUES (gen_random_uuid(), $1, $2, 'ESPACIO_SOLICITADO', $3)",
      [l.id, c.rows[0]?.cliente_id ?? null, JSON.stringify({ gb: b.gb })]);
    return { ok: true, yaEnviada: false };
  });

  app.post("/licencias/respaldo/lista", async (req) => {
    const { l } = await autorizar(req.body);
    const r = (await pool.query<{ objeto: string; tamano: string; creado_en: string }>(
      "SELECT objeto, tamano, creado_en FROM portal_respaldos WHERE licencia_id = $1 AND confirmado ORDER BY creado_en DESC", [l.id])).rows;
    return {
      respaldos: r.map((x) => ({ objeto: x.objeto, nombre: x.objeto.split("/").pop()!.replace(/^[0-9a-f]{8}-/, "").replace(/\.cif$/, ""), tamano: Number(x.tamano), creado: x.creado_en })),
      usadoMb: Math.round(r.reduce((s, x) => s + Number(x.tamano), 0) / 1048576), maxGb: MAX_GB() + l.extra_gb,
    };
  });

  app.post("/licencias/respaldo/bajar", async (req) => {
    const { l, destino } = await autorizar(req.body);
    const b = z.object({ objeto: z.string().max(300) }).parse(req.body);
    const ok = (await pool.query("SELECT 1 FROM portal_respaldos WHERE licencia_id = $1 AND objeto = $2 AND confirmado", [l.id, b.objeto])).rowCount;
    if (!ok) throw new ErrorNegocio("Respaldo desconocido", 404);
    return { url: presignar(destino, "GET", b.objeto, 900) };
  });
}
