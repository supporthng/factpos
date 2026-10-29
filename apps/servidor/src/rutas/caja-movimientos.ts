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
    return { ...c.rows[0], movimientos: m.rows };
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
    }).parse(req.body);
    const s = sesionCaja(req);
    if (!tienePermiso(s.p, "cxc.abono")) throw new ErrorNegocio("Su usuario no puede cobrar abonos", 403);
    if (b.formaPago === "TARJETA" && !/^[A-Za-z0-9-]{4,}$/.test(b.referencia ?? "")) throw new ErrorNegocio("Escriba el número de aprobación de la tarjeta");
    const valor = new Decimal(b.monto);
    if (valor.lte(0)) throw new ErrorNegocio("El monto debe ser mayor que cero");
    if (b.formaPago === "EFECTIVO" && b.recibido && new Decimal(b.recibido).lt(valor)) throw new ErrorNegocio("Lo recibido es menos que el abono");
    const ctx = await contextoCaja(cajaId);
    const cxcId = uuidv7(), movId = uuidv7();

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
      await c.query(
        `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, turno_id, usuario_id, forma_pago, referencia)
         VALUES ($1,$2,$3,'ABONO',$4,$5,$6,$7,$8)`,
        [cxcId, ctx.sucursalId, clienteId, valor.neg().toFixed(2), turnoId, b.usuarioId, b.formaPago, b.referencia ?? null],
      );
      await c.query(
        `INSERT INTO movimientos_caja (id, sucursal_id, turno_id, tipo, monto, concepto, usuario_id, forma_pago, referencia, cliente_id)
         VALUES ($1,$2,$3,'ABONO_CLIENTE',$4,$5,$6,$7,$8,$9)`,
        [movId, ctx.sucursalId, turnoId, valor.toFixed(2), `Abono de ${cl.rows[0].nombre}`, b.usuarioId, b.formaPago, b.referencia ?? null, clienteId],
      );
      await encolarFilas(c, "cxc_movimientos", [cxcId]);
      await encolarFilas(c, "movimientos_caja", [movId]);
      return {
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
