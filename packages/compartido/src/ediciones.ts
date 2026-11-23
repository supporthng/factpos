import type { TipoNegocio } from "./tipo-negocio.js";

/**
 * Ediciones de FactPOS por tipo de negocio. Es UN solo producto y UN solo instalador: la edición es el nombre comercial
 * que el proveedor le da a cada cliente en el portal (y viaja en su licencia). Al activar, fija el tipo de negocio inicial
 * de la empresa; el cliente lo puede cambiar después en Datos de la empresa.
 */
export const EDICIONES = [
  { id: "MUEBLERIA", nombre: "FactPOS Mueblería", slug: "muebleria", tipoNegocio: "MUEBLERIA", lema: "Venta a plazos, cobranza y entregas para mueblerías y tiendas de electrodomésticos" },
  { id: "BAR_RESTAURANTE", nombre: "FactPOS Bar y Restaurante", slug: "bar-restaurante", tipoNegocio: "RESTAURANTE", lema: "Mesas, comandas, cuentas abiertas y propina para bares, restaurantes y discotecas" },
  { id: "ABARROTES", nombre: "FactPOS Abarrotes", slug: "abarrotes", tipoNegocio: "TIENDA", lema: "Ventas rápidas, inventario y crédito a clientes para colmados y tiendas de abarrotes" },
  { id: "LICORERIA", nombre: "FactPOS Licorería", slug: "licoreria", tipoNegocio: "TIENDA", lema: "Ventas, inventario por botella y control de existencias para licorerías" },
  { id: "SUPERMERCADO", nombre: "FactPOS Supermercado", slug: "supermercado", tipoNegocio: "TIENDA", lema: "Varias cajas, ofertas e inventario por sucursal para supermercados" },
] as const satisfies readonly { id: string; nombre: string; slug: string; tipoNegocio: TipoNegocio; lema: string }[];

export type EdicionId = (typeof EDICIONES)[number]["id"];
export const IDS_EDICION = EDICIONES.map((e) => e.id) as [EdicionId, ...EdicionId[]];

/** La edición con ese id (la edición estándar «FactPOS» no tiene: devuelve undefined). */
export const edicionPorId = (id: string | null | undefined) => EDICIONES.find((e) => e.id === id);
/** Nombre comercial para mostrar: «FactPOS Mueblería», o «FactPOS» si no hay edición. */
export const nombreEdicion = (id: string | null | undefined) => edicionPorId(id)?.nombre ?? "FactPOS";
