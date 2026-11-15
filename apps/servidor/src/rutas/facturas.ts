import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";
import { autorizarConPin, autorizacionDirecta, verificarAutorizacion } from "../autorizacion.js";
import { frenar, fallo } from "./sesion.js";
import { emitirEcfVenta } from "../fiscal/emitir.js";

const uuid = z.string().uuid();

/** Datos para imprimir (o reimprimir) el ticket de una venta o nota de crédito. */
export async function datosTicket(c: Pick<PoolClient, "query">, ventaId: string) {
  const r = await c.query(
    `SELECT v.id, v.numero_interno AS numero, v.numero_documento AS "numeroDocumento", v.tipo_documento AS "tipoDocumento", v.creado_en AS fecha,
            v.subtotal, v.descuento, v.itbis, v.total, v.propina_legal AS "propinaLegal", v.motivo, v.notas,
            COALESCE((SELECT SUM(cambio) FROM venta_pagos WHERE venta_id = v.id), 0)::text AS cambio,
            (SELECT jsonb_build_object('codigo', cu.codigo, 'total', u.descuento) FROM cupon_usos u JOIN cupones cu ON cu.id = u.cupon_id WHERE u.venta_id = v.id) AS cupon,
            (SELECT jsonb_agg(jsonb_build_object(
                'descripcion', i.descripcion, 'cantidad', i.cantidad, 'precio', i.precio_unitario, 'total', i.total,
                'oferta', o.nombre, 'descuentoOferta', i.descuento_oferta, 'descuentoCupon', i.descuento_cupon,
                'descuentoManual', i.descuento_manual, 'descuentoNivel', i.descuento_nivel, 'presentacionId', i.presentacion_id) ORDER BY i.linea)
               FROM venta_items i LEFT JOIN ofertas o ON o.id = i.oferta_id WHERE i.venta_id = v.id) AS lineas,
            (SELECT jsonb_agg(jsonb_build_object('codigo', vc.codigo, 'descripcion', vc.descripcion, 'consumos', vc.consumos) ORDER BY vc.creado_en, vc.codigo)
               FROM vales_consumo vc WHERE vc.venta_id = v.id) AS vales,
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

/**
 * Anula (o corrige) una factura dentro de la transacción: nota de crédito/anulación interna, regreso al inventario,
 * devolución del dinero en el turno abierto de la caja y reverso del crédito del cliente.
 * Quien llama debe haber verificado ya la autorización del supervisor.
 */
export async function anularVenta(c: PoolClient, a: { cajaId: string; ventaId: string; usuarioId: string; supervisorId: string; motivo: string; corregir: boolean }) {
  const { cajaId, ventaId } = a;
  await c.query("SELECT 1 FROM cajas WHERE id = $1 FOR UPDATE", [cajaId]);
  const ctx = await contextoCaja(cajaId, c);
  const turno = await c.query<{ id: string }>("SELECT id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId]);
  if (!turno.rowCount) throw new ErrorNegocio("La caja no tiene un turno abierto", 409);

  const o = (await c.query(
    "SELECT * FROM ventas WHERE id = $1 AND sucursal_id = $2 AND tipo_documento IN ('E31','E32','B01','B02','B14','B15','B16','SIN') FOR UPDATE",
    [ventaId, ctx.sucursalId],
  )).rows[0];
  if (!o) throw new ErrorNegocio("Factura no encontrada en esta sucursal", 404);
  const ya = await c.query("SELECT parcial FROM ventas WHERE venta_origen_id = $1 AND tipo_documento IN ('E34','ANU')", [ventaId]);
  if (ya.rows.some((x) => !x.parcial)) throw new ErrorNegocio("Esta factura ya fue anulada", 409);
  if (ya.rowCount) throw new ErrorNegocio("Esta factura ya tiene devoluciones parciales: no puede anularse completa (devuelva lo que falta por línea)", 409);
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
            CASE WHEN tipo_documento IN ('E31','E32') THEN 'E34' ELSE 'ANU' END, id, condicion, subtotal, descuento, itbis, isc, total, $5, $6
       FROM ventas WHERE id = $7
     RETURNING numero_interno AS numero`,
    [ncId, cajaId, turno.rows[0].id, a.usuarioId, a.motivo, a.supervisorId, ventaId],
  );

  await c.query(
    `INSERT INTO venta_items (id, venta_id, linea, presentacion_id, descripcion, cantidad, factor, precio_unitario,
                              descuento, tasa_itbis, itbis, total, costo_unitario, oferta_id, descuento_oferta,
                              descuento_cupon, lista_precio_id, descuento_manual, unidades_oferta, descuento_nivel)
     SELECT gen_random_uuid(), $1, linea, presentacion_id, descripcion, cantidad, factor, precio_unitario,
            descuento, tasa_itbis, itbis, total, costo_unitario, oferta_id, descuento_oferta,
            descuento_cupon, lista_precio_id, descuento_manual, unidades_oferta, descuento_nivel
       FROM venta_items WHERE venta_id = $2`,
    [ncId, ventaId],
  );

  // La mercancía regresa al inventario: exactamente lo que salió con la factura original
  // (incluye los componentes de los combos)
  await c.query(
    `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario,
                                     documento_tipo, documento_id, motivo, usuario_id, lote_id)
     SELECT gen_random_uuid(), $2, $3, k.producto_id, 'DEVOLUCION_VENTA', -k.cantidad, k.costo_unitario,
            'venta', $1, $4, $5, k.lote_id
       FROM kardex_movimientos k
      WHERE k.documento_tipo = 'venta' AND k.documento_id = $6 AND k.tipo = 'VENTA'
      ORDER BY k.id`,
    [ncId, ctx.sucursalId, ctx.almacenId, `Anulación: ${a.motivo}`, a.usuarioId, ventaId],
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
    [ncId, ventaId, turno.rows[0].id, a.usuarioId],
  );

  const fiscal = o.tipo_documento === "E31" || o.tipo_documento === "E32" ? await emitirEcfVenta(c, ncId) : null;

  await c.query(
    `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
     VALUES ($1,$2,$3,$4,$5,'venta',$6,$7)`,
    [uuidv7(), ctx.sucursalId, a.usuarioId, a.supervisorId, a.corregir ? "venta.corregir" : "venta.anular", ventaId,
     JSON.stringify({ motivo: a.motivo, notaCredito: fiscal?.encf ?? null, anulacionInterna: fiscal === null })],
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
    // Para "corregir": los productos de la factura original, para volver a facturarlos
    recargar: a.corregir
      ? {
          clienteId: o.cliente_id,
          items: ticket.lineas.map((l: any) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad })),
        }
      : null,
  };
}

export async function rutasFacturas(app: FastifyInstance) {
  /** El supervisor teclea su PIN y obtiene una aprobación para una acción concreta. */
  app.post("/cajas/:cajaId/autorizar", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z.object({ pin: z.string().regex(/^\d{4,8}$/, "PIN de 4 a 8 dígitos"), permiso: z.enum(["venta.descuento", "venta.precio", "venta.anular", "venta.corregir", "cliente.precio", "caja.retiro", "caja.gasto", "caja.salir", "caja.cambiar_servidor", "venta.credito"]) }).parse(req.body);
    // Sin sesión de cajero (cerrar FactPOS desde la pantalla del PIN) se limitan los intentos, igual que al entrar
    const sinSesion = !(req as typeof req & { sesionCaja?: unknown }).sesionCaja;
    const llave = `autorizar:${cajaId}`;
    if (sinSesion) frenar(llave);
    const ctx = await contextoCaja(cajaId);
    try {
      return await autorizarConPin(pool, ctx.empresaId, cajaId, b.pin, b.permiso);
    } catch (e) {
      if (sinSesion) fallo(llave, 1);
      throw e;
    }
  });

  /**
   * Aprobación para quien YA entró a la caja y tiene el permiso (el administrador, un supervisor): no necesita teclear otro PIN.
   * La sesión de la caja (PIN del cajero) es la prueba; sin el permiso responde 403 y la pantalla pide el PIN de un supervisor.
   */
  app.post("/cajas/:cajaId/autorizar-propio", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z.object({ permiso: z.enum(["venta.descuento", "venta.precio", "venta.anular", "venta.corregir", "cliente.precio", "caja.retiro", "caja.gasto", "caja.salir", "venta.credito"]) }).parse(req.body);
    const s = (req as typeof req & { sesionCaja?: { u: string; p: string[] } }).sesionCaja;
    if (!s) throw new ErrorNegocio("Su sesión en la caja terminó: vuelva a entrar con su PIN", 401);
    const tiene = s.p.includes("*") || s.p.includes(b.permiso) || (b.permiso === "caja.salir" && s.p.includes("venta.anular"));
    if (!tiene) throw new ErrorNegocio("Su usuario no tiene este permiso: pida el PIN de un supervisor", 403);
    const u = await pool.query<{ nombre: string }>("SELECT nombre FROM usuarios WHERE id = $1", [s.u]);
    const nombre = u.rows[0]?.nombre ?? "Administrador";
    return { token: autorizacionDirecta(s.u, nombre, b.permiso, cajaId), supervisor: nombre };
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
              (SELECT n.id FROM ventas n WHERE n.venta_origen_id = v.id AND n.tipo_documento IN ('E34','ANU') LIMIT 1) IS NOT NULL AS anulada
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
      const r = await anularVenta(c, { cajaId, ventaId, usuarioId: b.usuarioId, supervisorId: aprob.supervisorId, motivo: b.motivo, corregir: b.corregir });
      return { ...r, aprobadoPor: aprob.supervisor };
    });
  });
}

const r2 = (n: Decimal) => n.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * Devolución PARCIAL de una factura: nota de crédito (e-CF E34, código de modificación 3) o devolución interna por
 * las líneas y cantidades indicadas. La factura sigue vigente. Regresa esa mercancía al inventario, devuelve ese dinero
 * (en las mismas formas de pago, en proporción) en el turno abierto y revierte esa parte del crédito del cliente.
 * Quien llama debe haber verificado ya la autorización del supervisor.
 */
export async function devolverParcial(c: PoolClient, a: { cajaId: string; ventaId: string; usuarioId: string; supervisorId: string; motivo: string; lineas: { linea: number; cantidad: string }[] }) {
  const { cajaId, ventaId } = a;
  await c.query("SELECT 1 FROM cajas WHERE id = $1 FOR UPDATE", [cajaId]);
  const ctx = await contextoCaja(cajaId, c);
  const turno = await c.query<{ id: string }>("SELECT id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId]);
  if (!turno.rowCount) throw new ErrorNegocio("La caja no tiene un turno abierto", 409);
  const o = (await c.query(
    "SELECT * FROM ventas WHERE id = $1 AND sucursal_id = $2 AND tipo_documento IN ('E31','E32','B01','B02','B14','B15','B16','SIN') FOR UPDATE", [ventaId, ctx.sucursalId])).rows[0];
  if (!o) throw new ErrorNegocio("Factura no encontrada en esta sucursal", 404);
  const previas = await c.query<{ parcial: boolean }>("SELECT parcial FROM ventas WHERE venta_origen_id = $1 AND tipo_documento IN ('E34','ANU')", [ventaId]);
  if (previas.rows.some((x) => !x.parcial)) throw new ErrorNegocio("Esta factura ya fue anulada", 409);
  if (!a.lineas.length) throw new ErrorNegocio("Indique qué se devuelve");
  if (new Set(a.lineas.map((l) => l.linea)).size !== a.lineas.length) throw new ErrorNegocio("Una línea está repetida");

  const items = (await c.query<{ linea: number; presentacion_id: string; descripcion: string; cantidad: string; factor: string; total: string; itbis: string; descuento: string; tipo: string; devuelta: string }>(
    `SELECT i.linea, i.presentacion_id, i.descripcion, i.cantidad::text, i.factor::text, i.total::text, i.itbis::text, i.descuento::text, p.tipo,
            COALESCE((SELECT SUM(ni.cantidad) FROM venta_items ni JOIN ventas n ON n.id = ni.venta_id
                       WHERE n.venta_origen_id = $1 AND n.parcial AND ni.linea = i.linea), 0)::text AS devuelta
       FROM venta_items i JOIN presentaciones pr ON pr.id = i.presentacion_id JOIN productos p ON p.id = pr.producto_id
      WHERE i.venta_id = $1 ORDER BY i.linea`, [ventaId])).rows;
  const porLinea = new Map(items.map((i) => [i.linea, i]));
  const dev = a.lineas.map((l) => {
    const i = porLinea.get(l.linea);
    if (!i) throw new ErrorNegocio(`La línea ${l.linea} no existe en la factura`);
    if (i.tipo === "COMBO") throw new ErrorNegocio(`${i.descripcion} es un combo: devuélvalo anulando la factura`);
    const cant = new Decimal(l.cantidad);
    const queda = new Decimal(i.cantidad).minus(i.devuelta);
    if (cant.lte(0)) throw new ErrorNegocio(`Cantidad inválida en ${i.descripcion}`);
    if (cant.gt(queda)) throw new ErrorNegocio(`De ${i.descripcion} solo se puede devolver ${queda.toString()} (ya se devolvió ${new Decimal(i.devuelta).toString()})`);
    const r = cant.div(i.cantidad);
    return { i, cant, r, total: r2(new Decimal(i.total).mul(r)), itbis: r2(new Decimal(i.itbis).mul(r)), descuento: r2(new Decimal(i.descuento).mul(r)) };
  });
  const totalNc = dev.reduce((s, d) => s.plus(d.total), new Decimal(0));
  const itbisNc = dev.reduce((s, d) => s.plus(d.itbis), new Decimal(0));
  const descNc = dev.reduce((s, d) => s.plus(d.descuento), new Decimal(0));
  const prop = totalNc.div(o.total);
  const subtotalNc = r2(new Decimal(o.subtotal).mul(prop));
  const iscNc = r2(new Decimal(o.isc ?? 0).mul(prop));

  const ncId = uuidv7();
  const nc = await c.query<{ numero: string }>(
    `INSERT INTO ventas (id, sucursal_id, caja_id, turno_id, usuario_id, cliente_id, numero_interno, tipo_documento,
                         venta_origen_id, condicion, subtotal, descuento, itbis, isc, total, motivo, autorizado_por, parcial)
     VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(numero_interno), 0) + 1 FROM ventas WHERE caja_id = $3),
             $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)
     RETURNING numero_interno AS numero`,
    [ncId, ctx.sucursalId, cajaId, turno.rows[0].id, a.usuarioId, o.cliente_id,
     o.tipo_documento === "E31" || o.tipo_documento === "E32" ? "E34" : "ANU", ventaId, o.condicion,
     subtotalNc.toFixed(2), descNc.toFixed(2), itbisNc.toFixed(2), iscNc.toFixed(2), totalNc.toFixed(2), a.motivo, a.supervisorId]);

  // Líneas devueltas (misma numeración de línea que la factura, para llevar la cuenta de lo ya devuelto)
  await c.query(
    `INSERT INTO venta_items (id, venta_id, linea, presentacion_id, descripcion, cantidad, factor, precio_unitario,
                              descuento, tasa_itbis, itbis, total, costo_unitario, oferta_id, descuento_oferta,
                              descuento_cupon, lista_precio_id, descuento_manual, unidades_oferta, descuento_nivel)
     SELECT gen_random_uuid(), $1, i.linea, i.presentacion_id, i.descripcion, d.cant, i.factor, i.precio_unitario,
            d.descuento, i.tasa_itbis, d.itbis, d.total, i.costo_unitario, i.oferta_id,
            ROUND(i.descuento_oferta * d.cant / i.cantidad, 2), ROUND(i.descuento_cupon * d.cant / i.cantidad, 2), i.lista_precio_id,
            ROUND(i.descuento_manual * d.cant / i.cantidad, 2), i.unidades_oferta * d.cant / i.cantidad, ROUND(i.descuento_nivel * d.cant / i.cantidad, 2)
       FROM venta_items i
       JOIN unnest($3::int[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[]) AS d(linea, cant, total, itbis, descuento) ON d.linea = i.linea
      WHERE i.venta_id = $2`,
    [ncId, ventaId, dev.map((d) => d.i.linea), dev.map((d) => d.cant.toString()), dev.map((d) => d.total.toFixed(2)), dev.map((d) => d.itbis.toFixed(2)), dev.map((d) => d.descuento.toFixed(2))]);

  // Inventario: por producto, la parte de lo vendido que se devuelve (misma proporción en cada lote)
  await c.query(
    `WITH vendido AS (
       SELECT pr.producto_id, SUM(i.cantidad * i.factor) AS und FROM venta_items i JOIN presentaciones pr ON pr.id = i.presentacion_id WHERE i.venta_id = $2 GROUP BY pr.producto_id
     ), devuelto AS (
       SELECT pr.producto_id, SUM(i.cantidad * i.factor) AS und FROM venta_items i JOIN presentaciones pr ON pr.id = i.presentacion_id WHERE i.venta_id = $1 GROUP BY pr.producto_id
     )
     INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, documento_tipo, documento_id, motivo, usuario_id, lote_id)
     SELECT gen_random_uuid(), $3, $4, k.producto_id, 'DEVOLUCION_VENTA', ROUND(-k.cantidad * dv.und / vd.und, 3), k.costo_unitario, 'venta', $1, $5, $6, k.lote_id
       FROM kardex_movimientos k JOIN vendido vd ON vd.producto_id = k.producto_id JOIN devuelto dv ON dv.producto_id = k.producto_id
      WHERE k.documento_tipo = 'venta' AND k.documento_id = $2 AND k.tipo = 'VENTA' AND ROUND(-k.cantidad * dv.und / vd.und, 3) <> 0`,
    [ncId, ventaId, ctx.sucursalId, ctx.almacenId, `Devolución parcial: ${a.motivo}`, a.usuarioId]);

  // Dinero: en las mismas formas de pago, en proporción (el último absorbe el redondeo)
  const pagos = (await c.query<{ forma_pago: string; monto: string; referencia: string | null }>("SELECT forma_pago, monto::text, referencia FROM venta_pagos WHERE venta_id = $1 ORDER BY monto DESC, id", [ventaId])).rows;
  let resto = totalNc;
  for (const [n, p] of pagos.entries()) {
    const m = n === pagos.length - 1 ? resto : r2(new Decimal(p.monto).mul(prop));
    resto = resto.minus(m);
    if (m.gt(0)) await c.query("INSERT INTO venta_pagos (id, venta_id, forma_pago, monto, referencia) VALUES (gen_random_uuid(), $1, $2, $3, $4)", [ncId, p.forma_pago, m.toFixed(2), p.referencia]);
  }
  // Crédito: se revierte la misma proporción del cargo
  await c.query(
    `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, venta_id, turno_id, usuario_id)
     SELECT gen_random_uuid(), sucursal_id, cliente_id, 'AJUSTE', -ROUND(monto * $5::numeric, 2), $1, $3, $4
       FROM cxc_movimientos WHERE venta_id = $2 AND tipo = 'CARGO'`,
    [ncId, ventaId, turno.rows[0].id, a.usuarioId, prop.toFixed(8)]);

  const fiscal = o.tipo_documento === "E31" || o.tipo_documento === "E32" ? await emitirEcfVenta(c, ncId) : null;

  await c.query(
    `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
     VALUES ($1,$2,$3,$4,'venta.devolucion_parcial','venta',$5,$6)`,
    [uuidv7(), ctx.sucursalId, a.usuarioId, a.supervisorId, ventaId,
     JSON.stringify({ motivo: a.motivo, notaCredito: fiscal?.encf ?? null, total: totalNc.toFixed(2), lineas: dev.map((d) => ({ linea: d.i.linea, cantidad: d.cant.toString() })) })]);
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
    [ncId, ventaId]);

  const ticket = await datosTicket(c, ncId);
  return { notaCredito: { ...ticket, numero: nc.rows[0].numero } };
}
