import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { encolarFilas } from "../sync/outbox.js";
import { contextoCaja } from "../contexto.js";
import { registrarVenta } from "./ventas.js";

const uuid = z.string().uuid();
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
const cantidad = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida");

export interface ConfigDelivery {
  activo: boolean;
  cargoEnvio?: string;
  productoEnvioId?: string; // presentación de servicio "Cargo de envío" (sin inventario)
  tiempoEstimadoMin?: number;
}

export async function configDelivery(c: Pick<PoolClient, "query">, sucursalId: string): Promise<ConfigDelivery> {
  const r = await c.query("SELECT modulos -> 'delivery' AS d FROM configuracion_sucursal WHERE sucursal_id = $1", [sucursalId]);
  return { activo: false, ...(r.rows[0]?.d ?? {}) };
}

async function exigirDelivery(c: Pick<PoolClient, "query">, sucursalId: string) {
  const cfg = await configDelivery(c, sucursalId);
  if (!cfg.activo) throw new ErrorNegocio("El módulo de delivery está desactivado en esta sucursal", 403);
  return cfg;
}

/**
 * Delivery (se activa o desactiva por sucursal desde la Administración).
 *
 *   RECIBIDO ─despachar→ DESPACHADO ─entregar→ ENTREGADO ─liquidar→ LIQUIDADO
 *       └─cancelar→ CANCELADO (solo antes de despachar)
 *
 * Al despachar se registra la venta con forma de pago "DELIVERY" (el dinero
 * está en manos del repartidor) y sale el inventario. Al liquidar, el
 * efectivo entra a la caja como movimiento LIQUIDACION_DELIVERY, así el
 * cuadre del turno siempre cuadra.
 */
export async function rutasDelivery(app: FastifyInstance) {
  app.post("/cajas/:cajaId/delivery/pedidos", async (req, rep) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z
      .object({
        usuarioId: uuid,
        canal: z.enum(["TELEFONO", "WHATSAPP", "WEB", "OTRO"]).default("TELEFONO"),
        clienteId: uuid.optional(),
        nombreCliente: z.string().trim().min(2).max(80),
        telefono: z.string().trim().min(7).max(20),
        direccion: z.string().trim().min(5).max(300),
        referencia: z.string().max(300).optional(),
        items: z.array(z.object({ presentacionId: uuid, cantidad, precioVariable: z.string().regex(/^\d+(\.\d{1,2})?$/).optional() })).min(1).max(200),
        cuponCodigo: z.string().max(30).optional(),
        formaPagoEsperada: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]).default("EFECTIVO"),
        pagaCon: monto.optional(),
        nota: z.string().max(300).optional(),
      })
      .parse(req.body);

    const r = await enTransaccion(async (c) => {
      const ctx = await contextoCaja(cajaId, c);
      const cfg = await exigirDelivery(c, ctx.sucursalId);
      await c.query("SELECT 1 FROM sucursales WHERE id = $1 FOR UPDATE", [ctx.sucursalId]);
      const id = uuidv7();
      const ins = await c.query(
        `INSERT INTO pedidos_delivery (id, sucursal_id, caja_id, numero, canal, cliente_id, nombre_cliente, telefono,
                                       direccion, referencia, items, cupon_codigo, cargo_envio, paga_con,
                                       forma_pago_esperada, nota, recibido_por)
         VALUES ($1,$2,$3,(SELECT COALESCE(MAX(numero),0)+1 FROM pedidos_delivery WHERE sucursal_id = $2),
                 $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING numero, estado, cargo_envio AS "cargoEnvio"`,
        [id, ctx.sucursalId, cajaId, b.canal, b.clienteId ?? null, b.nombreCliente, b.telefono, b.direccion,
         b.referencia ?? null, JSON.stringify(b.items), b.cuponCodigo ?? null, cfg.cargoEnvio ?? "0",
         b.pagaCon ?? null, b.formaPagoEsperada, b.nota ?? null, b.usuarioId],
      );
      await encolarFilas(c, "pedidos_delivery", [id]);
      return { id, ...ins.rows[0], tiempoEstimadoMin: cfg.tiempoEstimadoMin ?? null };
    });
    rep.code(201);
    return r;
  });

  /** Tablero de pedidos de la sucursal. */
  app.get("/cajas/:cajaId/delivery/pedidos", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const { estado } = z.object({ estado: z.string().optional() }).parse(req.query);
    const ctx = await contextoCaja(cajaId);
    await exigirDelivery(pool, ctx.sucursalId);
    const r = await pool.query(
      `SELECT p.id, p.numero, p.canal, p.nombre_cliente AS "nombreCliente", p.telefono, p.direccion, p.referencia,
              p.estado, p.total, p.cargo_envio AS "cargoEnvio", p.paga_con AS "pagaCon",
              p.forma_pago_esperada AS "formaPagoEsperada", r.nombre AS repartidor,
              p.recibido_en AS "recibidoEn", p.despachado_en AS "despachadoEn",
              ROUND(EXTRACT(EPOCH FROM (now() - p.recibido_en)) / 60) AS "minutos"
         FROM pedidos_delivery p LEFT JOIN repartidores r ON r.id = p.repartidor_id
        WHERE p.sucursal_id = $1
          AND ($2::text IS NULL AND p.estado IN ('RECIBIDO','DESPACHADO','ENTREGADO') OR p.estado = $2)
        ORDER BY p.recibido_en`,
      [ctx.sucursalId, estado ?? null],
    );
    return r.rows;
  });

  app.get("/cajas/:cajaId/delivery/repartidores", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query(
      `SELECT r.id, r.nombre, r.telefono, r.vehiculo,
              COALESCE(p.pedidos, 0) AS "pedidosEnCalle", COALESCE(p.monto_pendiente, 0) AS "montoPendiente"
         FROM repartidores r LEFT JOIN rpt_delivery_pendiente p ON p.repartidor_id = r.id
        WHERE r.sucursal_id = $1 AND r.activo ORDER BY r.nombre`,
      [ctx.sucursalId],
    );
    return r.rows;
  });

  /** Despachar: se registra la venta (pago DELIVERY) y sale el inventario. */
  app.post("/delivery/pedidos/:id/despachar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ usuarioId: uuid, repartidorId: uuid, tipoDocumento: z.enum(["E32", "E31"]).default("E32") }).parse(req.body);

    return enTransaccion(async (c) => {
      const p = (await c.query("SELECT * FROM pedidos_delivery WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!p) throw new ErrorNegocio("Pedido no encontrado", 404);
      if (p.estado !== "RECIBIDO") throw new ErrorNegocio(`El pedido ya está ${p.estado.toLowerCase()}`, 409);
      const cfg = await exigirDelivery(c, p.sucursal_id);
      const rep = await c.query("SELECT 1 FROM repartidores WHERE id = $1 AND sucursal_id = $2 AND activo", [b.repartidorId, p.sucursal_id]);
      if (!rep.rowCount) throw new ErrorNegocio("Repartidor no válido para esta sucursal");

      const items = [...p.items];
      if (new Decimal(p.cargo_envio).gt(0)) {
        if (!cfg.productoEnvioId) throw new ErrorNegocio("Configure el producto 'Cargo de envío' en el módulo de delivery");
        items.push({ presentacionId: cfg.productoEnvioId, cantidad: "1" });
      }

      // Todo el importe queda como pago "DELIVERY" hasta la liquidación
      const venta = await registrarVenta(
        c,
        p.caja_id,
        {
          usuarioId: b.usuarioId,
          clienteId: p.cliente_id ?? undefined,
          cuponCodigo: p.cupon_codigo ?? undefined,
          tipoDocumento: b.tipoDocumento,
          items,
          pagos: [],
        },
        { pagarTodoCon: "DELIVERY" },
      );

      await c.query(
        `UPDATE pedidos_delivery SET estado = 'DESPACHADO', repartidor_id = $2, venta_id = $3, total = $4, despachado_en = now()
          WHERE id = $1`,
        [id, b.repartidorId, venta.id, venta.total],
      );
      await encolarFilas(c, "pedidos_delivery", [id]);
      const cambio = p.paga_con ? new Decimal(p.paga_con).minus(venta.total) : null;
      return {
        pedido: p.numero,
        venta: { id: venta.id, numero: venta.numero, total: venta.total },
        llevarCambio: cambio && cambio.gt(0) ? cambio.toFixed(2) : "0.00",
      };
    });
  });

  app.post("/delivery/pedidos/:id/entregar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return enTransaccion(async (c) => {
      const r = await c.query(
        "UPDATE pedidos_delivery SET estado = 'ENTREGADO', entregado_en = now() WHERE id = $1 AND estado = 'DESPACHADO' RETURNING numero, estado",
        [id],
      );
      if (!r.rowCount) throw new ErrorNegocio("Solo se puede marcar como entregado un pedido despachado", 409);
      await encolarFilas(c, "pedidos_delivery", [id]);
      return r.rows[0];
    });
  });

  app.post("/delivery/pedidos/:id/cancelar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { motivo } = z.object({ motivo: z.string().trim().min(3).max(200) }).parse(req.body);
    return enTransaccion(async (c) => {
      const r = await c.query(
        `UPDATE pedidos_delivery SET estado = 'CANCELADO', cancelado_en = now(), motivo_cancelacion = $2
          WHERE id = $1 AND estado = 'RECIBIDO' RETURNING numero, estado`,
        [id, motivo],
      );
      if (!r.rowCount) {
        throw new ErrorNegocio("Solo se cancela antes de despachar. Si ya salió, registre la devolución con nota de crédito", 409);
      }
      await encolarFilas(c, "pedidos_delivery", [id]);
      return r.rows[0];
    });
  });

  /**
   * Liquidación: el repartidor entrega en la caja el dinero de sus pedidos.
   * El efectivo entra al turno abierto de esa caja; si entrega menos de lo
   * esperado, la diferencia queda registrada.
   */
  app.post("/cajas/:cajaId/delivery/liquidar", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z.object({ usuarioId: uuid, repartidorId: uuid, pedidos: z.array(uuid).min(1), montoEntregado: monto }).parse(req.body);

    return enTransaccion(async (c) => {
      const ctx = await contextoCaja(cajaId, c);
      await exigirDelivery(c, ctx.sucursalId);
      const turno = await c.query<{ id: string }>("SELECT id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId]);
      if (!turno.rowCount) throw new ErrorNegocio("La caja no tiene un turno abierto", 409);

      const ps = await c.query(
        `SELECT id, numero, total FROM pedidos_delivery
          WHERE id = ANY($1::uuid[]) AND repartidor_id = $2 AND sucursal_id = $3 AND estado IN ('DESPACHADO','ENTREGADO')
          FOR UPDATE`,
        [b.pedidos, b.repartidorId, ctx.sucursalId],
      );
      if (ps.rowCount !== b.pedidos.length) throw new ErrorNegocio("Algún pedido no pertenece al repartidor o ya fue liquidado");

      const esperado = ps.rows.reduce((a, p) => a.plus(p.total), new Decimal(0));
      const diferencia = new Decimal(b.montoEntregado).minus(esperado);

      const movId = uuidv7();
      await c.query(
        `INSERT INTO movimientos_caja (id, sucursal_id, turno_id, tipo, monto, concepto, usuario_id, repartidor_id)
         VALUES ($1,$2,$3,'LIQUIDACION_DELIVERY',$4,$5,$6,$7)`,
        [movId, ctx.sucursalId, turno.rows[0].id, b.montoEntregado,
         `Liquidación pedidos ${ps.rows.map((p) => "#" + p.numero).join(", ")}` +
           (diferencia.isZero() ? "" : ` (diferencia ${diferencia.toFixed(2)})`),
         b.usuarioId, b.repartidorId],
      );
      await c.query(
        `UPDATE pedidos_delivery SET estado = 'LIQUIDADO', liquidado_en = now(),
                entregado_en = COALESCE(entregado_en, now())
          WHERE id = ANY($1::uuid[])`,
        [b.pedidos],
      );
      await encolarFilas(c, "movimientos_caja", [movId]);
      await encolarFilas(c, "pedidos_delivery", b.pedidos);
      return { pedidos: ps.rowCount, esperado: esperado.toFixed(2), entregado: b.montoEntregado, diferencia: diferencia.toFixed(2) };
    });
  });
}
