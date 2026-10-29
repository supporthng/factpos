import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { contextoCaja } from "../contexto.js";

/** Reportes del día para la sucursal (los pesados se consultan en la nube). */
export async function rutasReportes(app: FastifyInstance) {
  app.get("/cajas/:cajaId/reportes/turno", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const r = await pool.query(
      `SELECT c.*, (c.fondo_inicial + c.ventas_efectivo + c.entradas - c.salidas) AS efectivo_esperado
         FROM rpt_cuadre_turno c
        WHERE c.caja_id = $1 AND c.cerrado_en IS NULL`,
      [cajaId],
    );
    const pagos = r.rowCount
      ? (await pool.query("SELECT forma_pago, monto, operaciones FROM rpt_formas_pago WHERE turno_id = $1", [r.rows[0].turno_id])).rows
      : [];
    return { turno: r.rows[0] ?? null, formasPago: pagos };
  });

  app.get("/cajas/:cajaId/reportes/bajo-minimo", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query("SELECT * FROM rpt_bajo_minimo WHERE sucursal_id = $1 ORDER BY nombre", [ctx.sucursalId]);
    return r.rows;
  });
}
