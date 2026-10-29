import { Decimal } from "decimal.js";

/**
 * Cálculo de líneas y totales de venta.
 *
 * Todo el dinero se maneja con Decimal (nunca con números de punto
 * flotante) y se redondea a 2 decimales por línea, mitad hacia arriba.
 * Este mismo código lo usan la caja, el servidor local y la nube, para que
 * los tres calculen exactamente lo mismo.
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Monto = string; // siempre "123.45", para viajar en JSON sin perder precisión

export interface LineaEntrada {
  cantidad: Decimal.Value;          // 2, 1.235 (pesables)
  precioUnitario: Decimal.Value;    // precio de la presentación
  tasaItbis: Decimal.Value;         // 0.18, 0.16, 0
  precioIncluyeItbis: boolean;      // en el detalle casi siempre true
  descuento?: Decimal.Value;        // monto de descuento sobre la línea (con impuesto si el precio lo incluye)
}

export interface LineaCalculada {
  bruto: Monto;      // cantidad × precio
  descuento: Monto;
  base: Monto;       // monto gravable, sin ITBIS
  itbis: Monto;
  total: Monto;      // lo que paga el cliente por esta línea
}

const D = (v: Decimal.Value | undefined) => new Decimal(v ?? 0);
const r2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function calcularLinea(e: LineaEntrada): LineaCalculada {
  const cantidad = D(e.cantidad);
  const precio = D(e.precioUnitario);
  const tasa = D(e.tasaItbis);
  const descuento = r2(D(e.descuento));

  if (cantidad.lte(0)) throw new Error("La cantidad debe ser mayor que cero");
  if (precio.lt(0)) throw new Error("El precio no puede ser negativo");
  if (tasa.lt(0) || tasa.gte(1)) throw new Error("Tasa de ITBIS inválida");

  const bruto = r2(cantidad.mul(precio));
  if (descuento.lt(0) || descuento.gt(bruto)) throw new Error("Descuento inválido");
  const neto = bruto.minus(descuento);

  let base: Decimal;
  let itbis: Decimal;
  let total: Decimal;

  if (e.precioIncluyeItbis) {
    total = neto;
    base = r2(neto.div(tasa.plus(1)));
    itbis = total.minus(base); // así base + itbis = total exacto
  } else {
    base = neto;
    itbis = r2(neto.mul(tasa));
    total = base.plus(itbis);
  }

  return {
    bruto: bruto.toFixed(2),
    descuento: descuento.toFixed(2),
    base: base.toFixed(2),
    itbis: itbis.toFixed(2),
    total: total.toFixed(2),
  };
}

export interface TotalesVenta {
  subtotal: Monto;   // suma de bases
  descuento: Monto;
  itbis: Monto;
  total: Monto;
}

export function totalizar(lineas: LineaCalculada[]): TotalesVenta {
  const suma = (k: keyof LineaCalculada) =>
    lineas.reduce((acc, l) => acc.plus(l[k]), new Decimal(0)).toFixed(2);
  return {
    subtotal: suma("base"),
    descuento: suma("descuento"),
    itbis: suma("itbis"),
    total: suma("total"),
  };
}

export interface PagoEntrada {
  formaPago: "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "CREDITO" | "DELIVERY" | "OTRO";
  monto: Decimal.Value;
  recibido?: Decimal.Value; // solo efectivo
  referencia?: string;      // tarjeta: número de aprobación del voucher
}

/** Verifica que los pagos cubran el total y calcula el cambio. */
export function validarPagos<P extends PagoEntrada>(total: Decimal.Value, pagos: P[]) {
  const t = D(total);
  const pagado = pagos.reduce((acc, p) => acc.plus(D(p.monto)), new Decimal(0));
  if (!pagado.eq(t)) {
    throw new Error(`Los pagos (${pagado.toFixed(2)}) no coinciden con el total (${t.toFixed(2)})`);
  }
  return pagos.map((p) => {
    const monto = r2(D(p.monto));
    // Tarjeta: sin el número de aprobación del voucher no se factura
    if (p.formaPago === "TARJETA" && !/^[A-Za-z0-9-]{4,}$/.test((p.referencia ?? "").trim())) {
      throw new Error("Falta el número de aprobación del pago con tarjeta (el que sale en el voucher)");
    }
    if (p.formaPago === "EFECTIVO" && p.recibido !== undefined) {
      const recibido = r2(D(p.recibido));
      if (recibido.lt(monto)) throw new Error("El efectivo recibido es menor que el monto");
      return { ...p, monto: monto.toFixed(2), recibido: recibido.toFixed(2), cambio: recibido.minus(monto).toFixed(2) };
    }
    return { ...p, monto: monto.toFixed(2), recibido: undefined, cambio: undefined };
  });
}

/** Formato para pantalla y ticket: RD$1,234.50 */
export function formatoRD(v: Decimal.Value): string {
  const [ent, dec] = D(v).toFixed(2).split(".");
  const signo = ent.startsWith("-") ? "-" : "";
  const abs = ent.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${signo}RD$${abs}.${dec}`;
}
