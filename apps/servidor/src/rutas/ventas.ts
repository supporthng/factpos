import type { FastifyInstance } from "fastify";
import { exigirLicenciaParaVender } from "../licencia/cliente.js";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import {
  validarPagos, uuidv7, cotizarCarrito, ErrorCarrito, esNegocioDeMesas, type LineaCotizada as LineaCotizadaBase,
} from "@factpos/compartido";
import { enTransaccion, ErrorNegocio, pool } from "../db.js";
import { contextoCaja, SQL_PRESENTACION, type ContextoCaja, type PresentacionVenta } from "../contexto.js";
import { ofertasPara, validarCupon, bloquearOfertasConTope } from "../promociones.js";
import { emitirEcfVenta } from "../fiscal/emitir.js";
import { repartirPorLotes } from "../lotes.js";
import { asignarNumeroNoElectronico } from "../fiscal/numeracion-modalidades.js";
import { verificarAutorizacion } from "../autorizacion.js";
import { datosTicket } from "./facturas.js";
import { crearVales } from "../vales.js";
import { exigirFuncion } from "./central-seguridad.js";

/** «Sin comprobante» es una función de Seguridad (apagada por defecto): sin ella toda venta lleva comprobante. */
export async function exigirSinComprobante(cajaId: string) {
  const e = (await pool.query<{ empresa_id: string }>("SELECT s.empresa_id FROM cajas ca JOIN sucursales s ON s.id = ca.sucursal_id WHERE ca.id = $1", [cajaId])).rows[0]?.empresa_id;
  if (e) await exigirFuncion(e, "venta_sin_comprobante");
}

const cantidad = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida");
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");

const CarritoSchema = z.object({
  clienteId: z.string().uuid().optional(),
  cuponCodigo: z.string().trim().min(1).max(30).optional(),
  items: z
    .array(z.object({ presentacionId: z.string().uuid(), cantidad, descuentoManual: monto.optional(), precioVariable: monto.optional(), precioNuevo: monto.optional() }))
    .min(1, "La venta no tiene productos")
    .max(500),
});

const VentaSchema = CarritoSchema.extend({
  usuarioId: z.string().uuid(),
  /** Id generado por la caja: si la respuesta se pierde y la caja reintenta, no se duplica */
  ventaId: z.string().uuid().optional(),
  /** Autorización del supervisor (requerida si hay descuentos manuales) */
  autorizacionDescuento: z.string().max(2000).optional(),
  /** Aprobación para vender a crédito (propia si el cajero tiene el permiso, o de un supervisor) */
  autorizacionCredito: z.string().max(2000).optional(),
  motivoDescuento: z.string().trim().max(200).optional(),
  /** Observaciones de la venta (salen en el ticket) */
  notas: z.string().trim().max(300).optional(),
  tipoDocumento: z.enum(["E32", "E31", "B01", "B02", "B14", "B15", "B16", "SIN"]).default("E32"),
  propinaLegal: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Propina inválida").optional(),
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

type CarritoBase = z.infer<typeof CarritoSchema>;
/** `precioLibre` solo lo pone la facturación de administración (con el permiso "venta.precio_libre"): la caja nunca lo recibe */
type Carrito = Omit<CarritoBase, "items"> & { items: (CarritoBase["items"][number] & { precioLibre?: string; series?: string[] })[];
  /** Venta por cobrar que se está cobrando o revisando: su propio apartado no cuenta contra la existencia (solo lo pone el servidor) */
  excluirApartado?: string };

/** Horas que una venta por cobrar sin cobrar sigue apartando existencia (después se libera sola, aunque siga en la lista) */
export const HORAS_APARTADO = 12;
/** Unidades sueltas de un producto apartadas por ventas por cobrar pendientes de esa sucursal */
export async function apartadoDe(c: Pick<PoolClient, "query">, sucursalId: string, productoId: string, excluir?: string): Promise<Decimal> {
  const r = await c.query<{ n: string }>(
    `SELECT COALESCE(SUM((it->>'cantidad')::numeric * pr.factor), 0)::text AS n
       FROM ventas_por_cobrar v CROSS JOIN LATERAL jsonb_array_elements(v.items) it
       JOIN presentaciones pr ON pr.id = (it->>'presentacionId')::uuid
      WHERE v.sucursal_id = $1 AND v.estado = 'PENDIENTE' AND v.creada_en > now() - make_interval(hours => $4) AND pr.producto_id = $2 AND ($3::uuid IS NULL OR v.id <> $3::uuid)`,
    [sucursalId, productoId, excluir ?? null, HORAS_APARTADO]);
  return new Decimal(r.rows[0]?.n ?? 0);
}

/** Datos de una venta ya validados. Delivery la usa con forma de pago "DELIVERY". */
export interface VentaInput extends Carrito {
  usuarioId: string;
  ventaId?: string;
  autorizacionDescuento?: string;
  autorizacionCredito?: string;
  motivoDescuento?: string;
  notas?: string;
  tipoDocumento: "E32" | "E31" | "B01" | "B02" | "B14" | "B15" | "B16" | "SIN";
  /** Propina legal cobrada (solo restaurantes, bares y discotecas): se suma a lo que paga el cliente, fuera del comprobante */
  propinaLegal?: string;
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
export async function cotizar(c: Pick<PoolClient, "query">, ctx: ContextoCaja, carrito: Carrito, bloquearCupon: boolean, contingencia = false) {
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
  // Precios 2 y 3 definidos como % de descuento sobre el precio 1: se cobra el precio 1 y la línea lleva el descuento
  let descuentoNivelPct = "0";
  let listaPrecios = listaCliente;
  if (listaCliente) {
    const dl = (await c.query<{ descuento_pct: string; es_predeterminada: boolean }>("SELECT descuento_pct::text, es_predeterminada FROM listas_precio WHERE id = $1", [listaCliente])).rows[0];
    if (dl && !dl.es_predeterminada && Number(dl.descuento_pct) > 0) { descuentoNivelPct = dl.descuento_pct; listaPrecios = null; }
  }

  const ids = carrito.items.map((i) => i.presentacionId);
  const pres = await c.query<PresentacionVenta>(`${SQL_PRESENTACION} AND pr.id = ANY($5::uuid[])`, [
    ctx.empresaId, ctx.sucursalId, ctx.almacenId, listaPrecios, ids,
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
    // Precio libre (facturación de administración): reemplaza el precio de lista; no lleva ofertas ni descuento de nivel
    if (it.precioLibre) {
      if (new Decimal(it.precioLibre).lte(0)) throw new ErrorNegocio(`El precio de ${p.nombre} debe ser mayor que cero`);
      return { ...p, precio: new Decimal(it.precioLibre).toFixed(2), precioVariable: true };
    }
    if (p.precio === null) throw new ErrorNegocio(`${p.nombre} no tiene precio asignado`);
    return Number(descuentoNivelPct) > 0 ? { ...p, listaPrecioId: listaCliente } : p;
  });

  // Cambio de precio en caja: solo a uno de los 3 precios definidos del producto, menor al vigente, y la rebaja no puede superar la diferencia
  if (!contingencia) {
    for (const [idx, it] of carrito.items.entries()) {
      if (!it.precioNuevo) continue;
      const p = prods[idx];
      const nombre = p.nombre;
      if (p.precioVariable) throw new ErrorNegocio(`${nombre} es de precio variable: no admite cambio de precio`);
      const niveles = await c.query<{ precio: string }>(
        `SELECT x.precio::text AS precio FROM precios x JOIN listas_precio lp ON lp.id = x.lista_precio_id
          WHERE x.presentacion_id = $1 AND x.activo AND lp.empresa_id = $2 AND lp.nivel BETWEEN 1 AND 3
            AND (x.sucursal_id IS NULL OR (x.sucursal_id = $3 AND (SELECT precios_por_sucursal FROM empresas WHERE id = $2)))`,
        [it.presentacionId, ctx.empresaId, ctx.sucursalId],
      );
      const nuevo = new Decimal(it.precioNuevo);
      if (!niveles.rows.some((n) => new Decimal(n.precio).eq(nuevo))) {
        throw new ErrorNegocio(`El precio ${nuevo.toFixed(2)} de ${nombre} no es uno de los 3 precios definidos`);
      }
      if (nuevo.gte(p.precio!)) throw new ErrorNegocio(`El nuevo precio de ${nombre} debe ser menor al vigente (${p.precio})`);
      const esperado = new Decimal(p.precio!).minus(nuevo).mul(it.cantidad);
      if (new Decimal(it.descuentoManual ?? 0).minus(esperado).gt(0.01)) {
        throw new ErrorNegocio(`La rebaja de ${nombre} es mayor que la del cambio de precio`);
      }
    }
  }

  // Productos que no se venden sin existencia
  const demanda = new Map<string, { p: PresentacionVenta; cant: Decimal }>();
  carrito.items.forEach((it, i) => {
    const p = prods[i];
    // Un producto con existencia insuficiente (o en 0) no se factura; los servicios y los productos sin control de existencia sí
    if (p.permiteSinExistencia || p.tipo === "SERVICIO" || (!p.controlaStock && p.tipo !== "COMBO")) return;
    const d = demanda.get(p.productoId) ?? { p, cant: new Decimal(0) };
    d.cant = d.cant.plus(new Decimal(it.cantidad).mul(p.factor));
    demanda.set(p.productoId, d);
  });
  for (const { p, cant } of demanda.values()) {
    if (contingencia) break; // la mercancía ya salió de la tienda
    const apartado = await apartadoDe(c, ctx.sucursalId, p.productoId, carrito.excluirApartado);
    if (cant.gt(new Decimal(p.existencia).minus(apartado))) {
      throw new ErrorNegocio(apartado.gt(0)
        ? `No hay existencia suficiente de ${p.nombre}: quedan ${Number(p.existencia)}, de las que ${Number(apartado)} están apartadas en ventas por cobrar`
        : `No hay existencia suficiente de ${p.nombre}: quedan ${Number(p.existencia)}`);
    }
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
        ofertas: carrito.items[i].precioLibre ? [] : ofertas.get(prods[i].presentacionId) ?? [],
        descuentoManual: it.descuentoManual,
        factor: prods[i].factor,
        descuentoNivelPct: prods[i].precioVariable ? undefined : descuentoNivelPct,
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

export function resumen(q: Awaited<ReturnType<typeof cotizar>>) {
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
/** Serie o IMEI: sin espacios ni guiones sueltos, en mayúsculas */
export const normalizarSerie = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "");

/**
 * Números de serie / IMEI de los productos que los llevan: una serie por unidad, sin repetir, y que no esté ya vendida.
 * Guarda también hasta cuándo dura la garantía (meses del producto desde hoy).
 */
async function guardarSeries(c: PoolClient, d: {
  ventaId: string; sucursalId: string; clienteId: string | null; itemIds: string[]; exigir: boolean;
  L: { linea: number; cantidad: string; prod: { productoId: string; presentacionId: string; nombre: string; factor: string } }[];
  items: { series?: string[] }[];
}) {
  const ids = [...new Set(d.L.map((l) => l.prod.productoId))];
  const ps = (await c.query<{ id: string; usa_series: boolean; garantia_meses: number }>("SELECT id, usa_series, garantia_meses FROM productos WHERE id = ANY($1::uuid[])", [ids])).rows;
  const info = new Map(ps.map((x) => [x.id, x]));
  const vistas = new Set<string>();
  for (const [i, l] of d.L.entries()) {
    const pr = info.get(l.prod.productoId);
    if (!pr?.usa_series) continue;
    const unidades = new Decimal(l.cantidad).mul(l.prod.factor);
    const series = (d.items[l.linea - 1]?.series ?? []).map(normalizarSerie).filter(Boolean);
    if (!series.length && !d.exigir) continue; // la caja (punto de venta) todavía no captura series
    if (!unidades.isInteger()) throw new ErrorNegocio(`${l.prod.nombre} lleva número de serie: la cantidad debe ser entera`);
    if (series.length !== unidades.toNumber()) throw new ErrorNegocio(`${l.prod.nombre}: indique ${unidades.toNumber()} número(s) de serie (lleva ${series.length})`);
    for (const sr of series) {
      if (sr.length < 3 || sr.length > 40) throw new ErrorNegocio(`La serie «${sr}» no es válida (3 a 40 caracteres)`);
      if (vistas.has(`${l.prod.productoId}|${sr}`)) throw new ErrorNegocio(`La serie ${sr} está repetida en la factura`);
      vistas.add(`${l.prod.productoId}|${sr}`);
    }
    const ya = await c.query<{ serie: string }>("SELECT serie FROM series_producto WHERE producto_id = $1 AND serie = ANY($2::text[]) AND devuelta_en IS NULL LIMIT 1", [l.prod.productoId, series]);
    if (ya.rowCount) throw new ErrorNegocio(`La serie ${ya.rows[0].serie} ya fue vendida`);
    await c.query(
      `INSERT INTO series_producto (id, sucursal_id, producto_id, presentacion_id, serie, venta_id, venta_item_id, cliente_id, garantia_hasta)
       SELECT gen_random_uuid(), $1, $2, $3, s, $4, $5, $6, CASE WHEN $7::int > 0 THEN (CURRENT_DATE + make_interval(months => $7::int))::date END
         FROM unnest($8::text[]) AS s`,
      [d.sucursalId, l.prod.productoId, l.prod.presentacionId, d.ventaId, d.itemIds[i], d.clienteId, pr.garantia_meses, series]);
  }
}

/** Antes de enviar una venta a caja: los productos con serie deben traer una serie por unidad (la caja no las captura) */
export async function exigirSeriesPresentes(c: Pick<PoolClient, "query">, items: { presentacionId: string; cantidad: string; series?: string[] }[]) {
  const r = await c.query<{ id: string; nombre: string; factor: string }>(
    `SELECT pr.id, p.nombre, pr.factor::text FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id WHERE pr.id = ANY($1::uuid[]) AND p.usa_series`,
    [items.map((i) => i.presentacionId)]);
  const m = new Map(r.rows.map((x) => [x.id, x]));
  for (const i of items) {
    const x = m.get(i.presentacionId);
    if (!x) continue;
    const n = new Decimal(i.cantidad).mul(x.factor);
    const dadas = (i.series ?? []).map(normalizarSerie).filter(Boolean);
    if (!n.isInteger() || dadas.length !== n.toNumber()) throw new ErrorNegocio(`${x.nombre}: indique ${n.toString()} número(s) de serie (lleva ${dadas.length})`);
  }
}

export async function registrarVenta(
  c: PoolClient,
  cajaId: string,
  body: VentaInput,
  opciones: {
    pagarTodoCon?: VentaInput["pagos"][number]["formaPago"];
    /** Venta hecha en la caja sin servidor: su hora real, su e-NCF apartado y su turno */
    contingencia?: { creadoEn: string; encf: string; rangoId: string; turnoId: string };
    /** Facturación de administración: los productos con número de serie deben traer una serie por unidad */
    exigirSeries?: boolean;
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
  const aprobacion = descManual.gt(0) ? verificarAutorizacion(body.autorizacionDescuento, ["venta.descuento", "venta.precio"], cajaId) : null;

  const q = await cotizar(c, ctx, body, true, !!cont);
  if (["E31", "B01", "B14", "B15"].includes(body.tipoDocumento) && !(q.cliente && ["RNC", "CEDULA"].includes(q.cliente.tipo_documento))) {
    throw new ErrorNegocio("La factura de crédito fiscal requiere un cliente con RNC o cédula");
  }

  // Propina legal: solo en negocios con cuentas (no TIENDA); nunca sin servidor; no mayor que el consumo
  const propina = new Decimal(body.propinaLegal ?? 0).toDecimalPlaces(2);
  if (propina.gt(0)) {
    if (cont) throw new ErrorNegocio("Sin servidor no se cobra propina legal");
    const tn = (await c.query<{ t: string }>("SELECT tipo_negocio AS t FROM empresas WHERE id = $1", [ctx.empresaId])).rows[0]?.t;
    if (!esNegocioDeMesas(tn)) throw new ErrorNegocio("La propina legal solo aplica a restaurantes, bares y discotecas", 400);
    if (propina.gt(q.totales.subtotal)) throw new ErrorNegocio("La propina no puede ser mayor que el consumo", 400);
  }
  const aCobrar = new Decimal(q.totales.total).plus(propina);

  if (opciones.pagarTodoCon) body = { ...body, pagos: [{ formaPago: opciones.pagarTodoCon, monto: aCobrar.toFixed(2) }] };
  let pagos;
  try {
    pagos = validarPagos(aCobrar, body.pagos);
  } catch (e) {
    throw new ErrorNegocio((e as Error).message);
  }

  const credito = pagos.filter((p) => p.formaPago === "CREDITO").reduce((a, p) => a.plus(p.monto), new Decimal(0));
  let aprobCredito: ReturnType<typeof verificarAutorizacion> | null = null;
  if (credito.gt(0)) {
    if (!body.clienteId) throw new ErrorNegocio("La venta a crédito requiere un cliente");
    // Vender a crédito: permiso del cajero (aprobación propia) o PIN de un supervisor
    if (!body.autorizacionCredito) throw new ErrorNegocio("La venta a crédito necesita el permiso del cajero o la aprobación de un supervisor", 403);
    aprobCredito = verificarAutorizacion(body.autorizacionCredito, "venta.credito", cajaId);
    const s = await c.query<{ limite: string; saldo: string }>(
      `SELECT c.limite_credito AS limite, COALESCE((SELECT SUM(m.monto) FROM cxc_movimientos m WHERE m.cliente_id = c.id), 0) AS saldo
         FROM clientes c WHERE c.id = $1`,
      [body.clienteId],
    );
    // Límite 0 = sin límite de crédito
    const disponible = new Decimal(s.rows[0].limite).gt(0) ? new Decimal(s.rows[0].limite).minus(s.rows[0].saldo) : null;
    if (disponible && credito.gt(disponible)) throw new ErrorNegocio(`Crédito insuficiente: disponible RD$${disponible.toFixed(2)}`);
  }

  const ventaId = body.ventaId ?? uuidv7();
  // NCF serie B (B01/B02) o número interno (factura sin comprobante): se asigna ANTES de guardar la
  // venta, en esta misma transacción (las ventas no se modifican después de registradas).
  const numeroDocumento = ["B01", "B02", "B14", "B15", "B16", "SIN"].includes(body.tipoDocumento)
    ? await asignarNumeroNoElectronico(c, ctx.sucursalId, body.tipoDocumento as "B01" | "B02" | "B14" | "B15" | "B16" | "SIN") : null;
  const v = await c.query<{ numero: string }>(
    `INSERT INTO ventas (id, sucursal_id, caja_id, turno_id, usuario_id, cliente_id, numero_interno,
                         tipo_documento, condicion, subtotal, descuento, itbis, isc, total, creado_en, contingencia, notas, numero_documento, propina_legal)
     VALUES ($1,$2,$3,$4,$5,$6,
             (SELECT COALESCE(MAX(numero_interno), 0) + 1 FROM ventas WHERE caja_id = $3),
             $7,$8,$9,$10,$11,0,$12, COALESCE($13::timestamptz, now()), $14, $15, $16, $17)
     RETURNING numero_interno AS numero`,
    [ventaId, ctx.sucursalId, cajaId, turnoId, body.usuarioId, body.clienteId ?? null,
     body.tipoDocumento, credito.gt(0) ? "CREDITO" : "CONTADO",
     q.totales.subtotal, q.totales.descuento, q.totales.itbis, q.totales.total, cont?.creadoEn ?? null, !!cont, body.notas || null,
     numeroDocumento, propina.toFixed(2)],
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
  const itemIds = L.map(() => uuidv7());
  await c.query(
    `INSERT INTO venta_items (id, venta_id, linea, presentacion_id, descripcion, cantidad, factor, precio_unitario,
                              descuento, tasa_itbis, itbis, total, costo_unitario, oferta_id, descuento_oferta,
                              descuento_cupon, lista_precio_id, descuento_manual, unidades_oferta, descuento_nivel)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::smallint[], $4::uuid[], $5::text[], $6::numeric[], $7::numeric[],
                          $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[], $13::numeric[],
                          $14::uuid[], $15::numeric[], $16::numeric[], $17::uuid[], $18::numeric[], $19::numeric[], $20::numeric[])`,
    [itemIds, L.map(() => ventaId), L.map((l) => l.linea), L.map((l) => l.prod.presentacionId),
     L.map((l) => `${l.prod.nombre} ${l.prod.presentacion}`.trim()), L.map((l) => l.cantidad), L.map((l) => l.prod.factor),
     L.map((l) => l.prod.precio), L.map((l) => l.calc.descuento), L.map((l) => l.prod.tasaItbis), L.map((l) => l.calc.itbis),
     L.map((l) => l.calc.total), L.map((l) => l.prod.costoPromedio), L.map((l) => l.oferta?.ofertaId ?? null),
     L.map((l) => l.oferta?.descuento ?? "0"), L.map((l) => l.descuentoCupon), L.map((l) => l.prod.listaPrecioId),
     L.map((l) => l.descuentoManual),
     L.map((l) => (l.oferta ? new Decimal(l.oferta.unidades).mul(l.prod.factor).toString() : "0")),
     L.map((l) => l.descuentoNivel)],
  );

  await guardarSeries(c, { ventaId, sucursalId: ctx.sucursalId, clienteId: body.clienteId ?? null, L, itemIds, items: body.items, exigir: !!opciones.exigirSeries });

  // Entradas con consumos incluidos: un vale por unidad (no aplica a ventas hechas sin servidor)
  const vales = cont ? [] : await crearVales(c, ctx.sucursalId, ventaId, L.map((l) => ({ productoId: l.prod.productoId, descripcion: l.prod.nombre, cantidad: l.cantidad })));

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
    // Primero sale lo que vence antes (lotes); lo demás sale sin lote
    const KL = await repartirPorLotes(c, ctx.almacenId, K);
    await c.query(
      `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario,
                                       documento_tipo, documento_id, usuario_id, creado_en, lote_id)
       SELECT id, $2, $3, producto_id, 'VENTA', cantidad, 0, 'venta', $4, $5, COALESCE($8::timestamptz, now()), lote_id
         FROM unnest($1::uuid[], $6::uuid[], $7::numeric[], $9::uuid[]) AS t(id, producto_id, cantidad, lote_id)`,
      [KL.map(() => uuidv7()), ctx.sucursalId, ctx.almacenId, ventaId, body.usuarioId,
       KL.map((k) => k.productoId), KL.map((k) => k.cantidad), cont?.creadoEn ?? null, KL.map((k) => k.loteId)],
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

  if (aprobCredito) {
    await c.query(
      `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
       VALUES ($1,$2,$3,$4,'venta.credito','venta',$5,$6)`,
      [uuidv7(), ctx.sucursalId, body.usuarioId, aprobCredito.supervisorId, ventaId, JSON.stringify({ monto: credito.toFixed(2), cliente: body.clienteId })],
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
  const fiscal = body.tipoDocumento === "E31" || body.tipoDocumento === "E32"
    ? await emitirEcfVenta(c, ventaId, cont ? { encf: cont.encf, rangoId: cont.rangoId, fecha: cont.creadoEn } : undefined)
    : null;

  // Documento completo para la nube
  await c.query(
    `INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
     SELECT 'ventas', v.id, 'INSERT', jsonb_build_object(
              'venta', to_jsonb(v),
              'items', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.linea) FROM venta_items i WHERE i.venta_id = v.id),
              'pagos', (SELECT jsonb_agg(to_jsonb(p)) FROM venta_pagos p WHERE p.venta_id = v.id),
              'kardex', (SELECT jsonb_agg(to_jsonb(k)) FROM kardex_movimientos k WHERE k.documento_tipo = 'venta' AND k.documento_id = v.id),
              'cxc', (SELECT jsonb_agg(to_jsonb(m)) FROM cxc_movimientos m WHERE m.venta_id = v.id),
              'series', (SELECT jsonb_agg(to_jsonb(sp)) FROM series_producto sp WHERE sp.venta_id = v.id),
              'cupon', (SELECT to_jsonb(u) FROM cupon_usos u WHERE u.venta_id = v.id),
              'ecf', (SELECT to_jsonb(d) - 'xml' - 'xml_envio' FROM ecf_documentos d WHERE d.venta_id = v.id),
              'auditoria', (SELECT jsonb_agg(to_jsonb(a)) FROM auditoria a WHERE a.entidad = 'venta' AND a.entidad_id = v.id))
       FROM ventas v WHERE v.id = $1`,
    [ventaId],
  );

  return {
    id: ventaId,
    numero,
    numeroDocumento: numeroDocumento ?? (fiscal as { encf?: string } | null)?.encf ?? null,
    tipoDocumento: body.tipoDocumento,
    ...resumen(q),
    propinaLegal: propina.toFixed(2),
    vales,
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
    await exigirLicenciaParaVender(); // licencia vencida (pasada la gracia): solo consulta
    if (body.tipoDocumento === "SIN") await exigirSinComprobante(cajaId);
    const r = await enTransaccion((c) => registrarVenta(c, cajaId, body));
    rep.code(201);
    return r;
  });
}
