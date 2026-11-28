import type { TipoNegocio } from "./tipo-negocio.js";
import type { ModuloEmpresa } from "./modulos-empresa.js";

/**
 * FactPOS a secas es el producto base: abarrotes, supermercados, licorerías y comercios parecidos. Las EDICIONES son derivados
 * para negocios con un funcionamiento propio (hoy mueblería y bar/restaurante; después los que vengan). Es UN solo producto y UN
 * solo instalador: la edición es el nombre comercial que el proveedor le da a cada cliente en el portal (y viaja en su licencia). Al activar, fija el tipo de negocio inicial
 * de la empresa; el cliente lo puede cambiar después en Datos de la empresa.
 */
export const EDICIONES = [
  { id: "MUEBLERIA", nombre: "FactPOS Mueblería", slug: "muebleria", tipoNegocio: "MUEBLERIA", lema: "Venta a plazos, cobranza y entregas para mueblerías y tiendas de electrodomésticos" },
  { id: "FARMACIA", nombre: "FactPOS Farmacia", slug: "farmacia", tipoNegocio: "FARMACIA", lema: "Ubicación en tramería, vencimientos con aviso y venta con receta para farmacias y droguerías" },
  { id: "BAR_RESTAURANTE", nombre: "FactPOS Bar y Restaurante", slug: "bar-restaurante", tipoNegocio: "RESTAURANTE", lema: "Mesas, comandas, cuentas abiertas y propina para bares, restaurantes y discotecas" },
  { id: "AUTOLAVADO", nombre: "FactPOS Auto Detailing", slug: "auto-detailing", tipoNegocio: "TIENDA", modulos: ["LAVADO"], lema: "Recepción de vehículos, órdenes de lavado, bahías y comisión por lavado para autolavados y auto detailing" },
  { id: "PELUQUERIA", nombre: "FactPOS Peluquería", slug: "peluqueria", tipoNegocio: "TIENDA", modulos: ["SALON"], lema: "Citas por estilista, servicios con comisión y venta de productos para peluquerías, salones de belleza, uñas y spa" },
  { id: "BARBERIA", nombre: "FactPOS Barbería", slug: "barberia", tipoNegocio: "TIENDA", modulos: ["SALON"], lema: "Turnos sin cita, citas por barbero y comisión por servicio para barberías" },
] as const satisfies readonly { id: string; nombre: string; slug: string; tipoNegocio: TipoNegocio; lema: string; /** módulos que la edición enciende además de los de su tipo */ modulos?: readonly ModuloEmpresa[] }[];

export type EdicionId = (typeof EDICIONES)[number]["id"];
export const IDS_EDICION = EDICIONES.map((e) => e.id) as [EdicionId, ...EdicionId[]];

/** La edición con ese id (la edición estándar «FactPOS» no tiene: devuelve undefined). */
export const edicionPorId = (id: string | null | undefined) =>
  EDICIONES.find((e) => e.id === id) as ((typeof EDICIONES)[number] & { modulos?: readonly ModuloEmpresa[] }) | undefined;
/** Nombre comercial para mostrar: «FactPOS Mueblería», o «FactPOS» si no hay edición. */
export const nombreEdicion = (id: string | null | undefined) => edicionPorId(id)?.nombre ?? "FactPOS";

/** Título de la ventana de la administración según el tipo de negocio: «FactPOS Farmacia», «FactPOS Mueblería»…; la tienda es FactPOS a secas. */
const TITULO_POR_TIPO: Record<string, string> = {
  MUEBLERIA: "FactPOS Mueblería", FARMACIA: "FactPOS Farmacia", RESTAURANTE: "FactPOS Restaurante", BAR: "FactPOS Bar",
  DISCOTECA: "FactPOS Discoteca", COMIDA_RAPIDA: "FactPOS Comida rápida",
};
export const tituloPorTipo = (tipo: string | null | undefined) => TITULO_POR_TIPO[tipo ?? ""] ?? "FactPOS";
