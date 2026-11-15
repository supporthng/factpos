import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { sucursalesDe } from "../sesion.js";
import { normalizarSerie } from "./ventas.js";

/**
 * Series y garantías (administración): busca un equipo por su número de serie / IMEI, por el cliente o por la factura,
 * y dice si su garantía está vigente. Las series se capturan al facturar (productos con «Lleva número de serie»).
 */
const uuid = z.string().uuid();
export async function rutasCentralSeries(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  app.get("/central/series", async (req) => {
    const f = z.object({
      q: z.string().trim().max(60).optional(),
      garantia: z.enum(["vigente", "por_vencer", "vencida"]).optional(),
      sucursalId: uuid.optional(),
    }).parse(req.query);
    const permitidas = sucursalesDe(req);
    const params: unknown[] = [empresaDe(req), permitidas, f.sucursalId ?? null];
    const cond: string[] = [];
    if (f.q) {
      params.push(`%${f.q}%`, `%${normalizarSerie(f.q)}%`);
      cond.push(`(sp.serie LIKE $5 OR cl.nombre ILIKE $4 OR COALESCE(cl.documento,'') ILIKE $4 OR p.nombre ILIKE $4 OR d.encf ILIKE $4)`);
    }
    if (f.garantia === "vigente") cond.push("sp.devuelta_en IS NULL AND sp.garantia_hasta >= CURRENT_DATE");
    if (f.garantia === "por_vencer") cond.push("sp.devuelta_en IS NULL AND sp.garantia_hasta BETWEEN CURRENT_DATE AND CURRENT_DATE + 30");
    if (f.garantia === "vencida") cond.push("sp.devuelta_en IS NULL AND sp.garantia_hasta < CURRENT_DATE");
    const r = await pool.query(
      `SELECT sp.id, sp.serie, p.nombre AS producto, p.sku, cl.nombre AS cliente, cl.documento AS "clienteDocumento", s.nombre AS sucursal,
              sp.venta_id AS "ventaId", v.numero_interno::text AS numero, d.encf, sp.vendida_en AS "vendidaEn", sp.garantia_hasta::text AS "garantiaHasta",
              CASE WHEN sp.devuelta_en IS NOT NULL THEN 'DEVUELTA'
                   WHEN sp.garantia_hasta IS NULL THEN 'SIN_GARANTIA'
                   WHEN sp.garantia_hasta < CURRENT_DATE THEN 'VENCIDA'
                   WHEN sp.garantia_hasta <= CURRENT_DATE + 30 THEN 'POR_VENCER'
                   ELSE 'VIGENTE' END AS estado
         FROM series_producto sp
         JOIN productos p ON p.id = sp.producto_id AND p.empresa_id = $1
         JOIN sucursales s ON s.id = sp.sucursal_id
         JOIN ventas v ON v.id = sp.venta_id
         LEFT JOIN ecf_documentos d ON d.venta_id = v.id
         LEFT JOIN clientes cl ON cl.id = sp.cliente_id
        WHERE ($2::uuid[] IS NULL OR sp.sucursal_id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR sp.sucursal_id = $3)
          ${cond.length ? "AND " + cond.join(" AND ") : ""}
        ORDER BY sp.vendida_en DESC LIMIT 200`, params);
    return r.rows;
  });
}
