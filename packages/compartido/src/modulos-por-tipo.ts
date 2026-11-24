import type { TipoNegocio } from "./tipo-negocio.js";

/**
 * Qué pantallas de la administración son propias de un tipo de negocio. Una pantalla que no está aquí es de todos
 * (ventas, inventario, compras, precios, clientes, cuentas por cobrar, fiscal, reportes, configuración).
 * Cada tipo ve solo lo suyo: así la mueblería no ve «Tramería», la farmacia no ve «Entregas» y el bar no ve «Series y garantías».
 * (Las mesas, cuentas, comandas y propina de bares y restaurantes ya se activan solas por el tipo, en la caja y en el servidor.)
 */
export const SECCIONES_POR_TIPO: Readonly<Record<string, readonly TipoNegocio[]>> = {
  // Mueblería y electrodomésticos: venta a plazos, cobranza, mora y entregas
  planes: ["MUEBLERIA"],
  cobranza: ["MUEBLERIA"],
  mora: ["MUEBLERIA"],
  entregas: ["MUEBLERIA"],
  // Lo que se vende con número de serie y garantía (tiendas de electrónica, celulares, electrodomésticos)
  series: ["TIENDA", "MUEBLERIA"],
  servicio: ["TIENDA", "MUEBLERIA"],
  // Farmacias: vencimientos, tramería, recetas
  farmacia: ["FARMACIA"],
};

/** ¿Esta pantalla corresponde a ese tipo de negocio? Con el tipo todavía desconocido (cargando o sin conexión) no se esconde nada. */
export const seccionDisponible = (id: string, tipo: string | null | undefined): boolean => {
  const solo = SECCIONES_POR_TIPO[id];
  if (!solo || !tipo) return true;
  return (solo as readonly string[]).includes(tipo);
};

/** Funciones de la ficha de producto propias de un tipo (vale de consumos: negocios de mesas; series y garantía: tiendas y mueblerías; tragos: licorerías y bares) */
export const FUNCION_PRODUCTO_POR_TIPO = {
  valeConsumos: ["RESTAURANTE", "BAR", "DISCOTECA", "COMIDA_RAPIDA"],
  seriesGarantia: ["TIENDA", "MUEBLERIA"],
  tragos: ["TIENDA", "RESTAURANTE", "BAR", "DISCOTECA"],
} as const satisfies Record<string, readonly TipoNegocio[]>;

export const funcionProductoDisponible = (f: keyof typeof FUNCION_PRODUCTO_POR_TIPO, tipo: string | null | undefined): boolean =>
  !tipo || (FUNCION_PRODUCTO_POR_TIPO[f] as readonly string[]).includes(tipo);
