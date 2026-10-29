/**
 * Validación de documentos dominicanos (dígito verificador de la DGII / JCE).
 * La usa la caja para avisar al momento y el servidor para no guardar
 * documentos con errores: un RNC mal escrito hace que la DGII rechace el e-CF.
 */

/** RNC (9 dígitos): pesos 7,9,8,6,5,4,3,2 sobre los primeros 8, módulo 11. */
export function rncValido(rnc: string): boolean {
  const d = rnc.replace(/\D/g, "");
  if (!/^\d{9}$/.test(d)) return false;
  const pesos = [7, 9, 8, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((a, p, i) => a + p * Number(d[i]), 0);
  const resto = suma % 11;
  const verificador = resto === 0 ? 2 : resto === 1 ? 1 : 11 - resto;
  return verificador === Number(d[8]);
}

/** Cédula (11 dígitos): algoritmo de Luhn (pesos 1 y 2 alternos). */
export function cedulaValida(cedula: string): boolean {
  const d = cedula.replace(/\D/g, "");
  if (!/^\d{11}$/.test(d)) return false;
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    let v = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    if (v > 9) v -= 9;
    suma += v;
  }
  return (10 - (suma % 10)) % 10 === Number(d[10]);
}

/** 131-00000-2 / 402-1234567-8 */
export function formatoDocumento(tipo: string, doc: string): string {
  const d = doc.replace(/\D/g, "");
  if (tipo === "RNC" && d.length === 9) return `${d.slice(0, 1)}-${d.slice(1, 3)}-${d.slice(3, 8)}-${d.slice(8)}`;
  if (tipo === "CEDULA" && d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`;
  return doc;
}
