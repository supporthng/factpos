/**
 * Formas equivalentes de un código de barras (tomado del verificador Prezio, que ya lo usa en producción).
 * Un producto puede estar guardado como UPC-E (8), UPC-A (12), EAN-13 (13) o sin los ceros iniciales
 * que borra Excel: se prueban todas, la leída primero.
 */
function digitoControl(cuerpo: string): string {
  let suma = 0;
  for (let i = 0; i < cuerpo.length; i++) suma += Number(cuerpo[cuerpo.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return String((10 - (suma % 10)) % 10);
}

const esDigitos = (t: string) => /^\d+$/.test(t);

export function upceAUpca(upce: string): string | null {
  if (upce.length !== 8 || !esDigitos(upce) || !"01".includes(upce[0])) return null;
  const ns = upce[0], d = upce.slice(1, 7), control = upce[7], ultimo = d[5];
  let cuerpo: string;
  if ("012".includes(ultimo)) cuerpo = d.slice(0, 2) + ultimo + "0000" + d.slice(2, 5);
  else if (ultimo === "3") cuerpo = d.slice(0, 3) + "00000" + d.slice(3, 5);
  else if (ultimo === "4") cuerpo = d.slice(0, 4) + "00000" + d[4];
  else cuerpo = d.slice(0, 5) + "0000" + ultimo;
  const upca = ns + cuerpo + control;
  return digitoControl(upca.slice(0, 11)) === control ? upca : null;
}

export function upcaAUpce(upca: string): string[] {
  if (upca.length !== 12 || !esDigitos(upca) || !"01".includes(upca[0])) return [];
  const ns = upca[0], fab = upca.slice(1, 6), prod = upca.slice(6, 11), control = upca[11];
  const cand: string[] = [];
  if ("012".includes(fab[2]) && fab.slice(3) === "00" && prod.slice(0, 2) === "00") cand.push(fab.slice(0, 2) + prod.slice(2, 5) + fab[2]);
  if (fab.slice(3) === "00" && prod.slice(0, 3) === "000") cand.push(fab.slice(0, 3) + prod.slice(3, 5) + "3");
  if (fab[4] === "0" && prod.slice(0, 4) === "0000") cand.push(fab.slice(0, 4) + prod[4] + "4");
  if (prod.slice(0, 4) === "0000" && "56789".includes(prod[4])) cand.push(fab + prod[4]);
  return cand.map((d) => ns + d + control).filter((e) => upceAUpca(e) === upca);
}

/** La forma leída primero, luego sus equivalentes (UPC-A, EAN-13, UPC-E y sin ceros iniciales). */
export function variantesCodigoBarra(entrada: unknown): string[] {
  const codigo = String(entrada ?? "").trim();
  let formas = [codigo];
  if (!esDigitos(codigo)) return formas;
  let upca: string | null = null;
  if (codigo.length === 13 && codigo[0] === "0") upca = codigo.slice(1);
  else if (codigo.length === 12) upca = codigo;
  else if (codigo.length === 8) upca = upceAUpca(codigo);
  if (upca) formas = formas.concat([upca, "0" + upca], upcaAUpce(upca));
  formas = formas.concat(formas.map((f) => f.replace(/^0+/, "")).filter((f) => f.length >= 6));
  return [...new Set(formas.filter(Boolean))];
}
