import { Decimal } from "decimal.js";
import { calcularLinea, totalizar, type LineaCalculada, type TotalesVenta } from "./impuestos.js";
import { mejorOferta, ofertaVigente, aplicarCupon, type Oferta, type Cupon, type ResultadoOferta } from "./promociones.js";

/**
 * Motor único de cotización.
 *
 * La terminal lo ejecuta con su catálogo en memoria para mostrar el total al
 * instante mientras se escanea; el servidor lo ejecuta con los datos de la
 * base al cobrar. Mismo código = mismo resultado al centavo.
 */
export interface LineaCarrito {
  cantidad: string;
  precio: string;               // precio del nivel que corresponde al cliente
  tasaItbis: string;
  precioIncluyeItbis: boolean;
  esPesable: boolean;
  nombre: string;
  ofertas: Oferta[];            // ofertas que podrían aplicar a esta línea
  descuentoManual?: string;     // reemplaza a la oferta
  factor?: string;              // unidades base por unidad de la línea (para el tope de ofertas)
}

export interface LineaCotizada {
  oferta: ResultadoOferta | null;
  descuentoManual: string;
  descuentoCupon: string;
  calc: LineaCalculada;
}

export interface Cotizacion {
  lineas: LineaCotizada[];
  totales: TotalesVenta;
  cupon: { id: string; codigo: string; total: string } | null;
  /** Ofertas con tope que se acabaron en esta venta (para avisar en la caja) */
  ofertasAgotadas: { ofertaId: string; nombre: string }[];
}

export class ErrorCarrito extends Error {}

export function cotizarCarrito(lineas: LineaCarrito[], cupon: Cupon | null = null, ahora = new Date()): Cotizacion {
  // Tope de unidades: lo que va consumiendo cada línea se descuenta para las siguientes
  const quedan = new Map<string, Decimal>();
  const agotadas = new Map<string, string>();
  const parciales = lineas.map((l) => {
    if (!l.esPesable && !Number.isInteger(Number(l.cantidad))) {
      throw new ErrorCarrito(`${l.nombre} no se vende por peso: la cantidad debe ser entera`);
    }
    const bruto = new Decimal(l.cantidad).mul(l.precio).toDecimalPlaces(2);
    const manual = new Decimal(l.descuentoManual ?? 0);
    const ofertas = l.ofertas.map((o) =>
      o.restantes === null || o.restantes === undefined ? o : { ...o, restantes: (quedan.get(o.id) ?? new Decimal(o.restantes)).toString() });
    const oferta = manual.gt(0) ? null : mejorOferta(ofertas, { cantidad: l.cantidad, precioUnitario: l.precio, factor: l.factor ?? 1 }, ahora);
    if (oferta) {
      const o = ofertas.find((x) => x.id === oferta.ofertaId)!;
      if (o.restantes !== null && o.restantes !== undefined) {
        const resto = new Decimal(o.restantes).minus(new Decimal(oferta.unidades).mul(l.factor ?? 1));
        quedan.set(o.id, resto);
        if (oferta.agotada || resto.lte(0)) agotadas.set(o.id, o.nombre);
      }
    } else if (!manual.gt(0)) {
      // Línea sin oferta porque el tope ya se había acabado
      for (const o of ofertas) if (o.restantes !== null && o.restantes !== undefined && new Decimal(o.restantes).lte(0) && ofertaVigente(o, ahora)) agotadas.set(o.id, o.nombre);
    }
    const neto = bruto.minus(manual).minus(oferta?.descuento ?? 0);
    if (neto.lt(0)) throw new ErrorCarrito(`El descuento de ${l.nombre} supera el importe`);
    return { l, oferta, manual, neto };
  });

  let porLinea = parciales.map(() => "0.00");
  let cup: Cotizacion["cupon"] = null;
  if (cupon) {
    try {
      const r = aplicarCupon(cupon, parciales.map((x) => x.neto), parciales.map((x) => !!x.oferta || x.manual.gt(0)));
      porLinea = r.porLinea;
      cup = { id: cupon.id, codigo: cupon.codigo, total: r.total };
    } catch (e) {
      throw new ErrorCarrito((e as Error).message);
    }
  }

  const cotizadas = parciales.map((x, i) => ({
    oferta: x.oferta,
    descuentoManual: x.manual.toFixed(2),
    descuentoCupon: porLinea[i],
    calc: calcularLinea({
      cantidad: x.l.cantidad,
      precioUnitario: x.l.precio,
      tasaItbis: x.l.tasaItbis,
      precioIncluyeItbis: x.l.precioIncluyeItbis,
      descuento: x.manual.plus(x.oferta?.descuento ?? 0).plus(porLinea[i]),
    }),
  }));
  return {
    lineas: cotizadas, totales: totalizar(cotizadas.map((c) => c.calc)), cupon: cup,
    ofertasAgotadas: [...agotadas].map(([ofertaId, nombre]) => ({ ofertaId, nombre })),
  };
}

// ---------------------------------------------------------------------
// Catálogo en memoria (lo que descarga la terminal)
// ---------------------------------------------------------------------
export interface ProductoCatalogo {
  presentacionId: string;
  productoId: string;
  categoriaId: string | null;
  sku: string;
  nombre: string;
  presentacion: string;
  factor: string;
  esPesable: boolean;
  precioIncluyeItbis: boolean;
  tasaItbis: string;
  codigos: string[];
  precios: Record<string, string>; // nivel → precio
  // Para el modo Catálogo de la terminal
  imagen?: string | null;
  categoria?: string | null;
  categoriaColor?: string | null;
  categoriaIcono?: string | null;
  controlaStock?: boolean;
  existencia?: string;
  minimo?: string | null;
  tipo?: "INVENTARIABLE" | "SERVICIO" | "COMBO";
  permiteSinExistencia?: boolean;
  precioVariable?: boolean;
  precioVariableMin?: string | null;
  precioVariableMax?: string | null;
  nombreCorto?: string | null;
}

export interface OfertaCatalogo extends Oferta {
  nivel: number | null;
  alcance: { productoId: string | null; presentacionId: string | null; categoriaId: string | null }[];
}

export interface Catalogo {
  version: string;
  nivelPredeterminado: number;
  productos: ProductoCatalogo[];
  ofertas: OfertaCatalogo[];
}

/** Índices para buscar por código en O(1). */
export function indexarCatalogo(c: Catalogo) {
  const porCodigo = new Map<string, ProductoCatalogo>();
  const porId = new Map<string, ProductoCatalogo>();
  for (const p of c.productos) {
    porId.set(p.presentacionId, p);
    for (const cod of p.codigos) porCodigo.set(cod, p);
  }
  return { porCodigo, porId };
}

/** Precio para un nivel; si el producto no lo tiene, el del nivel predeterminado. */
export function precioPara(p: ProductoCatalogo, nivel: number | null, predeterminado: number): { precio: string | null; nivel: number } {
  if (nivel !== null && p.precios[nivel] !== undefined) return { precio: p.precios[nivel], nivel };
  return { precio: p.precios[predeterminado] ?? null, nivel: predeterminado };
}

export function ofertasPara(c: Catalogo, p: ProductoCatalogo, nivel: number): Oferta[] {
  return c.ofertas.filter(
    (o) =>
      (o.nivel === null || o.nivel === nivel) &&
      o.alcance.some(
        (a) => a.presentacionId === p.presentacionId || a.productoId === p.productoId || (a.categoriaId !== null && a.categoriaId === p.categoriaId),
      ),
  );
}
