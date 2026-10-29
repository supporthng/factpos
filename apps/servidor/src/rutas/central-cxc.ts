import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { SQL_MOVIMIENTO } from "./caja-movimientos.js";

/**
 * Cuentas por cobrar (clientes a crédito / fiado) y movimientos de caja, vistos
 * desde la oficina. Lo que se registra aquí (abonos en la oficina, ajustes,
 * límites de crédito) baja a todas las sucursales por la sincronización.
 */
const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");

export async function rutasCentralCxc(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  const clienteDe = async (empresaId: string, clienteId: string) => {
    const r = await pool.query("SELECT id, nombre FROM clientes WHERE id = $1 AND empresa_id = $2", [clienteId, empresaId]);
    if (!r.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
    return r.rows[0] as { id: string; nombre: string };
  };

  /** Clientes con saldo y antigüedad de la deuda. */
  app.get("/central/cxc", async (req) => {
    const f = z.object({ q: z.string().trim().max(60).optional(), vencidos: z.enum(["1"]).optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT cliente_id AS "clienteId", nombre, documento, telefono, limite_credito AS "limiteCredito", dias_credito AS "diasCredito",
              saldo, al_dia AS "alDia", vencido_30 AS "vencido30", vencido_60 AS "vencido60", vencido_mas AS "vencidoMas",
              deuda_desde AS "deudaDesde", ultimo_abono AS "ultimoAbono",
              saldo > limite_credito AND limite_credito >= 0 AS "excedido"
         FROM rpt_cxc_antiguedad
        WHERE empresa_id = $1 AND saldo <> 0
          AND ($2::text IS NULL OR nombre ILIKE '%' || $2 || '%' OR documento LIKE $2 || '%')
          AND ($3::boolean IS NOT TRUE OR vencido_30 + vencido_60 + vencido_mas > 0)
        ORDER BY (vencido_30 + vencido_60 + vencido_mas) DESC, saldo DESC LIMIT 500`,
      [empresaDe(req), f.q || null, f.vencidos === "1"],
    );
    const t = r.rows.reduce((a, x) => ({
      saldo: a.saldo.plus(x.saldo), alDia: a.alDia.plus(x.alDia),
      vencido: a.vencido.plus(x.vencido30).plus(x.vencido60).plus(x.vencidoMas),
    }), { saldo: new Decimal(0), alDia: new Decimal(0), vencido: new Decimal(0) });
    return { clientes: r.rows, totales: { saldo: t.saldo.toFixed(2), alDia: t.alDia.toFixed(2), vencido: t.vencido.toFixed(2), clientes: r.rowCount } };
  });

  /** Buscar cualquier cliente (para darle crédito aunque todavía no deba nada). */
  app.get("/central/cxc/buscar", async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    const r = await pool.query(
      `SELECT id AS "clienteId", nombre, documento, telefono, limite_credito AS "limiteCredito", dias_credito AS "diasCredito"
         FROM clientes WHERE empresa_id = $1 AND activo AND (nombre ILIKE '%' || $2 || '%' OR documento LIKE $2 || '%')
        ORDER BY nombre LIMIT 20`,
      [empresaDe(req), q],
    );
    return r.rows;
  });

  /** Estado de cuenta: todos los movimientos con el saldo corrido. */
  app.get("/central/cxc/:clienteId", async (req) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const empresaId = empresaDe(req);
    const c = await pool.query(
      `SELECT c.id, c.nombre, c.documento, c.tipo_documento AS "tipoDocumento", c.telefono, c.direccion,
              c.limite_credito AS "limiteCredito", c.dias_credito AS "diasCredito",
              a.saldo, a.al_dia AS "alDia", a.vencido_30 AS "vencido30", a.vencido_60 AS "vencido60", a.vencido_mas AS "vencidoMas",
              e.nombre_comercial AS empresa, e.rnc AS "rncEmpresa"
         FROM clientes c JOIN empresas e ON e.id = c.empresa_id
         LEFT JOIN rpt_cxc_antiguedad a ON a.cliente_id = c.id
        WHERE c.id = $1 AND c.empresa_id = $2`,
      [clienteId, empresaId],
    );
    if (!c.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
    const m = await pool.query(
      `SELECT m.id, m.tipo, m.monto, m.creado_en AS fecha, m.forma_pago AS "formaPago", m.referencia, m.notas,
              v.numero_interno AS factura, d.encf, s.nombre AS sucursal, u.nombre AS usuario,
              SUM(m.monto) OVER (ORDER BY m.creado_en, m.id) AS saldo
         FROM cxc_movimientos m
         LEFT JOIN ventas v ON v.id = m.venta_id
         LEFT JOIN ecf_documentos d ON d.venta_id = m.venta_id
         JOIN sucursales s ON s.id = m.sucursal_id
         JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.cliente_id = $1
        ORDER BY m.creado_en, m.id`,
      [clienteId],
    );
    return { ...c.rows[0], saldo: c.rows[0].saldo ?? "0.00", movimientos: m.rows };
  });

  /** Abono recibido en la oficina (transferencia, cheque, efectivo en la oficina). */
  app.post("/central/cxc/:clienteId/abonos", async (req, rep) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const b = z.object({
      monto, formaPago: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CHEQUE"]),
      referencia: z.string().trim().max(40).optional(), notas: z.string().trim().max(200).optional(), sucursalId: uuid.optional(),
    }).parse(req.body);
    const empresaId = empresaDe(req);
    const valor = new Decimal(b.monto);
    if (valor.lte(0)) throw new ErrorNegocio("El monto debe ser mayor que cero");
    const id = uuidv7();
    const r = await enTransaccion(async (c) => {
      await c.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [clienteId, empresaId]);
      const saldo = new Decimal((await c.query("SELECT COALESCE(SUM(monto), 0) AS s FROM cxc_movimientos WHERE cliente_id = $1", [clienteId])).rows[0].s);
      if (valor.gt(saldo)) throw new ErrorNegocio(`El cliente debe ${saldo.toFixed(2)}: el abono no puede ser mayor`);
      const suc = b.sucursalId ?? (await c.query("SELECT id FROM sucursales WHERE empresa_id = $1 AND activo ORDER BY tipo = 'ALMACEN', codigo LIMIT 1", [empresaId])).rows[0]?.id;
      await c.query(
        `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, usuario_id, forma_pago, referencia, notas)
         VALUES ($1,$2,$3,'ABONO',$4,$5,$6,$7,$8)`,
        [id, suc, clienteId, valor.neg().toFixed(2), usuarioDe(req), b.formaPago, b.referencia ?? null, b.notas ?? "Abono en la oficina"],
      );
      return { id, saldoNuevo: saldo.minus(valor).toFixed(2) };
    });
    rep.code(201);
    return r;
  });

  /** Ajuste (perdonar una deuda, corregir un error): con motivo. Positivo suma, negativo resta. */
  app.post("/central/cxc/:clienteId/ajustes", async (req, rep) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const b = z.object({ monto: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Monto inválido"), motivo: z.string().trim().min(5, "Explique el motivo").max(200) }).parse(req.body);
    const empresaId = empresaDe(req);
    await clienteDe(empresaId, clienteId);
    const valor = new Decimal(b.monto);
    if (valor.isZero()) throw new ErrorNegocio("El ajuste no puede ser cero");
    const suc = (await pool.query("SELECT id FROM sucursales WHERE empresa_id = $1 AND activo ORDER BY tipo = 'ALMACEN', codigo LIMIT 1", [empresaId])).rows[0].id;
    const id = uuidv7();
    await pool.query(
      `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, usuario_id, notas, autorizado_por)
       VALUES ($1,$2,$3,'AJUSTE',$4,$5,$6,$5)`,
      [id, suc, clienteId, valor.toFixed(2), usuarioDe(req), b.motivo],
    );
    rep.code(201);
    return { id };
  });

  /** Límite y días de crédito: bajan a las cajas de todas las sucursales. */
  app.put("/central/cxc/:clienteId/credito", async (req) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const b = z.object({ limiteCredito: monto, diasCredito: z.number().int().min(0).max(365) }).parse(req.body);
    const r = await pool.query(
      "UPDATE clientes SET limite_credito = $3, dias_credito = $4 WHERE id = $1 AND empresa_id = $2 RETURNING id",
      [clienteId, empresaDe(req), b.limiteCredito, b.diasCredito],
    );
    if (!r.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
    return { ok: true };
  });

  // ------------------------------------------------------------- Movimientos de caja
  /** Retiros, gastos, sencillo y abonos de todas las cajas, con totales. */
  app.get("/central/caja/movimientos", async (req) => {
    const f = z.object({
      desde: fecha, hasta: fecha, sucursalId: uuid.optional(),
      tipo: z.enum(["RETIRO", "GASTO", "DEPOSITO", "ABONO_CLIENTE", "LIQUIDACION_DELIVERY"]).optional(),
    }).parse(req.query);
    const filtro = `WHERE s.empresa_id = $1 AND (m.creado_en AT TIME ZONE 'America/Santo_Domingo')::date BETWEEN $2 AND $3
                      AND ($4::uuid IS NULL OR m.sucursal_id = $4) AND ($5::text IS NULL OR m.tipo = $5)`;
    const params = [empresaDe(req), f.desde, f.hasta, f.sucursalId ?? null, f.tipo ?? null];
    const [filas, porTipo, porCategoria] = await Promise.all([
      pool.query(`${SQL_MOVIMIENTO} ${filtro} ORDER BY m.creado_en DESC LIMIT 1000`, params),
      pool.query(`SELECT m.tipo, COUNT(*)::int AS cantidad, SUM(m.monto) AS monto FROM movimientos_caja m JOIN sucursales s ON s.id = m.sucursal_id ${filtro} GROUP BY m.tipo`, params),
      pool.query(`SELECT COALESCE(m.categoria, 'Sin categoría') AS categoria, COUNT(*)::int AS cantidad, SUM(m.monto) AS monto,
                         SUM(m.monto) FILTER (WHERE m.comprobante IS NOT NULL) AS "conComprobante"
                    FROM movimientos_caja m JOIN sucursales s ON s.id = m.sucursal_id ${filtro} AND m.tipo = 'GASTO'
                   GROUP BY 1 ORDER BY 3 DESC`, params),
    ]);
    return { movimientos: filas.rows, porTipo: porTipo.rows, porCategoria: porCategoria.rows };
  });
}
