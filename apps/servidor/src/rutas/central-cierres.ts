import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";
import { reporteTurno } from "./cierre.js";

/**
 * Cierres de caja (administración): todos los turnos con su cuadre, la revisión del supervisor
 * (obligatoria cuando la diferencia pasa del monto configurado) y el depósito del efectivo.
 */
const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

async function umbral(empresaId: string): Promise<number> {
  const r = await pool.query<{ u: string }>("SELECT umbral_diferencia::text AS u FROM cierres_config WHERE empresa_id = $1", [empresaId]);
  return Number(r.rows[0]?.u ?? 0);
}

export async function rutasCentralCierres(app: FastifyInstance) {
  app.get("/central/cierres/config", async (req) => ({ umbralDiferencia: await umbral(empresaDe(req)) }));

  app.put("/central/cierres/config", async (req) => {
    const b = z.object({ umbralDiferencia: z.number().min(0).max(1e7) }).parse(req.body);
    await pool.query(
      `INSERT INTO cierres_config (empresa_id, umbral_diferencia) VALUES ($1,$2)
       ON CONFLICT (empresa_id) DO UPDATE SET umbral_diferencia = $2, actualizado_en = now()`,
      [empresaDe(req), b.umbralDiferencia.toFixed(2)],
    );
    return { ok: true };
  });

  /** Lista de turnos. «porRevisar»: cierres con diferencia mayor al umbral que nadie ha revisado. */
  app.get("/central/cierres", async (req) => {
    const e = empresaDe(req);
    const f = z.object({
      desde: fecha.optional(), hasta: fecha.optional(), sucursalId: uuid.optional(), cajaId: uuid.optional(),
      usuarioId: uuid.optional(), estado: z.enum(["todos", "porRevisar", "abiertos", "conDiferencia"]).default("todos"),
    }).parse(req.query);
    const u = await umbral(e);
    const r = await pool.query(
      `SELECT t.id, s.nombre AS sucursal, ca.nombre AS caja, uo.nombre AS cajero, t.estado,
              t.abierto_en AS "abiertoEn", t.cerrado_en AS "cerradoEn", t.fondo_inicial::text AS "fondoInicial",
              t.declarado, t.esperado, t.diferencia::text AS diferencia,
              COALESCE((SELECT SUM(CASE WHEN v.tipo_documento IN ('E34','ANU') THEN -v.total ELSE v.total END) FROM ventas v WHERE v.turno_id = t.id), 0)::text AS ventas,
              (SELECT COUNT(*) FROM ventas v WHERE v.turno_id = t.id AND v.tipo_documento NOT IN ('E34','ANU'))::int AS facturas,
              t.revisado_en AS "revisadoEn", ur.nombre AS "revisadoPor", t.nota_revision AS "notaRevision",
              t.deposito_monto::text AS "depositoMonto", t.deposito_en AS "depositoEn", t.deposito_referencia AS "depositoReferencia",
              (t.estado = 'CERRADO' AND $7::numeric > 0 AND ABS(COALESCE(t.diferencia, 0)) > $7::numeric AND t.revisado_en IS NULL) AS "porRevisar"
         FROM turnos t
         JOIN sucursales s ON s.id = t.sucursal_id JOIN cajas ca ON ca.id = t.caja_id
         JOIN usuarios uo ON uo.id = t.usuario_id LEFT JOIN usuarios ur ON ur.id = t.revisado_por
        WHERE s.empresa_id = $1
          AND ($2::date IS NULL OR (t.abierto_en AT TIME ZONE 'America/Santo_Domingo')::date >= $2)
          AND ($3::date IS NULL OR (t.abierto_en AT TIME ZONE 'America/Santo_Domingo')::date <= $3)
          AND ($4::uuid IS NULL OR t.sucursal_id = $4) AND ($5::uuid IS NULL OR t.caja_id = $5) AND ($6::uuid IS NULL OR t.usuario_id = $6)
          AND ($8::uuid[] IS NULL OR t.sucursal_id = ANY($8))
        ORDER BY t.abierto_en DESC LIMIT 500`,
      [e, f.desde ?? null, f.hasta ?? null, f.sucursalId ?? null, f.cajaId ?? null, f.usuarioId ?? null, u, sucursalesDe(req)],
    );
    let filas = r.rows;
    if (f.estado === "porRevisar") filas = filas.filter((x) => x.porRevisar);
    else if (f.estado === "abiertos") filas = filas.filter((x) => x.estado === "ABIERTO");
    else if (f.estado === "conDiferencia") filas = filas.filter((x) => x.estado === "CERRADO" && Number(x.diferencia) !== 0);
    const cerradas = filas.filter((x) => x.estado === "CERRADO");
    const suma = (k: string) => filas.reduce((a, x) => a + Number(x[k] ?? 0), 0);
    return {
      umbralDiferencia: u,
      filas,
      totales: {
        ventas: suma("ventas").toFixed(2), facturas: filas.reduce((a, x) => a + x.facturas, 0),
        diferencia: cerradas.reduce((a, x) => a + Number(x.diferencia ?? 0), 0).toFixed(2),
        porRevisar: filas.filter((x) => x.porRevisar).length,
      },
    };
  });

  /** Reporte completo de un turno (abierto o cerrado). */
  app.get("/central/cierres/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const dueno = await pool.query<{ sucursal_id: string }>(
      "SELECT t.sucursal_id FROM turnos t JOIN sucursales s ON s.id = t.sucursal_id WHERE t.id = $1 AND s.empresa_id = $2", [id, empresaDe(req)]);
    if (!dueno.rowCount) throw new ErrorNegocio("Turno no encontrado", 404);
    const suc = sucursalesDe(req);
    if (suc && !suc.includes(dueno.rows[0].sucursal_id)) throw new ErrorNegocio("No tiene acceso a esa sucursal", 403);
    const rep = await reporteTurno(pool, id);
    const x = (await pool.query(
      `SELECT t.revisado_en AS "revisadoEn", ur.nombre AS "revisadoPor", t.nota_revision AS "notaRevision",
              t.deposito_monto::text AS "depositoMonto", t.deposito_en AS "depositoEn", t.deposito_referencia AS "depositoReferencia", ud.nombre AS "depositoPor"
         FROM turnos t LEFT JOIN usuarios ur ON ur.id = t.revisado_por LEFT JOIN usuarios ud ON ud.id = t.deposito_por WHERE t.id = $1`, [id])).rows[0];
    return { ...rep, revision: x, umbralDiferencia: await umbral(empresaDe(req)) };
  });

  /** El supervisor revisa el cierre: con diferencia mayor al umbral la nota es obligatoria. */
  app.put("/central/cierres/:id/revision", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nota: z.string().trim().max(300).default("") }).parse(req.body);
    const e = empresaDe(req);
    const t = await pool.query<{ diferencia: string | null; estado: string; sucursal_id: string }>(
      "SELECT t.diferencia::text, t.estado, t.sucursal_id FROM turnos t JOIN sucursales s ON s.id = t.sucursal_id WHERE t.id = $1 AND s.empresa_id = $2", [id, e]);
    if (!t.rowCount) throw new ErrorNegocio("Turno no encontrado", 404);
    const suc = sucursalesDe(req);
    if (suc && !suc.includes(t.rows[0].sucursal_id)) throw new ErrorNegocio("No tiene acceso a esa sucursal", 403);
    if (t.rows[0].estado !== "CERRADO") throw new ErrorNegocio("El turno sigue abierto");
    const u = await umbral(e);
    if (u > 0 && Math.abs(Number(t.rows[0].diferencia ?? 0)) > u && b.nota.length < 3) throw new ErrorNegocio("Escriba una nota explicando la diferencia");
    await pool.query("UPDATE turnos SET revisado_en = now(), revisado_por = $2, nota_revision = $3, version = version + 1, actualizado_en = now() WHERE id = $1",
      [id, usuarioDe(req), b.nota || null]);
    return { ok: true };
  });

  /** Depósito del efectivo del cierre. */
  app.put("/central/cierres/:id/deposito", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ monto: z.number().min(0).max(1e9), referencia: z.string().trim().max(80).default("") }).parse(req.body);
    const t = await pool.query<{ estado: string; sucursal_id: string }>(
      "SELECT t.estado, t.sucursal_id FROM turnos t JOIN sucursales s ON s.id = t.sucursal_id WHERE t.id = $1 AND s.empresa_id = $2", [id, empresaDe(req)]);
    if (!t.rowCount) throw new ErrorNegocio("Turno no encontrado", 404);
    const suc = sucursalesDe(req);
    if (suc && !suc.includes(t.rows[0].sucursal_id)) throw new ErrorNegocio("No tiene acceso a esa sucursal", 403);
    if (t.rows[0].estado !== "CERRADO") throw new ErrorNegocio("El turno sigue abierto");
    await pool.query(
      "UPDATE turnos SET deposito_monto = $2, deposito_en = now(), deposito_por = $3, deposito_referencia = $4, version = version + 1, actualizado_en = now() WHERE id = $1",
      [id, b.monto.toFixed(2), usuarioDe(req), b.referencia || null]);
    return { ok: true };
  });
}
