import { Decimal } from "decimal.js";

/** Cálculo de planes de cuotas (interés fijo sobre el monto financiado) y estado de cada cuota. Sin base de datos: se prueba aparte. */
export type Frecuencia = "SEMANAL" | "QUINCENAL" | "MENSUAL";
const dec = (v: Decimal.Value) => new Decimal(v);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Suma «n» períodos a una fecha AAAA-MM-DD (el mes se ajusta al último día: 31 ene + 1 mes = 28/29 feb) */
export function sumarPeriodos(fecha: string, frecuencia: Frecuencia, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number) as [number, number, number];
  if (frecuencia === "MENSUAL") {
    const total = (m - 1) + n, ny = y + Math.floor(total / 12), nm = ((total % 12) + 12) % 12;
    const ultimo = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ny, nm, Math.min(d, ultimo))).toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(y, m - 1, d + n * (frecuencia === "SEMANAL" ? 7 : 15))).toISOString().slice(0, 10);
}

export interface CuotaPlan { numero: number; vence: string; monto: string }
/** Calendario: interés = capital × % (fijo), repartido en cuotas iguales; el centavo que sobra va en la última. La primera vence un período después de «desde». */
export function armarCuotas(p: { capital: Decimal.Value; interesPct: Decimal.Value; cuotas: number; frecuencia: Frecuencia; desde: string; primera?: string }) {
  const capital = r2(dec(p.capital));
  const interes = r2(capital.mul(dec(p.interesPct)).div(100));
  const total = capital.plus(interes);
  const base = total.div(p.cuotas).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const cuotas: CuotaPlan[] = [];
  for (let i = 1; i <= p.cuotas; i++) {
    const monto = i === p.cuotas ? total.minus(base.mul(p.cuotas - 1)) : base;
    cuotas.push({ numero: i, vence: p.primera ? sumarPeriodos(p.primera, p.frecuencia, i - 1) : sumarPeriodos(p.desde, p.frecuencia, i), monto: monto.toFixed(2) });
  }
  return { capital: capital.toFixed(2), interes: interes.toFixed(2), total: total.toFixed(2), cuotas };
}

export interface CuotaEstado { numero: number; vence: string; monto: string; pagado: string; pendiente: string; estado: "PAGADA" | "PARCIAL" | "VENCIDA" | "PENDIENTE"; diasAtraso: number; moraDevengada: string; moraCobrada: string; moraPorCobrar: string }
const dias = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/**
 * Aplica lo pagado a las cuotas por orden y calcula la mora de lo vencido:
 * mora diaria = pendiente × (% mensual ÷ 30) por cada día pasado el vencimiento + días de gracia.
 */
export function estadoCuotas(cuotas: (CuotaPlan & { moraCobrada?: string })[], pagado: Decimal.Value, hoy: string, moraPct: Decimal.Value, diasGracia: number): CuotaEstado[] {
  let resto = dec(pagado).lt(0) ? dec(0) : dec(pagado);
  return cuotas.map((c) => {
    const monto = dec(c.monto);
    const aplicado = Decimal.min(resto, monto);
    resto = resto.minus(aplicado);
    const pendiente = monto.minus(aplicado);
    const atraso = pendiente.gt(0) ? Math.max(0, dias(c.vence, hoy) - diasGracia) : 0;
    const devengada = atraso > 0 ? r2(pendiente.mul(dec(moraPct)).div(100).div(30).mul(atraso)) : dec(0);
    const cobrada = dec(c.moraCobrada ?? 0);
    const estado = pendiente.isZero() ? "PAGADA" : atraso > 0 ? "VENCIDA" : aplicado.gt(0) ? "PARCIAL" : "PENDIENTE";
    return {
      numero: c.numero, vence: c.vence, monto: monto.toFixed(2), pagado: aplicado.toFixed(2), pendiente: pendiente.toFixed(2), estado, diasAtraso: atraso,
      moraDevengada: devengada.toFixed(2), moraCobrada: cobrada.toFixed(2), moraPorCobrar: Decimal.max(0, devengada.minus(cobrada)).toFixed(2),
    };
  });
}
