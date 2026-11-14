/**
 * La columna de unidad de medida de la factura dice «UND», «UN», «PZA»…: la cantidad ya viene en unidades sueltas.
 * El «X30X1» del nombre solo describe cuántas trae una caja; NO se multiplica (12 UND a 55.11 son 12 fundas, no 360).
 */
const UNIDAD_SUELTA = /^\s*(und|un|uds?|unid|unidad(?:es)?|u|pza|pzas|pz|pieza(?:s)?|bot|botella(?:s)?|lata(?:s)?)\s*\.?\s*$/i;
export const esUnidadSuelta = (unidad: string | null | undefined) => UNIDAD_SUELTA.test(unidad ?? "");
