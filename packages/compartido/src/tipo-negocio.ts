/**
 * Tipo de negocio de la empresa. TIENDA es el de siempre; los de mesas (restaurante, bar, discoteca, comida rápida)
 * activan las cuentas abiertas, comandas, salón y propina; MUEBLERIA (muebles y electrodomésticos) activa la venta a plazos
 * con inicial, apartados y entregas, y NO usa nada de mesas; FARMACIA (farmacias y droguerías) activa la ubicación en la tramería,
 * el aviso de vencimiento, el bloqueo de lo vencido en la venta y la receta de los controlados.
 */
export const TIPOS_NEGOCIO = ["TIENDA", "RESTAURANTE", "BAR", "DISCOTECA", "COMIDA_RAPIDA", "MUEBLERIA", "FARMACIA"] as const;
export type TipoNegocio = (typeof TIPOS_NEGOCIO)[number];

const DE_MESAS: readonly string[] = ["RESTAURANTE", "BAR", "DISCOTECA", "COMIDA_RAPIDA"];

/** ¿Trabaja con mesas y cuentas abiertas (restaurante, bar, discoteca, comida rápida)? */
export const esNegocioDeMesas = (tipo: string | null | undefined) => !!tipo && DE_MESAS.includes(tipo);

/** ¿Es una mueblería / tienda de electrodomésticos (venta a plazos, apartados, entregas)? */
export const esMuebleria = (tipo: string | null | undefined) => tipo === "MUEBLERIA";

/** ¿Es una farmacia (ubicación en tramería, vencimientos, controlados con receta)? */
export const esFarmacia = (tipo: string | null | undefined) => tipo === "FARMACIA";
