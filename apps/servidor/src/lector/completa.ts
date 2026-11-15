/**
 * Comprobación de que la IA leyó TODAS las líneas de la factura: se compara la suma de lo leído con el subtotal
 * (o el total) impreso. Si falta bastante, el portal hace una segunda pasada pidiendo solo las líneas que faltan.
 */
type Linea = { descripcion?: string; codigo?: string | null; cantidad?: number; precioUnitario?: number; importe?: number | null; netoSinItbis?: number | null; descuento?: number | null; impuestoSelectivo?: number | null };
type Factura = { subtotal?: number | null; itbis?: number | null; total?: number | null; items?: Linea[]; [k: string]: unknown };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Valor sin ITBIS de una línea: lo que dijo la IA, o importe, o cantidad × precio − descuento */
export function valorLinea(l: Linea): number {
  if (num(l.netoSinItbis) > 0) return num(l.netoSinItbis);
  if (num(l.importe) > 0) return num(l.importe);
  return Math.max(0, num(l.cantidad) * num(l.precioUnitario) - num(l.descuento) + num(l.impuestoSelectivo));
}

/** Cuánto (sin ITBIS) parece faltar por leer; 0 si cuadra o si la factura no trae cifras para comparar */
export function montoFaltante(f: Factura): number {
  const items = f.items ?? [];
  const leido = items.reduce((a, l) => a + valorLinea(l), 0);
  const referencia = num(f.subtotal) > 0 ? num(f.subtotal) : num(f.total) > 0 ? (num(f.itbis) > 0 ? num(f.total) - num(f.itbis) : num(f.total) / 1.18) : 0;
  if (!referencia || !leido) return 0;
  const falta = referencia - leido;
  // Tolerancia: 3 % o RD$ 50 (redondeos, descuentos al pie, selectivo)
  return falta > Math.max(referencia * 0.03, 50) ? Math.round(falta * 100) / 100 : 0;
}

/** Texto extra para la segunda pasada */
export function pistaFaltantes(f: Factura): string {
  const ya = (f.items ?? []).map((l, i) => `${i + 1}. ${(l.descripcion ?? "").slice(0, 60)}`).join(" | ");
  return ` ESTA ES UNA SEGUNDA PASADA: ya se leyeron estas líneas (${ya}). Devuelve en «items» SOLAMENTE las líneas de la tabla de productos que NO están en esa lista (suelen ser las últimas de la página); no repitas ninguna. Si no falta ninguna, devuelve items vacío.`;
}

/** Agrega las líneas nuevas (no repetidas por código+descripción+cantidad) a la factura ya leída */
export function unirFaltantes(f: Factura, extra: Factura): { factura: Factura; agregadas: number } {
  const clave = (l: Linea) => `${(l.codigo ?? "").trim()}|${(l.descripcion ?? "").replace(/\s+/g, " ").trim().toUpperCase()}|${num(l.cantidad)}`;
  const vistas = new Set((f.items ?? []).map(clave));
  const nuevas = (extra.items ?? []).filter((l) => l.descripcion && !vistas.has(clave(l)));
  return { factura: { ...f, items: [...(f.items ?? []), ...nuevas] }, agregadas: nuevas.length };
}
