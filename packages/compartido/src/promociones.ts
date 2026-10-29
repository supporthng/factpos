import { Decimal } from "decimal.js";

/**
 * Motor de ofertas y cupones.
 *
 * Reglas:
 *  1. A cada línea se le aplica la MEJOR oferta vigente (no se acumulan ofertas).
 *  2. El cupón se aplica después, sobre el total de las líneas permitidas, y su
 *     descuento se reparte (prorratea) entre esas líneas. Así el ITBIS de cada
 *     línea queda calculado sobre el precio realmente cobrado, como exige la DGII.
 *  3. Todo es función pura: la caja lo usa para mostrar el total al instante y
 *     el servidor lo vuelve a calcular para guardar la venta.
 */

export type TipoOferta = "PORCENTAJE" | "PRECIO_ESPECIAL" | "LLEVA_PAGA" | "POR_VOLUMEN";

export interface Oferta {
  id: string;
  nombre: string;
  tipo: TipoOferta;
  valor: string | null;
  lleva: number | null;
  paga: number | null;
  cantidadMinima: string;
  iniciaEn: string | Date;
  terminaEn: string | Date;
  diasSemana: number[] | null;   // 0 = domingo
  horaDesde: string | null;      // "18:00:00"
  horaHasta: string | null;
  prioridad: number;
  /**
   * Tope de unidades: cuántas quedan por vender en oferta (en unidades base).
   * null o ausente = sin tope. Al acabarse, el resto se cobra a precio normal.
   */
  restantes?: string | null;
}

export interface LineaParaOferta {
  cantidad: Decimal.Value;
  precioUnitario: Decimal.Value;
  /** Unidades base por cada unidad de la línea (caja x12 = 12). Para el tope. */
  factor?: Decimal.Value;
}

export interface ResultadoOferta {
  ofertaId: string;
  nombre: string;
  descuento: string;      // monto total de descuento sobre la línea
  precioEfectivo: string; // precio unitario resultante, informativo
  /** Unidades de la línea que llevaron la oferta (todas, salvo que se acabe el tope) */
  unidades: string;
  /** El tope no alcanzó para toda la línea: el resto va a precio normal */
  agotada: boolean;
}

const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const r2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Hora local de Santo Domingo (UTC-4, sin horario de verano). */
export function horaLocalRD(fecha: Date): { dia: number; hhmmss: string } {
  const local = new Date(fecha.getTime() - 4 * 3600 * 1000);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  const ss = String(local.getUTCSeconds()).padStart(2, "0");
  return { dia: local.getUTCDay(), hhmmss: `${hh}:${mm}:${ss}` };
}

export function ofertaVigente(o: Oferta, ahora: Date): boolean {
  if (ahora < new Date(o.iniciaEn) || ahora >= new Date(o.terminaEn)) return false;
  const { dia, hhmmss } = horaLocalRD(ahora);
  if (o.diasSemana && o.diasSemana.length && !o.diasSemana.includes(dia)) return false;
  if (o.horaDesde && o.horaHasta) {
    const dentro = o.horaDesde <= o.horaHasta
      ? hhmmss >= o.horaDesde && hhmmss < o.horaHasta
      : hhmmss >= o.horaDesde || hhmmss < o.horaHasta; // cruza medianoche (ej. 22:00–02:00)
    if (!dentro) return false;
  }
  return true;
}

/**
 * Unidades de la línea que pueden llevar la oferta según el tope.
 * El tope está en unidades base; una caja x12 consume 12.
 */
export function unidadesConOferta(o: Oferta, l: LineaParaOferta): Decimal {
  const cant = D(l.cantidad);
  if (o.restantes === null || o.restantes === undefined) return cant;
  const factor = D(l.factor ?? 1);
  const quedan = Decimal.max(D(o.restantes), 0).div(factor);
  // Cantidades enteras (no pesables): solo unidades completas
  const enteras = cant.isInteger() ? quedan.floor() : quedan;
  return Decimal.min(cant, enteras);
}

/** Descuento que una oferta le da a una línea (0 si no aplica). */
export function descuentoOferta(o: Oferta, l: LineaParaOferta): Decimal {
  const cantLinea = D(l.cantidad);
  const precio = D(l.precioUnitario);
  if (cantLinea.lt(o.cantidadMinima)) return new Decimal(0);
  // Con tope, solo las unidades que quedan llevan la oferta
  const cant = unidadesConOferta(o, l);
  if (cant.lte(0)) return new Decimal(0);
  const bruto = r2(cant.mul(precio));

  let desc: Decimal;
  switch (o.tipo) {
    case "PORCENTAJE":
      desc = r2(bruto.mul(D(o.valor)).div(100));
      break;
    case "PRECIO_ESPECIAL":
    case "POR_VOLUMEN": {
      const especial = D(o.valor);
      desc = especial.lt(precio) ? r2(cant.mul(precio.minus(especial))) : new Decimal(0);
      break;
    }
    case "LLEVA_PAGA": {
      // 3x2 con 7 unidades: 2 grupos completos → 2 unidades gratis
      const lleva = o.lleva ?? 0;
      const paga = o.paga ?? 0;
      if (lleva <= paga || paga < 1) return new Decimal(0);
      const grupos = cant.div(lleva).floor();
      desc = r2(grupos.mul(lleva - paga).mul(precio));
      break;
    }
  }
  return Decimal.min(Decimal.max(desc, 0), bruto);
}

/** Elige la oferta que más descuento da; en empate, la de mayor prioridad. */
export function mejorOferta(ofertas: Oferta[], l: LineaParaOferta, ahora = new Date()): ResultadoOferta | null {
  let mejor: { o: Oferta; d: Decimal } | null = null;
  for (const o of ofertas) {
    if (!ofertaVigente(o, ahora)) continue;
    const d = descuentoOferta(o, l);
    if (d.lte(0)) continue;
    if (!mejor || d.gt(mejor.d) || (d.eq(mejor.d) && o.prioridad > mejor.o.prioridad)) mejor = { o, d };
  }
  if (!mejor) return null;
  const cant = D(l.cantidad);
  const neto = D(l.precioUnitario).mul(cant).minus(mejor.d);
  const unidades = unidadesConOferta(mejor.o, l);
  return {
    ofertaId: mejor.o.id,
    nombre: mejor.o.nombre,
    descuento: mejor.d.toFixed(2),
    precioEfectivo: r2(neto.div(cant)).toFixed(2),
    unidades: unidades.toString(),
    agotada: unidades.lt(cant),
  };
}

// ---------------------------------------------------------------------
// Cupones
// ---------------------------------------------------------------------
export interface Cupon {
  id: string;
  codigo: string;
  tipo: "PORCENTAJE" | "MONTO";
  valor: string;
  compraMinima: string;
  topeDescuento: string | null;
  acumulableConOfertas: boolean;
}

/**
 * Calcula el descuento del cupón sobre las líneas que lo admiten y lo reparte.
 * `netos` = importe de cada línea después de la oferta.
 * `conOferta` = si la línea ya tiene oferta (para cupones no acumulables).
 * Devuelve el descuento por línea, en el mismo orden.
 */
export function aplicarCupon(cupon: Cupon, netos: Decimal.Value[], conOferta: boolean[]): { total: string; porLinea: string[] } {
  const elegibles = netos.map((n, i) => (cupon.acumulableConOfertas || !conOferta[i] ? D(n) : new Decimal(0)));
  const base = elegibles.reduce((a, n) => a.plus(n), new Decimal(0));
  const totalCompra = netos.reduce<Decimal>((a, n) => a.plus(D(n)), new Decimal(0));

  if (totalCompra.lt(cupon.compraMinima)) {
    throw new Error(`El cupón requiere una compra mínima de RD$${D(cupon.compraMinima).toFixed(2)}`);
  }
  if (base.lte(0)) throw new Error("El cupón no aplica a productos que ya están en oferta");

  let desc = cupon.tipo === "PORCENTAJE" ? r2(base.mul(cupon.valor).div(100)) : D(cupon.valor);
  if (cupon.topeDescuento) desc = Decimal.min(desc, D(cupon.topeDescuento));
  desc = r2(Decimal.min(desc, base));

  return { total: desc.toFixed(2), porLinea: prorratear(desc, elegibles) };
}

/**
 * Reparte un monto entre líneas en proporción a su importe. La última línea
 * con importe recibe el residuo, así la suma cuadra al centavo.
 */
export function prorratear(monto: Decimal.Value, importes: Decimal.Value[]): string[] {
  const m = D(monto);
  const vals = importes.map(D);
  const total = vals.reduce((a, v) => a.plus(v), new Decimal(0));
  if (total.lte(0) || m.lte(0)) return vals.map(() => "0.00");

  const ultima = vals.map((v) => v.gt(0)).lastIndexOf(true);
  let asignado = new Decimal(0);
  return vals.map((v, i) => {
    if (v.lte(0)) return "0.00";
    const parte = i === ultima ? m.minus(asignado) : r2(m.mul(v).div(total));
    asignado = asignado.plus(parte);
    return parte.toFixed(2);
  });
}
