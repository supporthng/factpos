/**
 * La columna de unidad de medida de la factura dice «UND», «UN», «PZA»…: la cantidad ya viene en unidades sueltas.
 * El «X30X1» del nombre solo describe cuántas trae una caja; NO se multiplica (12 UND a 55.11 son 12 fundas, no 360).
 * La IA a veces mezcla la cantidad con la unidad («2 UND», «0/15 UND»): para UND y similares se acepta un número delante.
 */
const UNIDAD_SUELTA = /^\s*(?:(?:[\d.,/]+\s*)?(?:und|un|uds?|unid|unidad(?:es)?)|u|pza|pzas|pz|pieza(?:s)?|bot|botella(?:s)?|lata(?:s)?)\s*\.?\s*$/i;
export const esUnidadSuelta = (unidad: string | null | undefined) => UNIDAD_SUELTA.test(unidad ?? "");

/**
 * Si la IA leyó mal la cantidad, el precio impreso la delata: importe sin ITBIS ÷ precio unitario debe dar un entero.
 * Solo en unidades sueltas y sin descuento ni selectivo (así el cociente es exacto). Devuelve la cantidad corregida o null.
 */
export function cantidadSegunPrecio(cantidad: number, precio: number, neto: number | null, descuento?: number | null, selectivo?: number | null): number | null {
  if (!(precio > 0) || !neto || neto <= 0 || (descuento ?? 0) > 0 || (selectivo ?? 0) > 0) return null;
  const q = neto / precio, e = Math.round(q);
  if (e < 1 || Math.abs(q - e) > 0.02 * e) return null; // no da un entero: no se toca
  return Math.abs(e - cantidad) / Math.max(cantidad, 1) > 0.05 ? e : null;
}
