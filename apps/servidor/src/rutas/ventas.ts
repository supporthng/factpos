import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import {
  validarPagos, uuidv7, cotizarCarrito, ErrorCarrito, type LineaCotizada as LineaCotizadaBase,
} from "@factpos/compartido";
import { enTransaccion, ErrorNegocio, pool } from "../db.js";
import { contextoCaja, SQL_PRESENTACION, type ContextoCaja, type PresentacionVenta } from "../contexto.js";
import { ofertasPara, validarCupon, bloquearOfertasConTope } from "../promociones.js";
import { emitirEcfVenta } from "../fiscal/emitir.js";
import { verificarAutorizacion } from "../autorizacion.js";
import { datosTicket } from "./facturas.js";

const cantidad = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida");
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");

const CarritoSchema = z.object({
  clienteId: z.string().uuid().optional(),
  cuponCodigo: z.string().trim().min(1).max(30).optional(),
  items: z
    .array(z.object({ presentacionId: z.string().uuid(), cantidad, descuentoManual: monto.optional(), precioVariable: monto.optional() }))
    .min(1, "La venta no tiene productos")
    .max(500),
});

const VentaSchema = CarritoSchema.extend({
  usuarioId: z.string().uuid(),
  /** Id generado por la caja: si la respuesta se pierde y la caja reintenta, no se duplica */
  ventaId: z.string().uuid().optional(),
  /** Autorización del supervisor (requerida si hay descuentos manuales) */
  autorizacionDescuento: z.string().max(2000).optional(),
  motivoDescuento: z.string().trim().max(200).optional(),
  /** Observaciones de la venta (salen en el ticket) */
  notas: z.string().trim().max(300).optional(),
  tipoDocumento: z.enum(["E32", "E31"]).default("E32"),
  pagos: z
    .array(
      z.object({
        formaPago: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO", "OTRO"]),
        monto,
        recibido: monto.optional(),
        referencia: z.string().max(60).optional(),
      }),
    )
    .min(1, "Falta la forma de pago"),
});

type Carrito = z.infer<typeof CarritoSchema>;

/** Datos de una venta ya validados. Delivery la usa con forma de pago "DELIVERY". */
export interface VentaInput extends Carrito {
  usuarioId: string;
  ventaId?: string;
  autorizacionDescuento?: string;
  motivoDescuento?: string;
  notas?: string;
  tipoDocumento: "E32" | "E31";
  pagos: { formaPago: "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "CREDITO" | "DELIVERY" | "OTRO"; monto: string; recibido?: string; referencia?: string }[];
}

interface LineaCotizada extends LineaCotizadaBase {
  linea: number;
  prod: PresentacionVenta;
  cantidad: string;
}

/**
 * Cotiza con los datos de la base y el motor compartido (`cotizarCarrito`),
 * el mismo que usa la terminal con su catálogo en memoria.
 */
async function cotizar(c: Pick<PoolClient, "query">, ctx: ContextoCaja, carrito: Carrito, bloquearCupon: boolean, contingencia = false) {
  let listaCliente: string | null = null;
  let cliente: { tipo_documento: string; nombre: string } | null = null;
  if (carrito.clienteId) {
    const cl = await c.query(
      "SELECT tipo_documento, nombre, lista_precio_id FROM clientes WHERE id = $1 AND empresa_id = $2 AND activo",
      [carrito.clienteId, ctx.empresaId],
    );
    if (!cl.rowCount) throw new ErrorNegocio("Cliente no encontrado");
    cliente = cl.rows[0];
    listaCliente = cl.rows[0].lista_precio_id;
  }

  const ids = carrito.items.map((i) => i.presentacionId);
  const pres = await c.query<PresentacionVenta>(`${SQL_PRESENTACION} AND pr.id = ANY($5::uuid[])`, [
    ctx.empresaId, ctx.sucursalId, ctx.almacenId, listaCliente, ids,
  ]);
  const mapa = new Map(pres.rows.map((p) => [p.presentacionId, p]));
  const nivelVenta = listaCliente ??
    (await c.query("SELECT id FROM listas_precio WHERE empresa_id = $1 AND es_predeterminada", [ctx.empresaId])).rows[0]?.id ?? null;
  let ofertas = await ofertasPara(c, ctx.empresaId, ctx.sucursalId, nivelVenta, pres.rows);
  // Ofertas con tope: al registrar se bloquean y se vuelven a contar, para que dos cajas
  // cobrando a la vez no vendan la misma unidad en oferta.
  if (contingencia) {
    // La venta ya se hizo en la caja sin servidor: las ofertas valen como se cobraron
    ofertas = new Map([...ofertas].map(([k, os]) => [k, os.map((o) => ({ ...o, restantes: null }))]));
  } else if (bloquearCupon) {
    const conTope = [...new Set([...ofertas.values()].flat().filter((o) => o.restantes != null).map((o) => o.id))];
    if (await bloquearOfertasConTope(c, conTope)) ofertas = await ofertasPara(c, ctx.empresaId, ctx.sucursalId, nivelVenta, pres.rows);
  }

  const prods = carrito.items.map((it, idx) => {
    const p = mapa.get(it.presentacionId);
    if (!p) throw new ErrorNegocio(`Producto de la línea ${idx + 1} no existe o está inactivo`);
    // Precio variable: lo digita el cajero, pero solo dentro del rango definido en el producto
    if (p.precioVariable) {
      if (!it.precioVariable) throw new ErrorNegocio(`Indique el precio de ${p.nombre}`);
      const v = new Decimal(it.precioVariable);
      if (v.lt(p.precioVariableMin ?? 0) || v.gt(p.precioVariableMax ?? 0)) {
        throw new ErrorNegocio(`El precio de ${p.nombre} debe estar entre RD$${p.precioVariableMin} y RD$${p.precioVariableMax}`);
      }
      return { ...p, precio: v.toFixed(2) };
    }
    if (p.precio === null) throw new ErrorNegocio(`${p.nombre} no tiene precio asignado`);
    return p;
  });

  // Productos que no se venden sin existencia
  const demanda = new Map<string, { p: PresentacionVenta; cant: Decimal }>();
  carrito.items.forEach((it, i) => {
    const p = prods[i];
    if (p.permiteSinExistencia || p.tipo === "SERVICIO") return;
    const d = demanda.get(p.productoId) ?? { p, cant: new Decimal(0) };
    d.cant = d.cant.plus(new Decimal(it.cantidad).mul(p.factor));
    demanda.set(p.productoId, d);
  });
  for (const { p, cant } of demanda.values()) {
    if (contingencia) break; // la mercancía ya salió de la tienda
    if (cant.gt(p.existencia)) throw new ErrorNegocio(`No hay existencia suficiente de ${p.nombre}: quedan ${Number(p.existencia)}`);
  }

  const cupon = carrito.cuponCodigo
    ? await validarCupon(c, ctx.empresaId, ctx.sucursalId, carrito.cuponCodigo, carrito.clienteId, bloquearCupon)
    : null;

  let r;
  try {
    r = cotizarCarrito(
      carrito.items.map((it, i) => ({
        cantidad: it.cantidad,
        precio: prods[i].precio!,
        tasaItbis: prods[i].tasaItbis,
        precioIncluyeItbis: prods[i].precioIncluyeItbis,
        esPesable: prods[i].esPesable,
        nombre: prods[i].nombre,
        ofertas: ofertas.get(prods[i].presentacionId) ?? [],
        descuentoManual: it.descuentoManual,
        factor: prods[i].factor,
      })),
      cupon,
    );
  } catch (e) {
    if (e instanceof ErrorCarrito) throw new ErrorNegocio(e.message);
    throw e;
  }

  const lineas: LineaCotizada[] = r.lineas.map((l, i) => ({ ...l, linea: i + 1, prod: prods[i], cantidad: carrito.items[i].cantidad }));
  return { lineas, totales: r.totales, cupon: r.cupon, cliente, nivelVenta, ofertasAgotadas: r.ofertasAgotadas };
}

function resumen(q: Awaited<ReturnType<typeof cotizar>>) {
  return {
    ...q.totales,
    cupon: q.cupon,
    ofertasAgotadas: q.ofertasAgotadas,
    lineas: q.lineas.map((l) => ({
      linea: l.linea,
      presentacionId: l.prod.presentacionId,
      descripcion: `${l.prod.nombre} ${l.prod.presentacion}`.trim(),
      cantidad: l.cantidad,
      precio: l.prod.precio,
      oferta: l.oferta?.nombre ?? null,
      descuentoOferta: l.oferta?.descuento ?? "0.00",
      descuentoCupon: l.descuentoCupon,
      ...l.calc,
    })),
  };
}

/**
 * Registra una venta completa dentro de la transacción `c`:
 * venta + líneas + pagos + kardex + crédito + cupón + e-CF pendiente + subida a la nube.
 *
 * Rendimiento: el número de consultas es CONSTANTE (≈12) sin importar cuántas
 * líneas tenga la venta; las líneas, pagos y movimientos de kardex se insertan
 * en bloque con unnest(). Una venta de 40 líneas cuesta lo mismo que una de 2.
 */
export async function registrarVenta(
  c: PoolClient,
  cajaId: string,
  body: VentaInput,
  opciones: {
    pagarTodoCon?: VentaInput["pagos"][number]["formaPago"];
    /** Venta hecha en la caja sin servidor: su hora real, su e-NCF apartado y su turno */
    contingencia?: { creadoEn: string; encf: string; rangoId: string; turnoId: string };
  } = {},
) {
  await c.query("SELECT 1 FROM cajas WHERE id = $1 FOR UPDATE", [cajaId]); // numeración por caja
  const ctx = await contextoCaja(cajaId, c);
  const cont = opciones.contingencia;

  // Reintento de una venta que ya entró (se perdió la respuesta): se devuelve la misma
  if (body.ventaId) {
    const ya = await c.query("SELECT 1 FROM ventas WHERE id = $1 AND caja_id = $2", [body.ventaId, cajaId]);
    if (ya.rowCount) return { ...(await datosTicket(c, body.ventaId)), duplicada: true };
  }

  const turno = cont
    ? await c.query<{ id: string }>("SELECT id FROM turnos WHERE id = $1 AND caja_id = $2", [cont.turnoId, cajaId])
    : await c.query<{ id: string }>("SELECT id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId]);
  if (!turno.rowCount) throw new ErrorNegocio("La caja no tiene un turno abierto", 409);
  const turnoId = turno.rows[0].id;
  if (cont) {
    if (body.tipoDocumento !== "E32") throw new ErrorNegocio("Sin servidor solo se emiten facturas de consumo (E32)");
    if (body.pagos.some((p) => p.formaPago === "CREDITO")) throw new ErrorNegocio("Sin servidor no se vende a crédito");
    if (body.cuponCodigo || body.items.some((i) => i.descuentoManual)) throw new ErrorNegocio("Sin servidor no hay cupones ni descuentos");
  }

  // Descuentos manuales: solo con aprobación de un supervisor
  const descManual = body.items.reduce((a, i) => a.plus(i.descuentoManual ?? 0), new Decimal(0));
  const aprobacion = descManual.gt(0) ? verificarAutorizacion(body.autorizacionDescuento, "venta.descuento", cajaId) : null;

  const q = await cotizar(c, ctx, body, true, !!cont);
  if (body.tipoDocumento === "E31" && !(q.cliente && ["RNC", "CEDULA"].includes(q.cliente.tipo_documento))) {
    throw new ErrorNegocio("La factura de crédito fiscal requiere un cliente con RNC o cédula");
  }

  if (opciones.pagarTodoCon) body = { ...body, pagos: [{ formaPago: opciones.pagarTodoCon, monto: q.totales.total }] };
  let pagos;
  try {
    pagos = validarPagos(q.totales.total, body.pagos);
  } catch (e) {
    throw new ErrorNegocio((e as Error).message);
  }

  const credito = pagos.filter((p) => p.formaPago === "CREDITO").reduce((a, p) => a.plus(p.monto), new Decimal(0));
  if (credito.gt(0)) {
    if (!body.clienteId) throw new ErrorNegocio("La venta a crédito requiere un cliente");
    const s = await c.query<{ limite: string; saldo: string }>(
      `SELECT c.limite_credito AS limite, COALESCE((SELECT SUM(m.monto) FROM cxc_movimientos m WHERE m.cliente_id = c.id), 0) AS saldo
         FROM clientes c WHERE c.id = $1`,
      [body.clienteId],
    );
    const disponible = new Decimal(s.rows[0].limite).minus(s.rows[0].saldo);
    if (credito.gt(disponible)) throw new ErrorNegocio(`Crédito insuficiente: disponible RD$${disponible.toFixed(2)}`);
  }

  const ventaId = body.ventaId ?? uuidv7();
  const v = await c.query<{ numero: string }>(
    `INSERT INTO ventas (id, sucursal_id, caja_id, turno_id, usuario_id, cliente_id, numero_interno,
                         tipo_documento, condicion, subtotal, descuento, itbis, isc, total, creado_en, contingencia, notas)
     VALUES ($1,$2,$3,$4,$5,$6,
             (SELECT COALESCE(MAX(numero_interno), 0) + 1 FROM ventas WHERE caja_id = $3),
             $7,$8,$9,$10,$11,0,$12, COALESCE($13::timestamptz, now()), $14, $15)
     RETURNING numero_interno AS numero`,
    [ventaId, ctx.sucursalId, cajaId, turnoId, body.usuarioId, body.clienteId ?? null,
     body.tipoDocumento, credito.gt(0) ? "CREDITO" : "CONTADO",
     q.totales.subtotal, q.totales.descuento, q.totales.itbis, q.totales.total, cont?.creadoEn ?? null, !!cont, body.notas || null],
  );
  const numero = v.rows[0].numero;

  // Combos: el costo es la suma de sus componentes
  const L = q.lineas;
  const combos = [...new Set(L.filter((l) => l.prod.tipo === "COMBO").map((l) => l.prod.productoId))];
  const componentes = combos.length
    ? (await c.query<{ combo_id: string; componente_id: string; cantidad: string; costo: string }>(
        `SELECT pc.combo_id, pc.componente_id, pc.cantidad,
                COALESCE(e.costo_promedio, p.costo_promedio) AS costo
           FROM producto_componentes pc JOIN productos p ON p.id = pc.componente_id
           LEFT JOIN existencias e ON e.producto_id = pc.componente_id AND e.almacen_id = $2
          WHERE pc.combo_id = ANY($1::uuid[])`,
        [combos, ctx.almacenId],
      )).rows
    : [];
  for (const l of L) {
    if (l.prod.tipo !== "COMBO") continue;
    const comps = componentes.filter((x) => x.combo_id === l.prod.productoId);
    l.prod = { ...l.prod, costoPromedio: comps.reduce((a, x) => a.plus(new Decimal(x.cantidad).mul(x.costo)), new Decimal(0)).toFixed(4) };
  }

  // Líneas en bloque
  await c.query(
    `INSERT INTO venta_items (id, venta_id, linea, presentacion_id, descripcion, cantidad, factor, precio_unitario,
                              descuento, tasa_itbis, itbis, total, costo_unitario, oferta_id, descuento_oferta,
                              descuento_cupon, lista_precio_id, descuento_manual, unidades_oferta)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::smallint[], $4::uuid[], $5::text[], $6::numeric[], $7::numeric[],
                          $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[], $13::numeric[],
                          $14::uuid[], $15::numeric[], $16::numeric[], $17::uuid[], $18::numeric[], $19::numeric[])`,
    [L.map(() => uuidv7()), L.map(() => ventaId), L.map((l) => l.linea), L.map((l) => l.prod.presentacionId),
     L.map((l) => `${l.prod.nombre} ${l.prod.presentacion}`.trim()), L.map((l) => l.cantidad), L.map((l) => l.prod.factor),
     L.map((l) => l.prod.precio), L.map((l) => l.calc.descuento), L.map((l) => l.prod.tasaItbis), L.map((l) => l.calc.itbis),
     L.map((l) => l.calc.total), L.map((l) => l.prod.costoPromedio), L.map((l) => l.oferta?.ofertaId ?? null),
     L.map((l) => l.oferta?.descuento ?? "0"), L.map((l) => l.descuentoCupon), L.map((l) => l.prod.listaPrecioId),
     L.map((l) => l.descuentoManual),
     L.map((l) => (l.oferta ? new Decimal(l.oferta.unidades).mul(l.prod.factor).toString() : "0"))],
  );

  // Kardex en bloque (el trigger calcula saldo y costo por fila). Los combos descuentan sus componentes.
  const K: { productoId: string; cantidad: string }[] = [];
  for (const l of L) {
    const unidades = new Decimal(l.cantidad).mul(l.prod.factor);
    if (l.prod.tipo === "COMBO") {
      for (const x of componentes.filter((y) => y.combo_id === l.prod.productoId)) {
        K.push({ productoId: x.componente_id, cantidad: unidades.mul(x.cantidad).neg().toFixed(3) });
      }
    } else if (l.prod.controlaStock) {
      K.push({ productoId: l.prod.productoId, cantidad: unidades.neg().toFixed(3) });
    }
  }
  if (K.length) {
    await c.query(
      `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario,
                                       documento_tipo, documento_id, usuario_id, creado_en)
       SELECT id, $2, $3, producto_id, 'VENTA', cantidad, 0, 'venta', $4, $5, COALESCE($8::timestamptz, now())
         FROM unnest($1::uuid[], $6::uuid[], $7::numeric[]) AS t(id, producto_id, cantidad)`,
      [K.map(() => uuidv7()), ctx.sucursalId, ctx.almacenId, ventaId, body.usuarioId,
       K.map((k) => k.productoId), K.map((k) => k.cantidad), cont?.creadoEn ?? null],
    );
  }

  await c.query(
    `INSERT INTO venta_pagos (id, venta_id, forma_pago, monto, referencia, recibido, cambio)
     SELECT id, $2, forma, monto, ref, recibido, cambio
       FROM unnest($1::uuid[], $3::text[], $4::numeric[], $5::text[], $6::numeric[], $7::numeric[])
            AS t(id, forma, monto, ref, recibido, cambio)`,
    [pagos.map(() => uuidv7()), ventaId, pagos.map((p) => p.formaPago), pagos.map((p) => p.monto),
     pagos.map((p) => p.referencia ?? null), pagos.map((p) => p.recibido ?? null), pagos.map((p) => p.cambio ?? null)],
  );

  if (credito.gt(0)) {
    await c.query(
      `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, venta_id, turno_id, usuario_id)
       VALUES ($1,$2,$3,'CARGO',$4,$5,$6,$7)`,
      [uuidv7(), ctx.sucursalId, body.clienteId, credito.toFixed(2), ventaId, turnoId, body.usuarioId],
    );
  }
  if (q.cupon) {
    await c.query(
      "INSERT INTO cupon_usos (id, cupon_id, venta_id, sucursal_id, cliente_id, descuento) VALUES ($1,$2,$3,$4,$5,$6)",
      [uuidv7(), q.cupon.id, ventaId, ctx.sucursalId, body.clienteId ?? null, q.cupon.total],
    );
  }

  if (aprobacion) {
    await c.query(
      `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
       VALUES ($1,$2,$3,$4,'venta.descuento','venta',$5,$6)`,
      [uuidv7(), ctx.sucursalId, body.usuarioId, aprobacion.supervisorId, ventaId,
       JSON.stringify({ monto: descManual.toFixed(2), motivo: body.motivoDescuento ?? null })],
    );
  }

  // Facturación electrónica: e-NCF, XML firmado, código de seguridad y QR para el ticket.
  // El envío a la DGII lo hace la cola en segundo plano (funciona sin internet).
  const fiscal = await emitirEcfVenta(c, ventaId, cont ? { encf: cont.encf, rangoId: cont.rangoId, fecha: cont.creadoEn } : undefined);

  // Documento completo para la nube
  await c.query(
    `INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
     SELECT 'ventas', v.id, 'INSERT', jsonb_build_object(
              'venta', to_jsonb(v),
              'items', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.linea) FROM venta_items i WHERE i.venta_id = v.id),
              'pagos', (SELECT jsonb_agg(to_jsonb(p)) FROM venta_pagos p WHERE p.venta_id = v.id),
              'kardex', (SELECT jsonb_agg(to_jsonb(k)) FROM kardex_movimientos k WHERE k.documento_tipo = 'venta' AND k.documento_id = v.id),
              'cxc', (SELECT jsonb_agg(to_jsonb(m)) FROM cxc_movimientos m WHERE m.venta_id = v.id),
              'cupon', (SELECT to_jsonb(u) FROM cupon_usos u WHERE u.venta_id = v.id),
              'ecf', (SELECT to_jsonb(d) - 'xml' - 'xml_envio' FROM ecf_documentos d WHERE d.venta_id = v.id),
              'auditoria', (SELECT jsonb_agg(to_jsonb(a)) FROM auditoria a WHERE a.entidad = 'venta' AND a.entidad_id = v.id))
       FROM ventas v WHERE v.id = $1`,
    [ventaId],
  );

  return {
    id: ventaId,
    numero,
    tipoDocumento: body.tipoDocumento,
    ...resumen(q),
    pagos,
    cambio: pagos.reduce((a, p) => a.plus(p.cambio ?? 0), new Decimal(0)).toFixed(2),
    fiscal,
    fecha: new Date().toISOString(),
  };
}

export async function rutasVentas(app: FastifyInstance) {
  /**
   * Cotización en el servidor (respaldo). La caja normalmente calcula sola con
   * su catálogo en memoria y el mismo motor; esta ruta sirve para clientes
   * livianos (tablet de delivery, app móvil) o para verificar.
   */
  app.post("/cajas/:cajaId/cotizar", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const body = CarritoSchema.parse(req.body);
    const ctx = await contextoCaja(cajaId);
    return resumen(await cotizar(pool, ctx, body, false));
  });

  /** Valida un cupón para que la terminal lo aplique con su motor local. */
  app.get("/cajas/:cajaId/cupones/:codigo", async (req) => {
    const { cajaId, codigo } = z.object({ cajaId: z.string().uuid(), codigo: z.string().trim().min(1).max(30) }).parse(req.params);
    const { clienteId } = z.object({ clienteId: z.string().uuid().optional() }).parse(req.query);
    const ctx = await contextoCaja(cajaId);
    const cu = await validarCupon(pool, ctx.empresaId, ctx.sucursalId, codigo, clienteId);
    return {
      id: cu.id, codigo: cu.codigo, tipo: cu.tipo, valor: cu.valor, compraMinima: cu.compraMinima,
      topeDescuento: cu.topeDescuento, acumulableConOfertas: cu.acumulableConOfertas,
    };
  });

  /** Cobro: una sola ida y vuelta. Precios, ofertas e impuestos se recalculan aquí. */
  app.post("/cajas/:cajaId/ventas", async (req, rep) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const body = VentaSchema.parse(req.body);
    const r = await enTransaccion((c) => registrarVenta(c, cajaId, body));
    rep.code(201);
    return r;
  });
}
