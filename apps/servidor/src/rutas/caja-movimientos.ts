import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";
import { verificarAutorizacion } from "../autorizacion.js";
import { encolarFilas } from "../sync/outbox.js";
import { tienePermiso, type SesionCaja } from "../sesion.js";
import { reporteTurno } from "./cierre.js";
import { aplicarAbono } from "./cxc-aplicar.js";

/**
 * Entradas y salidas de dinero en la caja, fuera de las ventas:
 *  - RETIRO: se saca efectivo de la gaveta (para el banco, para la oficina).
 *  - GASTO: se paga algo con dinero de la gaveta (transporte, hielo, limpieza).
 *    Si trae factura con NCF, queda para el 606.
 *  - DEPOSITO: entra sencillo o cambio a la gaveta.
 *  - ABONO_CLIENTE: un cliente a crédito paga parte de su deuda.
 * Retiros y gastos llevan la aprobación de un supervisor (PIN) y salen
 * impresos con firma. Todo cuadra en el cierre del turno.
 */
const uuid = z.string().uuid();
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
export const CATEGORIAS_GASTO = ["Transporte", "Hielo y agua", "Limpieza", "Comida del personal", "Mantenimiento", "Mercancía", "Propinas y servicios", "Otros"] as const;

const sesionCaja = (req: FastifyRequest) => (req as FastifyRequest & { sesionCaja: SesionCaja }).sesionCaja;

async function turnoAbierto(c: { query: typeof pool.query }, cajaId: string, bloquear = false) {
  const t = await c.query<{ id: string }>(`SELECT id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO' ${bloquear ? "FOR UPDATE" : ""}`, [cajaId]);
  if (!t.rowCount) throw new ErrorNegocio("La caja no tiene un turno abierto", 409);
  return t.rows[0].id;
}

const SQL_MOVIMIENTO = `
  SELECT m.id, m.tipo, m.monto, m.forma_pago AS "formaPago", m.referencia, m.concepto, m.categoria, m.comprobante,
         m.beneficiario, m.creado_en AS "creadoEn", u.nombre AS usuario, a.nombre AS "autorizadoPor", cl.nombre AS cliente,
         ca.nombre AS caja, s.nombre AS sucursal
    FROM movimientos_caja m
    JOIN usuarios u ON u.id = m.usuario_id
    LEFT JOIN usuarios a ON a.id = m.autorizado_por
    LEFT JOIN clientes cl ON cl.id = m.cliente_id
    JOIN turnos t ON t.id = m.turno_id JOIN cajas ca ON ca.id = t.caja_id JOIN sucursales s ON s.id = m.sucursal_id`;

export async function rutasCajaMovimientos(app: FastifyInstance) {
  /**
   * Abrir la gaveta sin venta: con PIN del supervisor y queda en la auditoría.
   * La gaveta la abre la impresora (la caja imprime un ticket mínimo).
   */
  app.post("/cajas/:cajaId/gaveta", async (req, rep) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z.object({
      usuarioId: uuid,
      motivo: z.string().trim().min(3, "Escriba el motivo").max(200),
      autorizacion: z.string().max(2000),
    }).parse(req.body);
    const aprob = verificarAutorizacion(b.autorizacion, "caja.retiro", cajaId);
    const ctx = await contextoCaja(cajaId);
    const id = uuidv7();
    await enTransaccion(async (c) => {
      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
         VALUES ($1,$2,$3,$4,'caja.gaveta','caja',$5,$6)`,
        [id, ctx.sucursalId, b.usuarioId, aprob.supervisorId, cajaId, JSON.stringify({ motivo: b.motivo })],
      );
      await encolarFilas(c, "auditoria", [id]);
    });
    rep.code(201);
    return { ok: true, supervisor: aprob.supervisor };
  });

  app.get("/cajas/:cajaId/movimientos", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const turnoId = await turnoAbierto(pool, cajaId);
    const r = await pool.query(`${SQL_MOVIMIENTO} WHERE m.turno_id = $1 ORDER BY m.creado_en DESC`, [turnoId]);
    return { categorias: CATEGORIAS_GASTO, movimientos: r.rows };
  });

  app.post("/cajas/:cajaId/movimientos", async (req, rep) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z.object({
      usuarioId: uuid,
      tipo: z.enum(["RETIRO", "GASTO", "DEPOSITO"]),
      monto,
      concepto: z.string().trim().min(3, "Escriba el motivo").max(200),
      categoria: z.enum(CATEGORIAS_GASTO).optional(),
      comprobante: z.string().trim().toUpperCase().regex(/^(B\d{10}|E\d{12})$/, "NCF inválido (B0100000001 o E310000000001)").optional(),
      beneficiario: z.string().trim().max(80).optional(),
      autorizacion: z.string().max(2000).optional(),
    }).parse(req.body);
    if (new Decimal(b.monto).lte(0)) throw new ErrorNegocio("El monto debe ser mayor que cero");
    if (b.tipo === "GASTO" && !b.categoria) throw new ErrorNegocio("Elija la categoría del gasto");

    // Sacar dinero necesita la aprobación de un supervisor; meter sencillo no
    const aprob = b.tipo === "DEPOSITO" ? null : verificarAutorizacion(b.autorizacion, b.tipo === "RETIRO" ? "caja.retiro" : "caja.gasto", cajaId);
    const ctx = await contextoCaja(cajaId);
    const id = uuidv7();
    await enTransaccion(async (c) => {
      const turnoId = await turnoAbierto(c, cajaId, true);
      if (b.tipo !== "DEPOSITO") {
        const r = await reporteTurno(c, turnoId);
        if (new Decimal(b.monto).gt(r.efectivo.esperado)) {
          throw new ErrorNegocio(`En la gaveta debe haber ${r.efectivo.esperado}: no se puede sacar más que eso`);
        }
      }
      await c.query(
        `INSERT INTO movimientos_caja (id, sucursal_id, turno_id, tipo, monto, concepto, usuario_id, autorizado_por,
                                       categoria, comprobante, beneficiario)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, ctx.sucursalId, turnoId, b.tipo, new Decimal(b.monto).toFixed(2), b.concepto, b.usuarioId, aprob?.supervisorId ?? null,
         b.tipo === "GASTO" ? b.categoria : null, b.comprobante ?? null, b.beneficiario ?? null],
      );
      await encolarFilas(c, "movimientos_caja", [id]);
    });
    rep.code(201);
    return (await pool.query(`${SQL_MOVIMIENTO} WHERE m.id = $1`, [id])).rows[0];
  });

  // ------------------------------------------------------------- Cuentas por cobrar en la caja
  /** Estado de cuenta corto de un cliente (lo que se muestra antes de cobrar). */
  app.get("/cajas/:cajaId/clientes/:clienteId/cuenta", async (req) => {
    const { cajaId, clienteId } = z.object({ cajaId: uuid, clienteId: uuid }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const c = await pool.query(
      `SELECT a.cliente_id AS id, a.nombre, a.limite_credito AS "limiteCredito", a.dias_credito AS "diasCredito", a.saldo,
              a.al_dia AS "alDia", (a.vencido_30 + a.vencido_60 + a.vencido_mas) AS vencido, a.deuda_desde AS "deudaDesde"
         FROM rpt_cxc_antiguedad a WHERE a.cliente_id = $1 AND a.empresa_id = $2`,
      [clienteId, ctx.empresaId],
    );
    if (!c.rowCount) return { id: clienteId, saldo: "0", movimientos: [] };
    const m = await pool.query(
      `SELECT m.tipo, m.monto, m.creado_en AS fecha, v.numero_interno AS factura, s.nombre AS sucursal, m.forma_pago AS "formaPago"
         FROM cxc_movimientos m LEFT JOIN ventas v ON v.id = m.venta_id JOIN sucursales s ON s.id = m.sucursal_id
        WHERE m.cliente_id = $1 ORDER BY m.creado_en DESC LIMIT 10`,
      [clienteId],
    );
    const f = await pool.query(
      `SELECT f.venta_id AS "ventaId", v.numero_interno AS factura, COALESCE(d.encf, v.numero_documento) AS documento, s.nombre AS sucursal,
              f.creado_en AS fecha, (f.creado_en + make_interval(days => a.dias_credito)) AS vence, f.cargo, f.cargo - f.pendiente AS pagado, f.pendiente
         FROM rpt_cxc_facturas f
         JOIN rpt_cxc_antiguedad a ON a.cliente_id = f.cliente_id
         JOIN ventas v ON v.id = f.venta_id JOIN sucursales s ON s.id = f.sucursal_id
         LEFT JOIN ecf_documentos d ON d.venta_id = f.venta_id
        WHERE f.cliente_id = $1 AND f.pendiente > 0 ORDER BY f.creado_en, f.venta_id`, [clienteId]);
    return { ...c.rows[0], movimientos: m.rows, facturas: f.rows };
  });

  /** Busca clientes con facturas a crédito pendientes: por nombre, documento o número de factura / comprobante. */
  app.get("/cajas/:cajaId/cxc/buscar", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const { q } = z.object({ q: z.string().trim().min(1).max(40) }).parse(req.query);
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query(
      `SELECT cl.id AS "clienteId", cl.nombre, cl.documento,
              (SELECT COALESCE(SUM(x.monto), 0) FROM cxc_movimientos x WHERE x.cliente_id = cl.id) AS saldo,
              jsonb_agg(jsonb_build_object('ventaId', f.venta_id, 'factura', v.numero_interno, 'documento', COALESCE(d.encf, v.numero_documento),
                        'fecha', f.creado_en, 'pendiente', f.pendiente,
                        'coincide', (v.numero_interno::text = $2 OR COALESCE(d.encf, v.numero_documento, '') ILIKE '%' || $2))
                        ORDER BY f.creado_en) AS facturas
         FROM clientes cl
         JOIN rpt_cxc_facturas f ON f.cliente_id = cl.id AND f.pendiente > 0
         JOIN ventas v ON v.id = f.venta_id
         LEFT JOIN ecf_documentos d ON d.venta_id = f.venta_id
        WHERE cl.empresa_id = $1
          AND (cl.nombre ILIKE '%' || $2 || '%' OR cl.documento LIKE $2 || '%'
               OR v.numero_interno::text = $2 OR COALESCE(d.encf, v.numero_documento, '') ILIKE '%' || $2)
        GROUP BY cl.id ORDER BY cl.nombre LIMIT 15`,
      [ctx.empresaId, q],
    );
    return r.rows;
  });

  /** Abono de un cliente a crédito. Entra al cuadre del turno según cómo pagó. */
  app.post("/cajas/:cajaId/clientes/:clienteId/abonos", async (req, rep) => {
    const { cajaId, clienteId } = z.object({ cajaId: uuid, clienteId: uuid }).parse(req.params);
    const b = z.object({
      usuarioId: uuid,
      monto,
      formaPago: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]),
      referencia: z.string().trim().max(40).optional(),
      recibido: monto.optional(),
      modo: z.enum(["CUENTA", "FACTURA"]).default("CUENTA"), ventaId: uuid.optional(),
    }).parse(req.body);
    const s = sesionCaja(req);
    if (!tienePermiso(s.p, "cxc.abono")) throw new ErrorNegocio("Su usuario no puede cobrar abonos", 403);
    if (b.formaPago === "TARJETA" && !/^[A-Za-z0-9-]{4,}$/.test(b.referencia ?? "")) throw new ErrorNegocio("Escriba el número de aprobación de la tarjeta");
    const valor = new Decimal(b.monto);
    if (valor.lte(0)) throw new ErrorNegocio("El monto debe ser mayor que cero");
    if (b.formaPago === "EFECTIVO" && b.recibido && new Decimal(b.recibido).lt(valor)) throw new ErrorNegocio("Lo recibido es menos que el abono");
    const ctx = await contextoCaja(cajaId);
    const movId = uuidv7();

    const res = await enTransaccion(async (c) => {
      const turnoId = await turnoAbierto(c, cajaId);
      const cl = await c.query<{ nombre: string; saldo: string; documento: string | null }>(
        `SELECT c.nombre, c.documento, COALESCE((SELECT SUM(m.monto) FROM cxc_movimientos m WHERE m.cliente_id = c.id), 0) AS saldo
           FROM clientes c WHERE c.id = $1 AND c.empresa_id = $2 FOR UPDATE OF c`,
        [clienteId, ctx.empresaId],
      );
      if (!cl.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
      const saldo = new Decimal(cl.rows[0].saldo);
      if (saldo.lte(0)) throw new ErrorNegocio(`${cl.rows[0].nombre} no tiene deuda`);
      if (valor.gt(saldo)) throw new ErrorNegocio(`El cliente debe ${saldo.toFixed(2)}: el abono no puede ser mayor`);
      const partes = await aplicarAbono(c, {
        clienteId, sucursalId: ctx.sucursalId, usuarioId: b.usuarioId, turnoId, monto: valor, formaPago: b.formaPago, referencia: b.referencia ?? null,
        modo: b.modo, ventaId: b.ventaId ?? null,
      });
      const ids = partes.filter((x) => x.ventaId).map((x) => x.ventaId);
      const det = ids.length ? (await c.query<{ id: string; factura: number; documento: string | null; pendiente: string }>(
        `SELECT v.id, v.numero_interno AS factura, COALESCE(d.encf, v.numero_documento) AS documento, COALESCE(f.pendiente, 0) AS pendiente
           FROM ventas v LEFT JOIN ecf_documentos d ON d.venta_id = v.id LEFT JOIN rpt_cxc_facturas f ON f.venta_id = v.id
          WHERE v.id = ANY($1::uuid[])`, [ids])).rows : [];
      const aplicaciones = partes.map((x) => {
        const f = det.find((y) => y.id === x.ventaId);
        return { ventaId: x.ventaId, factura: f?.factura ?? null, documento: f?.documento ?? null, aplicado: x.monto, pendiente: f ? new Decimal(f.pendiente).toFixed(2) : null };
      });
      await c.query(
        `INSERT INTO movimientos_caja (id, sucursal_id, turno_id, tipo, monto, concepto, usuario_id, forma_pago, referencia, cliente_id)
         VALUES ($1,$2,$3,'ABONO_CLIENTE',$4,$5,$6,$7,$8,$9)`,
        [movId, ctx.sucursalId, turnoId, valor.toFixed(2), `Abono de ${cl.rows[0].nombre}`, b.usuarioId, b.formaPago, b.referencia ?? null, clienteId],
      );
      await encolarFilas(c, "cxc_movimientos", partes.map((x) => x.id));
      await encolarFilas(c, "movimientos_caja", [movId]);
      return {
        aplicaciones,
        recibo: movId.slice(-8).toUpperCase(),
        cliente: { id: clienteId, nombre: cl.rows[0].nombre, documento: cl.rows[0].documento },
        saldoAnterior: saldo.toFixed(2),
        abono: valor.toFixed(2),
        saldoNuevo: saldo.minus(valor).toFixed(2),
        formaPago: b.formaPago,
        referencia: b.referencia ?? null,
        cambio: b.formaPago === "EFECTIVO" && b.recibido ? new Decimal(b.recibido).minus(valor).toFixed(2) : "0.00",
        cajero: s.n,
        fecha: new Date().toISOString(),
      };
    });
    rep.code(201);
    return res;
  });
}

export { SQL_MOVIMIENTO };
