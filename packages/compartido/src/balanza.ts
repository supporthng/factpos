/**
 * Códigos de balanza (EAN-13 que empiezan con 2).
 *
 * Las balanzas etiquetadoras imprimen un código con el producto y el peso
 * (o el precio) incrustados. Formato más común (13 dígitos):
 *   2      prefijo de uso interno (el formato es 2 PPPPP X WWWWW C)
 *   PPPPP  código del producto en la balanza (X = dígito de control interno)
 *   WWWWW  peso en gramos (o precio en centavos, según la configuración)
 *   C      dígito verificador
 */
export interface CodigoBalanza {
  codigoProducto: string;
  valor: number;            // kilos o pesos, según `modo`
  modo: "PESO" | "PRECIO";
}

export function esCodigoBalanza(codigo: string): boolean {
  return /^2\d{12}$/.test(codigo) && digitoVerificadorEan13(codigo.slice(0, 12)) === Number(codigo[12]);
}

export function leerCodigoBalanza(codigo: string, modo: "PESO" | "PRECIO" = "PESO"): CodigoBalanza | null {
  if (!esCodigoBalanza(codigo)) return null;
  const codigoProducto = codigo.slice(1, 6);
  const crudo = Number(codigo.slice(7, 12));
  return {
    codigoProducto,
    valor: modo === "PESO" ? crudo / 1000 : crudo / 100,
    modo,
  };
}

export function digitoVerificadorEan13(doce: string): number {
  const suma = doce
    .split("")
    .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (suma % 10)) % 10;
}
