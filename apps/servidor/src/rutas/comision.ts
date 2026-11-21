import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";

/**
 * Comisiones de vendedores. Se devengan sobre lo COBRADO (neto de ITBIS) de las facturas que el vendedor armó en
 * Administración: al cobrar de contado, la inicial de una venta a plazos y cada abono que se aplica a esa factura.
 * El % es el de la empresa, o el propio del vendedor si tiene uno. Si la factura se anula, su comisión pendiente deja de contar.
 * (Verla y liquidarla pide el permiso «admin.comisiones».)
 */
type Db = Pick<PoolClient, "query">;
const uuid = z.string().uuid();
const fechaZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const RD = "America/Santo_Domingo";
const ANULADA = `EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = c.venta_id AND NOT n.parcial AND n.tipo_documento IN ('E34','ANU'))`;

/** Devenga la comisión de una cobranza aplicada a una factura. No hace nada si la factura no la armó un vendedor o el % es 0. */
export async function devengarComision(c: Db, d: { ventaId: string; cobrado: Decimal.Value; concepto: "CONTADO" | "INICIAL" | "ABONO" }) {
  const cobrado = new Decimal(d.cobrado);
  if (cobrado.lte(0)) return;
  const r = await c.query<{ vendedor: string; total: string; neto: string; sucursal: string; empresa: string; ya: string; pct: string | null }>(
    `SELECT f.creada_por AS vendedor, v.total::text, (v.total - v.itbis - v.isc)::text AS neto, v.sucursal_id AS sucursal, s.empresa_id AS empresa,
            COALESCE((SELECT SUM(cobrado) FROM comisiones WHERE venta_id = v.id), 0)::text AS ya,
            COALESCE((SELECT porcentaje FROM comision_vendedores WHERE empresa_id = s.empresa_id AND usuario_id = f.creada_por),
                     (SELECT porcentaje_defecto FROM comision_config WHERE empresa_id = s.empresa_id))::text AS pct
       FROM ventas_por_cobrar f JOIN ventas v ON v.id = f.venta_id JOIN sucursales s ON s.id = v.sucursal_id
      WHERE f.venta_id = $1 AND f.creada_por IS NOT NULL`, [d.ventaId]);
  const f = r.rows[0];
  if (!f || !f.pct || new Decimal(f.pct).lte(0)) return;
  const total = new Decimal(f.total);
  if (total.lte(0)) return;
  // Nunca más que el total de la factura (los intereses de un plan no pagan comisión)
  const aplicable = Decimal.min(cobrado, total.minus(f.ya));
  if (aplicable.lte(0)) return;
  const base = aplicable.times(f.neto).div(total).toDecimalPlaces(2);
  const monto = base.times(f.pct).div(100).toDecimalPlaces(2);
  if (monto.lte(0)) return;
  await c.query(
    `INSERT INTO comisiones (id, empresa_id, sucursal_id, vendedor_id, venta_id, concepto, cobrado, base, porcentaje, monto) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [uuidv7(), f.empresa, f.sucursal, f.vendedor, d.ventaId, d.concepto, aplicable.toFixed(2), base.toFixed(2), f.pct, monto.toFixed(2)]);
}

export async function rutasComisiones(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  /** % general y % propio de cada vendedor (quien tiene el permiso de vender o ya armó ventas) */
  app.get("/central/comisiones/config", async (req) => {
    const e = empresaDe(req);
    const [cfg, v] = await Promise.all([
      pool.query("SELECT porcentaje_defecto::text AS p FROM comision_config WHERE empresa_id = $1", [e]),
      pool.query(
        `SELECT u.id AS "usuarioId", u.nombre, u.activo, cv.porcentaje::text AS porcentaje
           FROM usuarios u JOIN roles r ON r.id = u.rol_id LEFT JOIN comision_vendedores cv ON cv.empresa_id = u.empresa_id AND cv.usuario_id = u.id
          WHERE u.empresa_id = $1 AND (('admin.vender' = ANY(r.permisos) AND u.activo) OR cv.usuario_id IS NOT NULL OR EXISTS (SELECT 1 FROM comisiones c WHERE c.vendedor_id = u.id))
          ORDER BY u.nombre`, [e]),
    ]);
    return { porcentajeDefecto: cfg.rows[0]?.p ?? "0.00", vendedores: v.rows };
  });

  app.put("/central/comisiones/config", async (req) => {
    const e = empresaDe(req);
    const b = z.object({
      porcentajeDefecto: z.coerce.number().min(0).max(100),
      vendedores: z.array(z.object({ usuarioId: uuid, porcentaje: z.coerce.number().min(0).max(100).nullable() })).max(500),
    }).parse(req.body);
    await enTransaccion(async (c) => {
      await c.query(
        `INSERT INTO comision_config (empresa_id, porcentaje_defecto) VALUES ($1,$2)
         ON CONFLICT (empresa_id) DO UPDATE SET porcentaje_defecto = EXCLUDED.porcentaje_defecto, actualizado_en = now()`, [e, b.porcentajeDefecto]);
      for (const v of b.vendedores) {
        if (v.porcentaje === null) await c.query("DELETE FROM comision_vendedores WHERE empresa_id = $1 AND usuario_id = $2", [e, v.usuarioId]);
        else {
          if (!(await c.query("SELECT 1 FROM usuarios WHERE id = $1 AND empresa_id = $2", [v.usuarioId, e])).rowCount) throw new ErrorNegocio("Vendedor no válido", 404);
          await c.query(
            `INSERT INTO comision_vendedores (empresa_id, usuario_id, porcentaje) VALUES ($1,$2,$3)
             ON CONFLICT (empresa_id, usuario_id) DO UPDATE SET porcentaje = EXCLUDED.porcentaje`, [e, v.usuarioId, v.porcentaje]);
        }
      }
    });
    return { ok: true };
  });

  const rango = z.object({ desde: fechaZ.optional(), hasta: fechaZ.optional() });
  const filtroFecha = (q: { desde?: string; hasta?: string }, params: unknown[]) => {
    const cond: string[] = [];
    if (q.desde) { params.push(q.desde); cond.push(`(c.creado_en AT TIME ZONE '${RD}')::date >= $${params.length}`); }
    if (q.hasta) { params.push(q.hasta); cond.push(`(c.creado_en AT TIME ZONE '${RD}')::date <= $${params.length}`); }
    return cond.length ? ` AND ${cond.join(" AND ")}` : "";
  };

  /** Por vendedor: lo cobrado, la comisión generada y lo que está por pagar */
  app.get("/central/comisiones/resumen", async (req) => {
    const e = empresaDe(req);
    const q = rango.parse(req.query);
    const params: unknown[] = [e];
    const f = filtroFecha(q, params);
    const r = await pool.query(
      `SELECT c.vendedor_id AS "vendedorId", u.nombre AS vendedor, COUNT(DISTINCT c.venta_id)::int AS facturas,
              SUM(c.cobrado) FILTER (WHERE NOT ${ANULADA})::text AS cobrado, SUM(c.base) FILTER (WHERE NOT ${ANULADA})::text AS base,
              SUM(c.monto) FILTER (WHERE NOT ${ANULADA})::text AS comision,
              SUM(c.monto) FILTER (WHERE NOT ${ANULADA} AND c.liquidacion_id IS NULL)::text AS pendiente,
              SUM(c.monto) FILTER (WHERE NOT ${ANULADA} AND c.liquidacion_id IS NOT NULL)::text AS liquidada,
              SUM(c.monto) FILTER (WHERE ${ANULADA})::text AS anulada
         FROM comisiones c JOIN usuarios u ON u.id = c.vendedor_id
        WHERE c.empresa_id = $1${f} GROUP BY c.vendedor_id, u.nombre ORDER BY u.nombre`, params);
    const z0 = (x: string | null) => x ?? "0.00";
    return r.rows.map((x) => ({ ...x, cobrado: z0(x.cobrado), base: z0(x.base), comision: z0(x.comision), pendiente: z0(x.pendiente), liquidada: z0(x.liquidada), anulada: z0(x.anulada) }));
  });

  /** Cada devengo de un vendedor: factura, cliente, qué se cobró y cuánto le toca */
  app.get("/central/comisiones/detalle", async (req) => {
    const e = empresaDe(req);
    const q = rango.extend({ vendedorId: uuid }).parse(req.query);
    const params: unknown[] = [e, q.vendedorId];
    const f = filtroFecha(q, params);
    const r = await pool.query(
      `SELECT c.id, c.creado_en AS fecha, c.concepto, v.numero_interno AS factura, COALESCE(d.encf, v.numero_documento) AS documento, cl.nombre AS cliente,
              c.cobrado::text, c.base::text, c.porcentaje::text, c.monto::text, c.liquidacion_id AS "liquidacionId", ${ANULADA} AS anulada
         FROM comisiones c JOIN ventas v ON v.id = c.venta_id
         LEFT JOIN ecf_documentos d ON d.venta_id = v.id LEFT JOIN clientes cl ON cl.id = v.cliente_id
        WHERE c.empresa_id = $1 AND c.vendedor_id = $2${f} ORDER BY c.creado_en DESC LIMIT 1000`, params);
    return r.rows;
  });

  /** Paga (liquida) todo lo pendiente del vendedor hasta una fecha. Lo de facturas anuladas no se incluye. */
  app.post("/central/comisiones/liquidar", async (req, rep) => {
    const e = empresaDe(req);
    const b = z.object({ vendedorId: uuid, hasta: fechaZ, notas: z.string().trim().max(300).optional() }).parse(req.body);
    const out = await enTransaccion(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('comision_liq:' || $1))", [e]);
      const ids = await c.query<{ id: string; monto: string }>(
        `SELECT c.id, c.monto::text FROM comisiones c
          WHERE c.empresa_id = $1 AND c.vendedor_id = $2 AND c.liquidacion_id IS NULL AND (c.creado_en AT TIME ZONE '${RD}')::date <= $3 AND NOT ${ANULADA} FOR UPDATE`,
        [e, b.vendedorId, b.hasta]);
      if (!ids.rowCount) throw new ErrorNegocio("No hay comisiones pendientes de pago hasta esa fecha", 409);
      const total = ids.rows.reduce((a, x) => a.plus(x.monto), new Decimal(0));
      const id = uuidv7();
      const n = await c.query<{ numero: string }>(
        `INSERT INTO comision_liquidaciones (id, empresa_id, vendedor_id, numero, desde, hasta, total, notas, creada_por)
         VALUES ($1,$2,$3,(SELECT COALESCE(MAX(numero),0)+1 FROM comision_liquidaciones WHERE empresa_id = $2),
                 (SELECT MIN((c.creado_en AT TIME ZONE '${RD}')::date) FROM comisiones c WHERE c.id = ANY($4::uuid[])),$5,$6,$7,$8) RETURNING numero::text`,
        [id, e, b.vendedorId, ids.rows.map((x) => x.id), b.hasta, total.toFixed(2), b.notas ?? null, usuarioDe(req)]);
      await c.query("UPDATE comisiones SET liquidacion_id = $1 WHERE id = ANY($2::uuid[])", [id, ids.rows.map((x) => x.id)]);
      return { id, numero: n.rows[0].numero, total: total.toFixed(2), lineas: ids.rowCount };
    });
    rep.code(201);
    return out;
  });

  app.get("/central/comisiones/liquidaciones", async (req) => {
    const e = empresaDe(req);
    const q = z.object({ vendedorId: uuid.optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT l.id, l.numero::text, l.desde, l.hasta, l.total::text, l.notas, l.creada_en AS fecha, u.nombre AS vendedor, p.nombre AS "creadaPor",
              (SELECT COUNT(*)::int FROM comisiones c WHERE c.liquidacion_id = l.id) AS lineas
         FROM comision_liquidaciones l JOIN usuarios u ON u.id = l.vendedor_id LEFT JOIN usuarios p ON p.id = l.creada_por
        WHERE l.empresa_id = $1 ${q.vendedorId ? "AND l.vendedor_id = $2" : ""} ORDER BY l.numero DESC LIMIT 200`, q.vendedorId ? [e, q.vendedorId] : [e]);
    return r.rows;
  });
}
