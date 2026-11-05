import { Decimal } from "decimal.js";

/**
 * Reparto de un abono entre las facturas a crédito de un cliente, sin base de datos (así se prueba solo).
 * `facturas` llega ya ordenada de la más antigua a la más nueva.
 */
export interface FacturaPendiente { ventaId: string; pendiente: Decimal.Value }
export interface ParteAbono { ventaId: string | null; monto: Decimal }

/** Abono «a la cuenta»: paga primero la factura más antigua y el sobrante pasa a la siguiente; lo que sobre de todas queda sin factura. */
export function repartirACuenta(facturas: FacturaPendiente[], monto: Decimal.Value): ParteAbono[] {
  const partes: ParteAbono[] = [];
  let resto = new Decimal(monto);
  for (const f of facturas) {
    if (resto.lte(0)) break;
    const pendiente = new Decimal(f.pendiente);
    if (pendiente.lte(0)) continue;
    const parte = Decimal.min(resto, pendiente);
    partes.push({ ventaId: f.ventaId, monto: parte });
    resto = resto.minus(parte);
  }
  if (resto.gt(0)) partes.push({ ventaId: null, monto: resto });
  return partes;
}

/** Abono a una sola factura: devuelve el mensaje de error si no se puede, o null si está bien. */
export function errorPagoAFactura(pendiente: Decimal.Value, monto: Decimal.Value): string | null {
  const p = new Decimal(pendiente);
  if (p.lte(0)) return "Esa factura ya está pagada";
  if (new Decimal(monto).gt(p)) return `La factura debe ${p.toFixed(2)}: el pago no puede ser mayor`;
  return null;
}
