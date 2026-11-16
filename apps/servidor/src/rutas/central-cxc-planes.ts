import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { armarCuotas, estadoCuotas, type Frecuencia } from "./credito-plan.js";

/**
 * Crédito a plazos: planes predefinidos, plan de cuotas de un cliente (de una factura o de su deuda actual), interés fijo y mora.
 * El interés y la mora entran al estado de cuenta como ajustes positivos; los abonos del cliente se aplican a las cuotas por orden.
 * (El permiso lo da el prefijo /central/cxc: admin.cxc.)
 */
const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const FRECUENCIA = z.enum(["SEMANAL", "QUINCENAL", "MENSUAL"]);
const hoyRD = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);

export async function rutasCentralCxcPlanes(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);
  const clienteDe = async (empresaId: string, clienteId: string) => {
    const r = await pool.query("SELECT id, nombre FROM clientes WHERE id = $1 AND empresa_id = $2", [clienteId, empresaId]);
    if (!r.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
    return r.rows[0] as { id: string; nombre: string };
  };
  const config = async (c: Pick<PoolClient, "query">, empresaId: string) => {
    const r = await c.query<{ mora_pct: string; dias_gracia: number }>("SELECT mora_pct::text, dias_gracia FROM credito_config WHERE empresa_id = $1", [empresaId]);
    return { moraPct: r.rows[0]?.mora_pct ?? "0.00", diasGracia: r.rows[0]?.dias_gracia ?? 0 };
  };
  const sucursalDe = async (c: Pick<PoolClient, "query">, empresaId: string): Promise<string> =>
    (await c.query("SELECT id FROM sucursales WHERE empresa_id = $1 AND activo ORDER BY tipo = 'ALMACEN', codigo LIMIT 1", [empresaId])).rows[0].id;

  // ---------------------------------------------------------- Configuración y catálogo
  app.get("/central/cxc/config/credito", async (req) => config(pool, empresaDe(req)));
  app.put("/central/cxc/config/credito", async (req) => {
    const b = z.object({ moraPct: z.number().min(0).max(100), diasGracia: z.number().int().min(0).max(60) }).parse(req.body);
    await pool.query(
      `INSERT INTO credito_config (empresa_id, mora_pct, dias_gracia) VALUES ($1,$2,$3)
       ON CONFLICT (empresa_id) DO UPDATE SET mora_pct = EXCLUDED.mora_pct, dias_gracia = EXCLUDED.dias_gracia`, [empresaDe(req), b.moraPct, b.diasGracia]);
    return { ok: true };
  });

  app.get("/central/cxc/config/planes", async (req) => {
    const r = await pool.query(
      `SELECT id, nombre, cuotas, frecuencia, interes_pct::text AS "interesPct", activo FROM cxc_planes_catalogo WHERE empresa_id = $1 ORDER BY activo DESC, cuotas, nombre`, [empresaDe(req)]);
    return r.rows;
  });
  const PlanCatalogo = z.object({ nombre: z.string().trim().min(2).max(60), cuotas: z.number().int().min(1).max(60), frecuencia: FRECUENCIA, interesPct: z.number().min(0).max(300), activo: z.boolean().default(true) });
  app.post("/central/cxc/config/planes", async (req, rep) => {
    const b = PlanCatalogo.parse(req.body);
    const id = uuidv7();
    await pool.query("INSERT INTO cxc_planes_catalogo (id, empresa_id, nombre, cuotas, frecuencia, interes_pct, activo) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, empresaDe(req), b.nombre, b.cuotas, b.frecuencia, b.interesPct, b.activo]);
    rep.code(201);
    return { id };
  });
  app.put("/central/cxc/config/planes/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = PlanCatalogo.parse(req.body);
    const r = await pool.query("UPDATE cxc_planes_catalogo SET nombre=$3, cuotas=$4, frecuencia=$5, interes_pct=$6, activo=$7 WHERE id=$1 AND empresa_id=$2",
      [id, empresaDe(req), b.nombre, b.cuotas, b.frecuencia, b.interesPct, b.activo]);
    if (!r.rowCount) throw new ErrorNegocio("Plan no encontrado", 404);
    return { ok: true };
  });

  // ---------------------------------------------------------- Plan de un cliente
  /** Vista previa del calendario (sin guardar) */
  const Entrada = z.object({
    planId: uuid.optional(), cuotas: z.number().int().min(1).max(60).optional(), frecuencia: FRECUENCIA.optional(), interesPct: z.number().min(0).max(300).optional(),
    capital: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), ventaId: uuid.optional(), primeraCuota: fecha.optional(), notas: z.string().trim().max(200).optional(),
  });
  /** Resuelve plan del catálogo + ajustes + capital a financiar */
  const resolver = async (c: Pick<PoolClient, "query">, empresaId: string, clienteId: string, b: z.infer<typeof Entrada>) => {
    let nombre = "Plan a medida", cuotas = b.cuotas, frecuencia: Frecuencia | undefined = b.frecuencia, interesPct = b.interesPct;
    if (b.planId) {
      const p = (await c.query<{ nombre: string; cuotas: number; frecuencia: Frecuencia; interes_pct: string }>(
        "SELECT nombre, cuotas, frecuencia, interes_pct::text FROM cxc_planes_catalogo WHERE id = $1 AND empresa_id = $2 AND activo", [b.planId, empresaId])).rows[0];
      if (!p) throw new ErrorNegocio("Ese plan no existe o está inactivo", 404);
      nombre = p.nombre; cuotas ??= p.cuotas; frecuencia ??= p.frecuencia; interesPct ??= Number(p.interes_pct);
    }
    if (!cuotas || !frecuencia || interesPct === undefined) throw new ErrorNegocio("Elija un plan o indique cuotas, frecuencia e interés");
    const saldo = new Decimal((await c.query("SELECT COALESCE(SUM(monto), 0) AS s FROM cxc_movimientos WHERE cliente_id = $1", [clienteId])).rows[0].s);
    let maximo = saldo, sinSincronizar = false;
    if (b.ventaId) {
      const existe = (await c.query("SELECT 1 FROM ventas WHERE id = $1", [b.ventaId])).rowCount;
      if (existe) {
        const f = (await c.query<{ pendiente: string }>("SELECT pendiente FROM rpt_cxc_facturas WHERE cliente_id = $1 AND venta_id = $2", [clienteId, b.ventaId])).rows[0];
        if (!f || new Decimal(f.pendiente).lte(0)) throw new ErrorNegocio("Esa factura no tiene saldo pendiente a crédito");
        maximo = Decimal.min(saldo, new Decimal(f.pendiente));
      } else {
        // Factura recién hecha en una sucursal: todavía no llegó a la nube. Se confía en el monto a crédito de la factura (se pide explícito).
        if (!b.capital) throw new ErrorNegocio("Indique el monto a crédito de la factura");
        sinSincronizar = true; maximo = new Decimal(b.capital);
      }
    }
    const capital = b.capital ? new Decimal(b.capital) : maximo;
    if (capital.lte(0)) throw new ErrorNegocio("El cliente no tiene deuda que financiar");
    if (capital.gt(maximo)) throw new ErrorNegocio(`Solo se puede financiar hasta ${maximo.toFixed(2)}`);
    const hoy = hoyRD();
    if (b.primeraCuota && b.primeraCuota < hoy) throw new ErrorNegocio("La primera cuota no puede estar en el pasado");
    return { nombre, sinSincronizar, ...armarCuotas({ capital, interesPct, cuotas, frecuencia, desde: hoy, primera: b.primeraCuota }), interesPct, nCuotas: cuotas, frecuencia };
  };

  app.post("/central/cxc/:clienteId/planes/previsualizar", async (req) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const empresaId = empresaDe(req);
    await clienteDe(empresaId, clienteId);
    const r = await resolver(pool, empresaId, clienteId, Entrada.parse(req.body));
    return { nombre: r.nombre, capital: r.capital, interes: r.interes, total: r.total, cuotas: r.cuotas };
  });

  app.post("/central/cxc/:clienteId/planes", async (req, rep) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const b = Entrada.parse(req.body);
    const empresaId = empresaDe(req);
    await clienteDe(empresaId, clienteId);
    const id = uuidv7();
    await enTransaccion(async (c) => {
      await c.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [clienteId, empresaId]);
      await refrescarEstado(c, clienteId); // si el plan anterior ya está pagado se cierra antes de crear otro
      if ((await c.query("SELECT 1 FROM cxc_planes WHERE cliente_id = $1 AND estado = 'ACTIVO'", [clienteId])).rowCount) throw new ErrorNegocio("Este cliente ya tiene un plan de cuotas activo: termínelo o cancélelo primero");
      const r = await resolver(c, empresaId, clienteId, b);
      const cfg = await config(c, empresaId);
      await c.query(
        `INSERT INTO cxc_planes (id, empresa_id, cliente_id, venta_id, nombre, capital, interes_pct, interes, total, cuotas, frecuencia, mora_pct, dias_gracia, notas, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id, empresaId, clienteId, r.sinSincronizar ? null : (b.ventaId ?? null), r.nombre, r.capital, r.interesPct, r.interes, r.total, r.nCuotas, r.frecuencia, cfg.moraPct, cfg.diasGracia, [b.notas, r.sinSincronizar ? `Factura ${b.ventaId} (aún sincronizando)` : null].filter(Boolean).join(" · ") || null, usuarioDe(req)]);
      for (const q of r.cuotas) await c.query("INSERT INTO cxc_cuotas (id, plan_id, numero, vence, monto) VALUES ($1,$2,$3,$4,$5)", [uuidv7(), id, q.numero, q.vence, q.monto]);
      if (new Decimal(r.interes).gt(0)) {
        await c.query(
          `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, usuario_id, notas, autorizado_por)
           VALUES ($1,$2,$3,'AJUSTE',$4,$5,$6,$5)`,
          [uuidv7(), await sucursalDe(c, empresaId), clienteId, r.interes, usuarioDe(req), `Interés del plan «${r.nombre}» (${r.interesPct}% sobre ${r.capital})`]);
      }
    });
    rep.code(201);
    return { id };
  });

  /** Pagado desde que se creó el plan: abonos menos los abonos anulados */
  const pagadoDe = async (c: Pick<PoolClient, "query">, clienteId: string, desde: Date) =>
    new Decimal((await c.query(
      `SELECT COALESCE(-SUM(monto) FILTER (WHERE tipo = 'ABONO'), 0) + COALESCE(SUM(monto) FILTER (WHERE tipo = 'AJUSTE' AND notas LIKE 'Anulación del abono%'), 0) AS p
         FROM cxc_movimientos WHERE cliente_id = $1 AND creado_en >= $2`, [clienteId, desde])).rows[0].p);

  /** Cierra como PAGADO el plan activo cuando ya no queda nada pendiente en sus cuotas */
  const refrescarEstado = async (c: Pick<PoolClient, "query">, clienteId: string) => {
    const p = (await c.query<{ id: string; creado_en: Date }>("SELECT id, creado_en FROM cxc_planes WHERE cliente_id = $1 AND estado = 'ACTIVO'", [clienteId])).rows[0];
    if (!p) return;
    const q = (await c.query<{ numero: number; vence: string; monto: string; moraCobrada: string }>(
      `SELECT numero, to_char(vence,'YYYY-MM-DD') AS vence, monto::text, mora_cobrada::text AS "moraCobrada" FROM cxc_cuotas WHERE plan_id = $1 ORDER BY numero`, [p.id])).rows;
    const e = estadoCuotas(q, await pagadoDe(c, clienteId, p.creado_en), hoyRD(), 0, 0);
    if (e.every((x) => x.estado === "PAGADA")) await c.query("UPDATE cxc_planes SET estado = 'PAGADO', cerrado_en = now() WHERE id = $1", [p.id]);
  };

  /** Planes del cliente (el activo primero) con el estado de cada cuota y la mora acumulada */
  app.get("/central/cxc/:clienteId/planes", async (req) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const empresaId = empresaDe(req);
    await clienteDe(empresaId, clienteId);
    await refrescarEstado(pool, clienteId);
    const ps = await pool.query(
      `SELECT id, nombre, capital::text, interes_pct::text AS "interesPct", interes::text, total::text, cuotas, frecuencia, mora_pct::text AS "moraPct", dias_gracia AS "diasGracia",
              estado, notas, creado_en AS "creadoEn", venta_id AS "ventaId"
         FROM cxc_planes WHERE cliente_id = $1 ORDER BY (estado = 'ACTIVO') DESC, creado_en DESC LIMIT 10`, [clienteId]);
    const hoy = hoyRD();
    const out = [];
    for (const p of ps.rows) {
      const q = await pool.query(`SELECT numero, to_char(vence,'YYYY-MM-DD') AS vence, monto::text, mora_cobrada::text AS "moraCobrada" FROM cxc_cuotas WHERE plan_id = $1 ORDER BY numero`, [p.id]);
      const activo = p.estado === "ACTIVO";
      const pagado = activo ? await pagadoDe(pool, clienteId, p.creadoEn) : new Decimal(p.estado === "PAGADO" ? p.total : 0);
      const cuotas = estadoCuotas(q.rows, pagado, hoy, activo ? p.moraPct : 0, p.diasGracia);
      const sum = (k: "pendiente" | "moraPorCobrar") => cuotas.reduce((a, x) => a.plus(x[k]), new Decimal(0)).toFixed(2);
      out.push({ ...p, cuotas: q.rows.length, calendario: cuotas, pendiente: sum("pendiente"), moraPorCobrar: sum("moraPorCobrar"), vencidas: cuotas.filter((x) => x.estado === "VENCIDA").length });
    }
    return out;
  });

  /** Carga la mora acumulada al estado de cuenta (queda registrada por cuota para no cobrarla dos veces) */
  app.post("/central/cxc/:clienteId/planes/:id/mora", async (req, rep) => {
    const { clienteId, id } = z.object({ clienteId: uuid, id: uuid }).parse(req.params);
    const empresaId = empresaDe(req);
    await clienteDe(empresaId, clienteId);
    const r = await enTransaccion(async (c) => {
      await c.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [clienteId, empresaId]);
      const p = (await c.query<{ creado_en: Date; mora_pct: string; dias_gracia: number }>("SELECT creado_en, mora_pct::text, dias_gracia FROM cxc_planes WHERE id = $1 AND cliente_id = $2 AND estado = 'ACTIVO'", [id, clienteId])).rows[0];
      if (!p) throw new ErrorNegocio("El plan no existe o ya no está activo", 404);
      const q = (await c.query<{ numero: number; vence: string; monto: string; moraCobrada: string }>(
        `SELECT numero, to_char(vence,'YYYY-MM-DD') AS vence, monto::text, mora_cobrada::text AS "moraCobrada" FROM cxc_cuotas WHERE plan_id = $1 ORDER BY numero`, [id])).rows;
      const e = estadoCuotas(q, await pagadoDe(c, clienteId, p.creado_en), hoyRD(), p.mora_pct, p.dias_gracia);
      const total = e.reduce((a, x) => a.plus(x.moraPorCobrar), new Decimal(0));
      if (total.lte(0)) throw new ErrorNegocio("No hay mora por cobrar");
      for (const x of e.filter((y) => new Decimal(y.moraPorCobrar).gt(0))) {
        await c.query("UPDATE cxc_cuotas SET mora_cobrada = mora_cobrada + $3 WHERE plan_id = $1 AND numero = $2", [id, x.numero, x.moraPorCobrar]);
      }
      await c.query(
        `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, usuario_id, notas, autorizado_por)
         VALUES ($1,$2,$3,'AJUSTE',$4,$5,$6,$5)`,
        [uuidv7(), await sucursalDe(c, empresaId), clienteId, total.toFixed(2), usuarioDe(req), `Mora del plan (${e.filter((y) => new Decimal(y.moraPorCobrar).gt(0)).map((y) => `cuota ${y.numero}`).join(", ")})`]);
      return { mora: total.toFixed(2) };
    });
    rep.code(201);
    return r;
  });

  /** Cancela el plan (la deuda y lo cargado en el estado de cuenta se quedan; solo se quita el calendario) */
  app.post("/central/cxc/:clienteId/planes/:id/cancelar", async (req) => {
    const { clienteId, id } = z.object({ clienteId: uuid, id: uuid }).parse(req.params);
    const b = z.object({ motivo: z.string().trim().min(5, "Explique el motivo").max(160) }).parse(req.body);
    await clienteDe(empresaDe(req), clienteId);
    const r = await pool.query("UPDATE cxc_planes SET estado = 'CANCELADO', cerrado_en = now(), notas = COALESCE(notas || ' · ', '') || $3 WHERE id = $1 AND cliente_id = $2 AND estado = 'ACTIVO'", [id, clienteId, `Cancelado: ${b.motivo}`]);
    if (!r.rowCount) throw new ErrorNegocio("El plan no existe o ya no está activo", 404);
    return { ok: true };
  });
}
