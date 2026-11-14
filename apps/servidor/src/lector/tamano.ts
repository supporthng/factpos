/**
 * Tamaño de un producto leído del nombre («DORITOS 55OZ», «85G», «1.5 L») normalizado a una unidad común
 * (gramos para peso, mililitros para volumen), para comparar «55 OZ» con «1559 G» y detectar «55OZ» que en realidad es «55G».
 */
export interface Tamano { numero: number; unidad: string; tipo: "peso" | "volumen"; base: number }

const A_BASE: Record<string, { tipo: "peso" | "volumen"; f: number }> = {
  G: { tipo: "peso", f: 1 }, GR: { tipo: "peso", f: 1 }, GRS: { tipo: "peso", f: 1 }, GM: { tipo: "peso", f: 1 },
  KG: { tipo: "peso", f: 1000 }, OZ: { tipo: "peso", f: 28.3495 }, LB: { tipo: "peso", f: 453.592 }, LBS: { tipo: "peso", f: 453.592 },
  ML: { tipo: "volumen", f: 1 }, CL: { tipo: "volumen", f: 10 }, L: { tipo: "volumen", f: 1000 }, LT: { tipo: "volumen", f: 1000 }, LTS: { tipo: "volumen", f: 1000 },
};
const TAMANO = /(?<![\d.])(\d+(?:\.\d+)?)\s?(OZ|GRS|GR|GM|G|KG|LBS|LB|ML|CL|LTS|LT|L)(?![A-Za-z])/gi;

/** El último tamaño que aparece en el texto (el de la presentación suele ir al final) */
export function tamanoDe(texto: string): Tamano | null {
  let ultimo: Tamano | null = null;
  for (const m of texto.matchAll(TAMANO)) {
    const unidad = m[2]!.toUpperCase(), c = A_BASE[unidad];
    if (c) ultimo = { numero: Number(m[1]), unidad, tipo: c.tipo, base: Number(m[1]) * c.f };
  }
  return ultimo;
}

export type Relacion = "igual" | "distinto" | "confundible" | "n/a";

/** igual: mismo tamaño tras convertir · confundible: mismo número con otra unidad (55OZ vs 55G) · distinto: otro tamaño · n/a: no se puede comparar */
export function compararTamano(a: Tamano | null, b: Tamano | null): Relacion {
  if (!a || !b || a.tipo !== b.tipo) return "n/a";
  if (Math.abs(a.base - b.base) / Math.max(a.base, b.base) <= 0.03) return "igual";
  if (a.numero === b.numero && a.unidad !== b.unidad) return "confundible";
  return "distinto";
}

/** Texto sin los tamaños, para comparar solo el nombre */
export const sinTamano = (t: string) => t.replace(TAMANO, " ").replace(/\s+/g, " ").trim();
