/**
 * División de cuentas (restaurantes, bares, discotecas). Todo en CENTAVOS enteros: la suma de las partes siempre
 * es exactamente el total, sin centavos perdidos por redondeo.
 *   - Antes de ordenar: cada línea se carga a un «asiento» (persona) y la cuenta ya sale dividida.
 *   - Después de ordenar: partes iguales, por producto, por monto o mixto.
 */
export class ErrorDivision extends Error {}

const entero = (n: number, que: string) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new ErrorDivision(`${que} debe ser un monto en centavos válido`);
  return n;
};

/**
 * Reparte `total` entre varias partes según sus `pesos` (método del mayor resto): la suma es exacta.
 * Con pesos iguales es la división en partes iguales; con las bases de cada parte, el reparto proporcional (propina).
 */
export function repartirProporcional(total: number, pesos: number[]): number[] {
  entero(total, "El total");
  if (!pesos.length) throw new ErrorDivision("Debe haber al menos una parte");
  pesos.forEach((p) => entero(p, "El peso"));
  const suma = pesos.reduce((a, b) => a + b, 0);
  if (suma === 0) return repartirProporcional(total, pesos.map(() => 1));
  const base = pesos.map((p) => Math.floor((total * p) / suma));
  let resto = total - base.reduce((a, b) => a + b, 0);
  const orden = pesos
    .map((p, i) => ({ i, r: (total * p) % suma }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of orden) { if (resto <= 0) break; base[i]!++; resto--; }
  return base;
}

/** Partes iguales entre `n` personas. */
export const repartirIgual = (total: number, n: number): number[] => {
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new ErrorDivision("El número de partes debe estar entre 1 y 100");
  return repartirProporcional(total, Array.from({ length: n }, () => 1));
};

/** Cada parte con el monto que se le indicó: tienen que sumar exactamente el total. */
export function dividirPorMontos(total: number, montos: number[]): number[] {
  entero(total, "El total");
  if (!montos.length) throw new ErrorDivision("Debe haber al menos una parte");
  montos.forEach((m) => entero(m, "El monto"));
  const suma = montos.reduce((a, b) => a + b, 0);
  if (suma !== total) throw new ErrorDivision(`Los montos suman ${(suma / 100).toFixed(2)} y la cuenta es ${(total / 100).toFixed(2)}`);
  return [...montos];
}

export interface LineaDivision { id: string; total: number }

/**
 * Por producto: cada línea se asigna a una parte (0…n-1). Todas las líneas deben quedar asignadas.
 * Si `compartidas` trae ids de líneas, esas se reparten en partes iguales entre las partes indicadas (p. ej. una botella entre 3).
 */
export function dividirPorLineas(
  lineas: LineaDivision[],
  partes: number,
  asignacion: Record<string, number>,
  compartidas: Record<string, number[]> = {},
): number[] {
  if (!Number.isInteger(partes) || partes < 1 || partes > 100) throw new ErrorDivision("El número de partes debe estar entre 1 y 100");
  const salida = Array.from({ length: partes }, () => 0);
  for (const l of lineas) {
    entero(l.total, "El total de la línea");
    const comp = compartidas[l.id];
    if (comp?.length) {
      const unicas = [...new Set(comp)];
      if (unicas.some((p) => !Number.isInteger(p) || p < 0 || p >= partes)) throw new ErrorDivision("Una línea compartida apunta a una parte que no existe");
      const reparto = repartirIgual(l.total, unicas.length);
      unicas.forEach((p, k) => { salida[p]! += reparto[k]!; });
      continue;
    }
    const p = asignacion[l.id];
    if (p === undefined) throw new ErrorDivision("Hay productos sin asignar a una persona");
    if (!Number.isInteger(p) || p < 0 || p >= partes) throw new ErrorDivision("Un producto apunta a una persona que no existe");
    salida[p]! += l.total;
  }
  return salida;
}

/** Antes de ordenar: lo cargado a cada asiento; lo que no tiene dueño (de toda la mesa) se reparte en partes iguales entre los asientos. */
export function dividirPorAsientos(lineas: { total: number; asiento: number | null }[], asientos: number): number[] {
  if (!Number.isInteger(asientos) || asientos < 1 || asientos > 100) throw new ErrorDivision("El número de asientos debe estar entre 1 y 100");
  const salida = Array.from({ length: asientos }, () => 0);
  let comun = 0;
  for (const l of lineas) {
    entero(l.total, "El total de la línea");
    if (l.asiento === null) comun += l.total;
    else if (Number.isInteger(l.asiento) && l.asiento >= 0 && l.asiento < asientos) salida[l.asiento]! += l.total;
    else throw new ErrorDivision("Una línea apunta a un asiento que no existe");
  }
  if (comun) repartirIgual(comun, asientos).forEach((m, i) => { salida[i]! += m; });
  return salida;
}

/** Propina legal (10 %) de cada parte, calculada sobre su base y repartida para que la suma sea la propina de la cuenta completa. */
export function propinaPorParte(bases: number[], tasaPorMil = 100): number[] {
  const totalBase = bases.reduce((a, b) => a + entero(b, "La base"), 0);
  const propinaTotal = Math.round((totalBase * tasaPorMil) / 1000);
  return repartirProporcional(propinaTotal, bases);
}
