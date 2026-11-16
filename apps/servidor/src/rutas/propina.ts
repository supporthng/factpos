import type { PoolClient } from "pg";

/** Tasa de la propina legal de la empresa (0.10 = 10 %), la de la planilla de impuestos en Fiscal; 10 % si no hay fila. */
export async function tasaPropina(c: Pick<PoolClient, "query">, empresaId: string): Promise<number> {
  const r = await c.query<{ t: string }>("SELECT tasa::text AS t FROM impuestos WHERE empresa_id = $1 AND tipo = 'PROPINA' AND activo ORDER BY actualizado_en DESC LIMIT 1", [empresaId]);
  return r.rows[0] ? Number(r.rows[0].t) : 0.1;
}
