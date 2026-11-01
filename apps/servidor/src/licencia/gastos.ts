import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";

/** Apps de pago del proveedor y su costo mensual → costo por licencia y por sucursal (solo portal) */
const Gasto = z.object({
  servicio: z.string().trim().min(2).max(80),
  para: z.string().trim().max(200).nullable().optional(),
  monto: z.number().min(0).max(100_000_000),
  moneda: z.enum(["USD", "DOP"]),
  tasa: z.number().gt(0).max(10_000).default(1),
  activo: z.boolean().default(true),
  notas: z.string().trim().max(500).nullable().optional(),
});

export async function rutasPortalGastos(app: FastifyInstance) {
  app.get("/central/portal/gastos", async () => {
    const g = await pool.query(
      `SELECT id, servicio, para, monto::float, moneda, tasa::float, activo, notas,
              (monto * CASE WHEN moneda = 'DOP' THEN 1 ELSE tasa END)::float AS "montoDop"
         FROM portal_gastos ORDER BY activo DESC, servicio`);
    // Licencias que pagan: vigentes/activas; ingreso mensual = precio × sucursales (el plan anual se divide en 12)
    const l = await pool.query<{ licencias: string; sucursales: string; ingreso: string }>(
      `SELECT count(*) AS licencias, COALESCE(sum(l.sucursales),0) AS sucursales,
              COALESCE(sum(COALESCE(l.precio_sucursal, p.precio_sucursal, 0) * l.sucursales / CASE WHEN p.periodo = 'ANUAL' THEN 12 ELSE 1 END),0) AS ingreso
         FROM portal_licencias l LEFT JOIN portal_planes p ON p.id = l.plan_id
        WHERE l.estado <> 'SUSPENDIDA' AND (l.vence IS NULL OR l.vence >= CURRENT_DATE)`);
    const total = g.rows.filter((x) => x.activo).reduce((s, x) => s + x.montoDop, 0);
    const lic = Number(l.rows[0]!.licencias), suc = Number(l.rows[0]!.sucursales), ingreso = Number(l.rows[0]!.ingreso);
    return {
      gastos: g.rows, totalMensualDop: total, licencias: lic, sucursales: suc, ingresoMensualDop: ingreso,
      costoPorLicencia: lic ? total / lic : null, costoPorSucursal: suc ? total / suc : null, margenDop: ingreso - total,
    };
  });
  app.post("/central/portal/gastos", async (req) => {
    const b = Gasto.parse(req.body);
    const r = await pool.query("INSERT INTO portal_gastos (servicio, para, monto, moneda, tasa, activo, notas) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [b.servicio, b.para ?? null, b.monto, b.moneda, b.moneda === "DOP" ? 1 : b.tasa, b.activo, b.notas ?? null]);
    return { id: r.rows[0].id };
  });
  app.put("/central/portal/gastos/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = Gasto.parse(req.body);
    const r = await pool.query("UPDATE portal_gastos SET servicio=$2, para=$3, monto=$4, moneda=$5, tasa=$6, activo=$7, notas=$8 WHERE id=$1",
      [id, b.servicio, b.para ?? null, b.monto, b.moneda, b.moneda === "DOP" ? 1 : b.tasa, b.activo, b.notas ?? null]);
    if (!r.rowCount) throw new ErrorNegocio("No existe ese gasto", 404);
    return { ok: true };
  });
  app.delete("/central/portal/gastos/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await pool.query("DELETE FROM portal_gastos WHERE id = $1", [id]);
    return { ok: true };
  });
}
