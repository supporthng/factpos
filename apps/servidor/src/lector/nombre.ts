/**
 * Nombre limpio de un producto leído de una factura: solo el nombre y su presentación (tamaño),
 * sin el código delante ni la notación de empaque al final.
 *   «300028208-CHEETOS CORN JUMBO PUFF 9OZX12X1»  →  «CHEETOS CORN JUMBO PUFF 9OZ»
 *   «CARIBAS AJO CS 110GX30X1»                     →  «CARIBAS AJO CS 110G»
 * El empaque (cuántas unidades trae la caja) se calcula aparte con la descripción original; esto es solo para mostrar y crear productos.
 * No toca patrones «NxVOLUMEN» (6x75 CL) porque ahí el volumen sí es la presentación.
 */
const UNIDAD = "OZ|G|GR|GRS|GM|ML|L|LT|LTS|LB|LBS|KG|CL|CC|U|UND|UDS";
const EMPAQUE_FINAL = /\s*[xX]\s*[A-Za-z]?\d{1,3}\s*[xX]\s*\d{1,2}\s*$/; // …X12X1 / …XA12X1
const EMPAQUE_CORTO = new RegExp(String.raw`(\d\s?(?:${UNIDAD}))\s*[xX]\s*[A-Za-z]?\d{1,2}\s*$`, "i"); // …140OZXA1

export function nombreLimpio(descripcion: string, codigo?: string | null): string {
  let n = descripcion.replace(/\s+/g, " ").trim();
  n = n.replace(/^\d{4,}\s*[-–.:]\s*/, ""); // código delante
  const c = (codigo ?? "").trim();
  if (c && n.toUpperCase().startsWith(c.toUpperCase() + " ")) n = n.slice(c.length).trim();
  n = n.replace(EMPAQUE_FINAL, "").replace(EMPAQUE_CORTO, "$1");
  n = n.replace(/\s*[-–,]\s*$/, "").trim();
  return n || descripcion.trim();
}
