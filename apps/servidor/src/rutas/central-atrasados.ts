import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { pool } from "../db.js";
import { estadoCuotas } from "./credito-plan.js";

/**
 * Clientes atrasados por antigüedad: 1 a 30, 31 a 60, 61 a 90 y más de 90 días de atraso.
 *  - Cliente con plan de cuotas: el atraso se cuenta por cada cuota vencida (días desde su fecha de vencimiento).
 *  - Cliente con crédito corriente (sin plan): cada deuda cuenta desde su fecha más los días de crédito del cliente; los abonos pagan primero lo más viejo.
 * (El permiso lo da el prefijo /central/cxc: admin.cxc.)
 */
const uuid = z.string().uuid();
const hoyRD = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);

interface Fila {
  clienteId: string; cliente: string; documento: string | null; telefono: string | null; tipo: "PLAN" | "CREDITO";
  saldo: string; alDia: string; d30: string; d60: string; d90: string; dMas: string; vencido: string; diasMax: number; ultimoAbono: string | null;
}

export async function rutasCentralAtrasados(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  app.get("/central/cxc/atrasados", async (req) => {
    const empresaId = empresaDe(req);
    const q = z.object({ desde: z.enum(["1", "31", "61", "91"]).default("1") }).parse(req.query);
    const minimo = Number(q.desde);
    const hoy = hoyRD();
    const filas: Fila[] = [];

    // 1) Crédito corriente (clientes sin plan de cuotas activo)
    const corriente = await pool.query(
      `WITH cargos AS (
         SELECT m.cliente_id, m.creado_en, m.monto, SUM(m.monto) OVER (PARTITION BY m.cliente_id ORDER BY m.creado_en, m.id) AS acumulado
           FROM cxc_movimientos m WHERE m.monto > 0
       ), pagado AS (
         SELECT cliente_id, -COALESCE(SUM(monto), 0) AS total FROM cxc_movimientos WHERE monto < 0 GROUP BY cliente_id
       ), pendiente AS (
         SELECT c.cliente_id, c.creado_en, GREATEST(0, LEAST(c.monto, c.acumulado - COALESCE(p.total, 0))) AS debe
           FROM cargos c LEFT JOIN pagado p ON p.cliente_id = c.cliente_id
       ), edad AS (
         SELECT p.cliente_id, p.debe,
                (((now() AT TIME ZONE 'America/Santo_Domingo')::date - (p.creado_en AT TIME ZONE 'America/Santo_Domingo')::date) - cl.dias_credito) AS atraso
           FROM pendiente p JOIN clientes cl ON cl.id = p.cliente_id WHERE p.debe > 0
       )
       SELECT cl.id AS "clienteId", cl.nombre, cl.documento, cl.telefono,
              (SELECT COALESCE(SUM(x.monto), 0) FROM cxc_movimientos x WHERE x.cliente_id = cl.id)::text AS saldo,
              COALESCE(SUM(e.debe) FILTER (WHERE e.atraso <= 0), 0)::text AS al_dia,
              COALESCE(SUM(e.debe) FILTER (WHERE e.atraso BETWEEN 1 AND 30), 0)::text AS d30,
              COALESCE(SUM(e.debe) FILTER (WHERE e.atraso BETWEEN 31 AND 60), 0)::text AS d60,
              COALESCE(SUM(e.debe) FILTER (WHERE e.atraso BETWEEN 61 AND 90), 0)::text AS d90,
              COALESCE(SUM(e.debe) FILTER (WHERE e.atraso > 90), 0)::text AS dmas,
              COALESCE(MAX(e.atraso) FILTER (WHERE e.atraso > 0), 0)::int AS dias_max,
              (SELECT MAX(x.creado_en) FROM cxc_movimientos x WHERE x.cliente_id = cl.id AND x.tipo = 'ABONO') AS ultimo_abono
         FROM clientes cl JOIN edad e ON e.cliente_id = cl.id
        WHERE cl.empresa_id = $1 AND NOT EXISTS (SELECT 1 FROM cxc_planes p WHERE p.cliente_id = cl.id AND p.estado = 'ACTIVO')
        GROUP BY cl.id`, [empresaId]);
    for (const r of corriente.rows) {
      const vencido = new Decimal(r.d30).plus(r.d60).plus(r.d90).plus(r.dmas);
      filas.push({ clienteId: r.clienteId, cliente: r.nombre, documento: r.documento, telefono: r.telefono, tipo: "CREDITO", saldo: r.saldo, alDia: r.al_dia, d30: r.d30, d60: r.d60, d90: r.d90, dMas: r.dmas,
        vencido: vencido.toFixed(2), diasMax: r.dias_max, ultimoAbono: r.ultimo_abono });
    }

    // 2) Clientes con plan de cuotas: por cuota vencida
    const ps = await pool.query(
      `SELECT p.id, p.cliente_id, p.creado_en, p.mora_pct::text, p.dias_gracia, cl.nombre, cl.documento, cl.telefono,
              COALESCE((SELECT SUM(m.monto) FROM cxc_movimientos m WHERE m.cliente_id = p.cliente_id), 0)::text AS saldo,
              (SELECT MAX(x.creado_en) FROM cxc_movimientos x WHERE x.cliente_id = p.cliente_id AND x.tipo = 'ABONO') AS ultimo_abono
         FROM cxc_planes p JOIN clientes cl ON cl.id = p.cliente_id WHERE p.empresa_id = $1 AND p.estado = 'ACTIVO'`, [empresaId]);
    for (const p of ps.rows) {
      const cu = await pool.query(`SELECT numero, to_char(vence,'YYYY-MM-DD') AS vence, monto::text, mora_cobrada::text AS "moraCobrada" FROM cxc_cuotas WHERE plan_id = $1 ORDER BY numero`, [p.id]);
      const pagado = new Decimal((await pool.query(
        `SELECT COALESCE(-SUM(monto) FILTER (WHERE tipo = 'ABONO'), 0) + COALESCE(SUM(monto) FILTER (WHERE tipo = 'AJUSTE' AND notas LIKE 'Anulación del abono%'), 0) AS p
           FROM cxc_movimientos WHERE cliente_id = $1 AND creado_en >= $2`, [p.cliente_id, p.creado_en])).rows[0].p);
      const e = estadoCuotas(cu.rows, pagado, hoy, p.mora_pct, p.dias_gracia).filter((x) => x.estado === "VENCIDA");
      const sum = (a: number, b: number) => e.filter((x) => x.diasAtraso >= a && x.diasAtraso <= b).reduce((s, x) => s.plus(x.pendiente), new Decimal(0));
      const d30 = sum(1, 30), d60 = sum(31, 60), d90 = sum(61, 90), dMas = sum(91, 100000);
      const vencido = d30.plus(d60).plus(d90).plus(dMas);
      const saldo = new Decimal(p.saldo);
      filas.push({ clienteId: p.cliente_id, cliente: p.nombre, documento: p.documento, telefono: p.telefono, tipo: "PLAN", saldo: saldo.toFixed(2), alDia: Decimal.max(0, saldo.minus(vencido)).toFixed(2),
        d30: d30.toFixed(2), d60: d60.toFixed(2), d90: d90.toFixed(2), dMas: dMas.toFixed(2), vencido: vencido.toFixed(2), diasMax: e.length ? Math.max(...e.map((x) => x.diasAtraso)) : 0, ultimoAbono: p.ultimo_abono });
    }

    const out = filas.filter((f) => f.diasMax >= minimo && new Decimal(f.vencido).gt(0)).sort((a, b) => b.diasMax - a.diasMax || Number(b.vencido) - Number(a.vencido));
    const tot = (k: "alDia" | "d30" | "d60" | "d90" | "dMas" | "vencido" | "saldo") => out.reduce((s, f) => s.plus(f[k]), new Decimal(0)).toFixed(2);
    return { filas: out, totales: { clientes: out.length, saldo: tot("saldo"), vencido: tot("vencido"), d30: tot("d30"), d60: tot("d60"), d90: tot("d90"), dMas: tot("dMas") } };
  });
}
