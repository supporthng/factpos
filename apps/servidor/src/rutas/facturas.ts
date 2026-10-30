import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";
import { autorizarConPin, verificarAutorizacion } from "../autorizacion.js";
import { emitirEcfVenta } from "../fiscal/emitir.js";

const uuid = z.string().uuid();

/** Datos para imprimir (o reimprimir) el ticket de una venta o nota de crédito. */
export async function datosTicket(c: Pick<PoolClient, "query">, ventaId: string) {
  const r = await c.query(
    `SELECT v.id, v.numero_interno AS numero, v.numero_documento AS "numeroDocumento", v.tipo_documento AS "tipoDocumento", v.creado_en AS fecha,
            v.subtotal, v.descuento, v.itbis, v.total, v.motivo, v.notas,
            COALESCE((SELECT SUM(cambio) FROM venta_pagos WHERE venta_id = v.id), 0)::text AS cambio,
            (SELECT jsonb_build_object('codigo', cu.codigo, 'total', u.descuento) FROM cupon_usos u JOIN cupones cu ON cu.id = u.cupon_id WHERE u.venta_id = v.id) AS cupon,
            (SELECT jsonb_agg(jsonb_build_object(
                'descripcion', i.descripcion, 'cantidad', i.cantidad, 'precio', i.precio_unitario, 'total', i.total,
                'oferta', o.nombre, 'descuentoOferta', i.descuento_oferta, 'descuentoCupon', i.descuento_cupon,
                'descuentoManual', i.descuento_manual, 'presentacionId', i.presentacion_id) ORDER BY i.linea)
               FROM venta_items i LEFT JOIN ofertas o ON o.id = i.oferta_id WHERE i.venta_id = v.id) AS lineas,
            (SELECT jsonb_agg(jsonb_build_object('formaPago', p.forma_pago, 'monto', p.monto, 'recibido', p.recibido, 'cambio', p.cambio, 'referencia', p.referencia))
               FROM venta_pagos p WHERE p.venta_id = v.id) AS pagos,
            (SELECT jsonb_build_object('encf', d.encf, 'codigoSeguridad', d.codigo_seguridad, 'fechaFirma', d.fecha_firma,
                                       'urlQr', d.url_qr, 'modo', d.modo_envio,
                                       'venceSecuencia', (SELECT vence_en FROM ecf_rangos WHERE id = d.rango_id))
               FROM ecf_documentos d WHERE d.venta_id = v.id) AS fiscal,
            CASE WHEN cl.id IS NOT NULL THEN jsonb_build_object('id', cl.id, 'nombre', cl.nombre, 'documento', cl.documento) END AS cliente,
            (SELECT d.encf FROM ecf_documentos d WHERE d.venta_id = v.venta_origen_id) AS "encfModificado"
       FROM ventas v LEFT JOIN clientes cl ON cl.id = v.cliente_id
      WHERE v.id = $1`,
    [ventaId],
  );
  if (!r.rowCount) throw new ErrorNegocio("Factura no encontrada", 404);
  return r.rows[0];
}

export async function rutasFacturas(app: FastifyInstance) {
  /** El supervisor teclea su PIN y obtiene una aprobación para una acción concreta. */
  app.post("/cajas/:cajaId/autorizar", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z.object({ pin: z.string().regex(/^\d{4,8}$/, "PIN de 4 a 8 dígitos"), permiso: z.enum(["venta.descuento", "venta.anular", "venta.corregir", "cliente.precio", "caja.retiro", "caja.gasto"]) }).parse(req.body);
    const ctx = await contextoCaja(cajaId);
    return autorizarConPin(pool, ctx.empresaId, cajaId, b.pin, b.permiso);
  });

  /** Reimprimir la última factura de esta terminal. */
  app.get("/cajas/:cajaId/ventas/ultima", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const r = await pool.query("SELECT id FROM ventas WHERE caja_id = $1 ORDER BY creado_en DESC LIMIT 1", [cajaId]);
    if (!r.rowCount) throw new ErrorNegocio("Esta terminal todavía no tiene facturas", 404);
    return datosTicket(pool, r.rows[0].id);
  });

  /** Facturas del turno abierto (para anular o corregir). */
  app.get("/cajas/:cajaId/ventas/turno", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const r = await pool.query(
      `SELECT v.id, v.numero_interno AS numero, v.tipo_documento AS tipo, v.total, v.creado_en AS fecha,
              d.encf, cl.nombre AS cliente,
              (SELECT n.id FROM ventas n WHERE n.venta_origen_id = v.id AND n.tipo_documento = 'E34' LIMIT 1) IS NOT NULL AS anulada
         FROM ventas v
         JOIN turnos t ON t.id = v.turno_id AND t.estado = 'ABIERTO'
         LEFT JOIN ecf_documentos d ON d.venta_id = v.id
         LEFT JOIN clientes cl ON cl.id = v.cliente_id
        WHERE v.caja_id = $1 ORDER BY v.creado_en DESC LIMIT 100`,
      [cajaId],
    );
    return r.rows;
  });

  /**
   * Anular (o corregir) una factura. Requiere motivo y aprobación de supervisor.
   * Se emite una nota de crédito electrónica (E34) por el total: vuelve el
   * inventario, se registra la devolución del dinero en el turno y se revierte
   * el crédito del cliente. El e-CF original nunca se borra.
   * "Corregir" hace lo mismo y devuelve los productos para volver a facturar.
   */
  app.post("/cajas/:cajaId/ventas/:ventaId/anular", async (req) => {
    const { cajaId, ventaId } = z.object({ cajaId: uuid, ventaId: uuid }).parse(req.params);
    const b = z
      .object({
        usuarioId: uuid,
        motivo: z.string().trim().min(10, "Explique el motivo (mínimo 10 caracteres)").max(200),
        autorizacion: z.string().max(2000),
        corregir: z.boolean().default(false),
      })
      .parse(req.body);

    return enTransaccion(async (c) => {
      const aprob = verificarAutorizacion(b.autorizacion, b.corregir ? "venta.corregir" : "venta.anular", cajaId);
      await c.query("SELECT 1 FROM cajas WHERE id = $1 FOR UPDATE", [cajaId]);
      const ctx = await contextoCaja(cajaId, c);
      const turno = await c.query<{ id: string }>("SELECT id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId]);
      if (!turno.rowCount) throw new ErrorNegocio("La caja no tiene un turno abierto", 409);

      const o = (await c.query(
        "SELECT * FROM ventas WHERE id = $1 AND sucursal_id = $2 AND tipo_documento IN ('E31','E32') FOR UPDATE",
        [ventaId, ctx.sucursalId],
      )).rows[0];
      if (!o) throw new ErrorNegocio("Factura no encontrada en esta sucursal", 404);
      const ya = await c.query("SELECT 1 FROM ventas WHERE venta_origen_id = $1 AND tipo_documento = 'E34'", [ventaId]);
      if (ya.rowCount) throw new ErrorNegocio("Esta factura ya fue anulada", 409);
      if (o.condicion === "CREDITO") {
        // Si el cliente ya abonó, el saldo no alcanza para revertir: se avisa
        const s = await c.query<{ saldo: string }>("SELECT COALESCE(SUM(monto), 0) AS saldo FROM cxc_movimientos WHERE cliente_id = $1", [o.cliente_id]);
        if (Number(s.rows[0].saldo) < 0) throw new ErrorNegocio("El cliente tiene saldo a favor; revise su cuenta antes de anular");
      }

      const ncId = uuidv7();
      const nc = await c.query<{ numero: string }>(
        `INSERT INTO ventas (id, sucursal_id, caja_id, turno_id, usuario_id, cliente_id, numero_interno, tipo_documento,
                             venta_origen_id, condicion, subtotal, descuento, itbis, isc, total, motivo, autorizado_por)
         SELECT $1, sucursal_id, $2, $3, $4, cliente_id,
                (SELECT COALESCE(MAX(numero_interno), 0) + 1 FROM ventas WHERE caja_id = $2),
                'E34', id, condicion, subtotal, descuento, itbis, isc, total, $5, $6
           FROM ventas WHERE id = $7
         RETURNING numero_interno AS numero`,
        [ncId, cajaId, turno.rows[0].id, b.usuarioId, b.motivo, aprob.supervisorId, ventaId],
      );

      await c.query(
        `INSERT INTO venta_items (id, venta_id, linea, presentacion_id, descripcion, cantidad, factor, precio_unitario,
                                  descuento, tasa_itbis, itbis, total, costo_unitario, oferta_id, descuento_oferta,
                                  descuento_cupon, lista_precio_id, descuento_manual, unidades_oferta)
         SELECT gen_random_uuid(), $1, linea, presentacion_id, descripcion, cantidad, factor, precio_unitario,
                descuento, tasa_itbis, itbis, total, costo_unitario, oferta_id, descuento_oferta,
                descuento_cupon, lista_precio_id, descuento_manual, unidades_oferta
           FROM venta_items WHERE venta_id = $2`,
        [ncId, ventaId],
      );

      // La mercancía regresa al inventario: exactamente lo que salió con la factura original
      // (incluye los componentes de los combos)
      await c.query(
        `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario,
                                         documento_tipo, documento_id, motivo, usuario_id)
         SELECT gen_random_uuid(), $2, $3, k.producto_id, 'DEVOLUCION_VENTA', -k.cantidad, k.costo_unitario,
                'venta', $1, $4, $5
           FROM kardex_movimientos k
          WHERE k.documento_tipo = 'venta' AND k.documento_id = $6 AND k.tipo = 'VENTA'
          ORDER BY k.id`,
        [ncId, ctx.sucursalId, ctx.almacenId, `Anulación: ${b.motivo}`, b.usuarioId, ventaId],
      );

      // Devolución de lo cobrado (en el cuadre del turno resta en su forma de pago)
      await c.query(
        `INSERT INTO venta_pagos (id, venta_id, forma_pago, monto, referencia)
         SELECT gen_random_uuid(), $1, forma_pago, monto, referencia FROM venta_pagos WHERE venta_id = $2`,
        [ncId, ventaId],
      );
      await c.query(
        `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, venta_id, turno_id, usuario_id)
         SELECT gen_random_uuid(), sucursal_id, cliente_id, 'AJUSTE', -monto, $1, $3, $4
           FROM cxc_movimientos WHERE venta_id = $2 AND tipo = 'CARGO'`,
        [ncId, ventaId, turno.rows[0].id, b.usuarioId],
      );

      const fiscal = await emitirEcfVenta(c, ncId);

      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
         VALUES ($1,$2,$3,$4,$5,'venta',$6,$7)`,
        [uuidv7(), ctx.sucursalId, b.usuarioId, aprob.supervisorId, b.corregir ? "venta.corregir" : "venta.anular", ventaId,
         JSON.stringify({ motivo: b.motivo, notaCredito: fiscal.encf })],
      );
      await c.query(
        `INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
         SELECT 'ventas', v.id, 'INSERT', jsonb_build_object(
                  'venta', to_jsonb(v),
                  'items', (SELECT jsonb_agg(to_jsonb(i)) FROM venta_items i WHERE i.venta_id = v.id),
                  'pagos', (SELECT jsonb_agg(to_jsonb(p)) FROM venta_pagos p WHERE p.venta_id = v.id),
                  'kardex', (SELECT jsonb_agg(to_jsonb(k)) FROM kardex_movimientos k WHERE k.documento_tipo = 'venta' AND k.documento_id = v.id),
                  'cxc', (SELECT jsonb_agg(to_jsonb(m)) FROM cxc_movimientos m WHERE m.venta_id = v.id),
                  'ecf', (SELECT to_jsonb(d) - 'xml' - 'xml_envio' FROM ecf_documentos d WHERE d.venta_id = v.id),
                  'auditoria', (SELECT jsonb_agg(to_jsonb(a)) FROM auditoria a WHERE a.entidad = 'venta' AND a.entidad_id = $2))
           FROM ventas v WHERE v.id = $1`,
        [ncId, ventaId],
      );

      const ticket = await datosTicket(c, ncId);
      return {
        notaCredito: { ...ticket, numero: nc.rows[0].numero },
        aprobadoPor: aprob.supervisor,
        // Para "corregir": los productos de la factura original, para volver a facturarlos
        recargar: b.corregir
          ? {
              clienteId: o.cliente_id,
              items: ticket.lineas.map((l: any) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad })),
            }
          : null,
      };
    });
  });
}
