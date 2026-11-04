// Lector mínimo de respaldos SQL (INSERT INTO ... VALUES (...);) sin dependencias.
// Devuelve { tabla: [ {columna: valor, ...}, ... ] }. Entiende cadenas con '' escapado, números, TRUE/FALSE y NULL.
import { readFileSync } from "node:fs";

export function leerInserts(ruta, { tablas } = {}) {
  const t = readFileSync(ruta, "utf8");
  const salida = {};
  const re = /^INSERT INTO (?:\w+\.)?(\w+) \(([^)]*)\) VALUES \(/gm;
  let m;
  while ((m = re.exec(t))) {
    const tabla = m[1];
    if (tablas && !tablas.includes(tabla)) continue;
    const cols = m[2].split(",").map((c) => c.trim());
    let i = re.lastIndex;
    const vals = [];
    while (true) {
      while (t[i] === " ") i++;
      let v;
      if (t[i] === "'") {
        let j = i + 1, s = "";
        while (true) {
          const k = t.indexOf("'", j);
          if (k < 0) throw new Error("Cadena sin cerrar en " + tabla);
          s += t.slice(j, k);
          if (t[k + 1] === "'") { s += "'"; j = k + 2; } else { i = k + 1; break; }
        }
        v = s;
      } else {
        let j = i;
        while (j < t.length && t[j] !== "," && t[j] !== ")") j++;
        const w = t.slice(i, j).trim();
        v = w === "NULL" ? null : w === "TRUE" ? true : w === "FALSE" ? false : (Number.isNaN(Number(w)) || /^-?0\d/.test(w)) ? w : Number(w);
        i = j;
      }
      vals.push(v);
      while (t[i] === " ") i++;
      if (t[i] === ",") { i++; continue; }
      if (t[i] === ")") break;
      throw new Error(`Valor inesperado en ${tabla}: "${t.slice(i, i + 30)}"`);
    }
    if (vals.length !== cols.length) throw new Error(`${tabla}: ${cols.length} columnas y ${vals.length} valores`);
    (salida[tabla] ??= []).push(Object.fromEntries(cols.map((c, k) => [c, vals[k]])));
    re.lastIndex = i;
  }
  return salida;
}
