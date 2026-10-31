/** Lectura de tablas (.csv y .xlsx) en el navegador, sin dependencias: el .xlsx es un zip de XML. */
export type Tabla = string[][];

/* ---------- CSV ---------- */
function leerCsv(texto: string): Tabla {
  texto = texto.replace(/^﻿/, "");
  const primera = texto.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => [s, primera.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const filas: Tabla = [];
  let fila: string[] = [], celda = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"') { if (texto[i + 1] === '"') { celda += '"'; i++; } else comillas = false; }
      else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(celda); celda = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda); celda = ""; filas.push(fila); fila = [];
    } else celda += ch;
  }
  if (celda !== "" || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

/* ---------- XLSX ---------- */
async function inflar(datos: Uint8Array): Promise<Uint8Array> {
  const flujo = new Blob([datos as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

async function descomprimir(buf: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  let fin = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65600); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("El archivo no es un .xlsx válido.");
  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, () => Promise<string>>();
  for (let k = 0; k < total; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true), comp = v.getUint32(p + 20, true);
    const ln = v.getUint16(p + 28, true), le = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const nombre = dec.decode(u8.subarray(p + 46, p + 46 + ln));
    p += 46 + ln + le + lc;
    out.set(nombre, async () => {
      const ini = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      const crudo = u8.subarray(ini, ini + comp);
      return dec.decode(metodo === 0 ? crudo : await inflar(crudo));
    });
  }
  return out;
}

const letraACol = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

async function leerXlsx(buf: ArrayBuffer): Promise<Tabla> {
  const z = await descomprimir(buf);
  const xml = async (n: string) => new DOMParser().parseFromString(await z.get(n)!(), "application/xml");
  const hoja = [...z.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()))[0];
  if (!hoja) throw new Error("El libro no tiene hojas.");
  const textos: string[] = [];
  if (z.has("xl/sharedStrings.xml")) {
    for (const si of Array.from((await xml("xl/sharedStrings.xml")).getElementsByTagName("si")))
      textos.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
  }
  const filas: Tabla = [];
  for (const r of Array.from((await xml(hoja)).getElementsByTagName("row"))) {
    const fila: string[] = [];
    for (const c of Array.from(r.getElementsByTagName("c"))) {
      const t = c.getAttribute("t"), vEl = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let val = vEl;
      if (t === "s") val = textos[Number(vEl)] ?? "";
      else if (t === "inlineStr") val = Array.from(c.getElementsByTagName("t")).map((x) => x.textContent ?? "").join("");
      else if (t === "b") val = vEl === "1" ? "Sí" : "No";
      const col = letraACol(c.getAttribute("r") ?? "A");
      while (fila.length < col) fila.push("");
      fila[col] = val;
    }
    const idx = Number(r.getAttribute("r")) - 1;
    while (Number.isFinite(idx) && filas.length < idx) filas.push([]);
    filas.push(fila);
  }
  return filas;
}

export async function leerTabla(archivo: File): Promise<Tabla> {
  const nombre = archivo.name.toLowerCase();
  let t: Tabla;
  if (nombre.endsWith(".xlsx") || nombre.endsWith(".xlsm")) t = await leerXlsx(await archivo.arrayBuffer());
  else if (nombre.endsWith(".csv") || nombre.endsWith(".txt") || nombre.endsWith(".tsv")) t = leerCsv(await archivo.text());
  else throw new Error("Use un archivo de Excel (.xlsx) o un .csv. Si tiene un .xls antiguo, guárdelo como .xlsx desde Excel.");
  return t.map((f) => f.map((c) => c.trim())).filter((f) => f.some((c) => c !== ""));
}

/** Número tolerante: "1,234.50", "1.234,50", "RD$ 85", "12,5". */
export function aNumero(v: string): number | null {
  let s = v.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  const c = s.lastIndexOf(","), p = s.lastIndexOf(".");
  if (c >= 0 && p >= 0) s = c > p ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (c >= 0) s = /,\d{1,2}$/.test(s) && s.indexOf(",") === c ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
