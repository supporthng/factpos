import { Decimal } from "decimal.js";

/**
 * Aritmética del cuadre de caja, sin base de datos (así se prueba sola).
 *  - Efectivo esperado = fondo inicial + ventas en efectivo + entradas (sencillo, abonos en efectivo) − salidas (retiros, gastos).
 *  - Tarjeta y transferencia: lo vendido con esa forma + los abonos de clientes cobrados con ella (no pasan por la gaveta, pero se cuadran).
 *  - Diferencia = Σ (declarado − esperado) de las tres formas: negativa = falta dinero, positiva = sobra.
 */
export const FORMAS_CONTADAS = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"] as const;
export type FormaContada = (typeof FORMAS_CONTADAS)[number];
type Num = Decimal.Value;

export function efectivoEsperado(p: { fondoInicial: Num; ventasEfectivo: Num; entradas: Num; salidas: Num }): Decimal {
  return new Decimal(p.fondoInicial).plus(p.ventasEfectivo).plus(p.entradas).minus(p.salidas);
}

export function esperadoPorForma(p: {
  fondoInicial: Num; ventasEfectivo: Num; entradas: Num; salidas: Num;
  ventasTarjeta: Num; ventasTransferencia: Num; abonosTarjeta: Num; abonosTransferencia: Num;
}): Record<FormaContada, string> {
  return {
    EFECTIVO: efectivoEsperado(p).toFixed(2),
    TARJETA: new Decimal(p.ventasTarjeta).plus(p.abonosTarjeta).toFixed(2),
    TRANSFERENCIA: new Decimal(p.ventasTransferencia).plus(p.abonosTransferencia).toFixed(2),
  };
}

export function diferenciaCierre(declarado: Record<FormaContada, Num>, esperado: Record<FormaContada, Num>): Decimal {
  return FORMAS_CONTADAS.reduce((a, f) => a.plus(declarado[f]).minus(esperado[f]), new Decimal(0));
}

/** Efectivo contado a partir del conteo de billetes y monedas: {"2000": 3, "500": 4} → 8000. */
export function efectivoContado(conteo: Record<string, number>): Decimal {
  return Object.entries(conteo).reduce((a, [den, n]) => a.plus(new Decimal(den).mul(n)), new Decimal(0));
}
