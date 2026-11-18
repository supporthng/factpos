import { fechaHoraDGII } from "./xml.js";
import { ESTRUCTURA_ECF, type NodoEcf } from "./estructura-ecf.js";
import { construirAcecf } from "./servicios-dgii.js";

/**
 * Set de pruebas de la DGII (Excel de casos de e-CF y resumen de consumo): cada fila trae TODOS los datos del comprobante,
 * con columnas que repiten sus nombres con índices («NombreItem[3]», «TipoCodigo[2][1]»…). Aquí se arma el XML siguiendo el
 * orden exacto de los XSD oficiales (estructura-ecf.ts), sin recalcular nada: la DGII compara contra sus propios montos.
 * Sirve para cualquier empresa: el RNC, los datos y los montos salen del Excel que la DGII le generó a ella.
 */
export type FilaCaso = Record<string, string>;

const VACIOS = new Set(["", "#e"]);
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** El esquema llama distinto a algunas columnas del Excel: «ruta del elemento» → nombre de columna. */
const ALIAS: Record<string, string> = {
  "DescuentosORecargos/DescuentoORecargo/NumeroLinea": "NumeroLineaDoR",
  "Paginacion/Pagina/SubtotalImpuestoAdicional": "SubtotalImpuestoAdicionalPaginaTabla",
};

export interface ResultadoArmado { xml: string; tipo: string; encf: string; sinUsar: string[] }

/** Limpia una fila: quita celdas vacías y el marcador «#e» (valor vacío del Excel de la DGII). */
export function limpiarFila(f: Record<string, unknown>): FilaCaso {
  const o: FilaCaso = {};
  for (const [k, v] of Object.entries(f)) {
    const t = v == null ? "" : String(v).trim();
    if (!VACIOS.has(t)) o[k.trim()] = t;
  }
  return o;
}

export function tipoDeFila(f: FilaCaso, hoja: "ECF" | "RFCE"): string {
  if (hoja === "RFCE") return "RFCE";
  const t = String(f["TipoeCF"] ?? "").trim();
  const clave = `E${t.padStart(2, "0")}`;
  if (!ESTRUCTURA_ECF[clave]) throw new Error(`Tipo de e-CF no soportado en el set de pruebas: «${t}»`);
  return clave;
}

export function armarXmlDeFila(fila: FilaCaso, hoja: "ECF" | "RFCE", extra: Record<string, string> = {}): ResultadoArmado {
  const tipo = tipoDeFila(fila, hoja);
  const cols = new Map<string, string>();
  for (const [k, v] of Object.entries({ ...fila, ...extra })) cols.set(norm(k), v);
  const usadas = new Set<string>();

  const buscar = (nombre: string, idx: number[]): string | undefined => {
    const base = norm(nombre);
    const intentos = [base + idx.map((i) => `[${i}]`).join("")];
    if (idx.length && idx.every((i) => i === 1)) intentos.push(base);   // columnas sin índice (p. ej. Subtotales)
    for (const k of intentos) { const v = cols.get(k); if (v !== undefined) { usadas.add(k); return v; } }
    return undefined;
  };

  /** `real` = el fragmento lleva algún dato del Excel (un contenedor obligatorio vacío se emite, pero no cuenta como dato). */
  const emitir = (n: NodoEcf, idx: number[], ruta: string): { xml: string; real: boolean } => {
    const [nombre, min, max, hijos] = n;
    const r = ruta ? `${ruta}/${nombre}` : nombre;
    if (!hijos) {
      const col = ALIAS[r.replace(/^ECF\//, "")] ?? nombre;
      if (max > 1) {
        let s = "";
        for (let i = 1; i <= max; i++) { const v = buscar(col, [...idx, i]); if (v === undefined) break; s += `<${nombre}>${esc(v)}</${nombre}>`; }
        return { xml: s, real: s !== "" };
      }
      const v = buscar(col, idx);
      return v === undefined ? { xml: "", real: false } : { xml: `<${nombre}>${esc(v)}</${nombre}>`, real: true };
    }
    if (max > 1) {
      let s = "";
      for (let i = 1; i <= max; i++) {
        const partes = hijos.map((h) => emitir(h, [...idx, i], r));
        if (!partes.some((x) => x.real)) break;
        s += `<${nombre}>${partes.map((x) => x.xml).join("")}</${nombre}>`;
      }
      return { xml: s, real: s !== "" };
    }
    const partes = hijos.map((h) => emitir(h, idx, r));
    const real = partes.some((x) => x.real);
    const dentro = partes.map((x) => x.xml).join("");
    return real || min >= 1 ? { xml: `<${nombre}>${dentro}</${nombre}>`, real } : { xml: "", real: false };
  };

  const raiz = ESTRUCTURA_ECF[tipo]!;
  const xml = `<?xml version="1.0" encoding="utf-8"?>${emitir(raiz, [], "").xml}`;
  const sinUsar = [...cols.keys()].filter((k) => !usadas.has(k) && k !== "casoprueba" && k !== "indicadornotacredito" && !k.startsWith("#"));
  return { xml, tipo, encf: fila["ENCF"] ?? "", sinUsar };
}

/** Fecha y hora de la firma tal como la pide el esquema (hora de República Dominicana). */
export const fechaHoraFirma = (d = new Date()) => fechaHoraDGII(d);

/**
 * Aprobación comercial del set de pruebas (hoja «ACECF» del Excel): cada fila trae el e-CF que la DGII simula que un suplidor nos envió
 * (RNC emisor, e-NCF, fecha, monto) y si se aprueba (Estado 1) o se rechaza (Estado 2, con su motivo). Con eso se arma el ACECF.
 */
export function armarAcecfDeFila(fila: Record<string, unknown>, ahora = new Date()): { xml: string; encf: string; rncEmisor: string; rncComprador: string; aceptado: boolean } {
  const clave = new Map(Object.keys(fila).map((k) => [k.toLowerCase().replace(/[^a-z0-9]/g, ""), k]));
  const v = (...nombres: string[]) => {
    for (const n of nombres) { const k = clave.get(n.toLowerCase().replace(/[^a-z0-9]/g, "")); const x = k === undefined ? undefined : String(fila[k] ?? "").trim(); if (x && x !== "#e") return x; }
    return "";
  };
  const encf = v("eNCF", "ENCF");
  const rncEmisor = v("RNCEmisor").replace(/\D/g, "");
  const rncComprador = v("RNCComprador").replace(/\D/g, "");
  const monto = Number(v("MontoTotal").replace(/,/g, ""));
  const estado = Number(v("Estado"));
  const motivo = v("DetalleMotivoRechazo", "MotivoRechazo");
  // La DGII compara esta fecha/hora con la que ella generó en el set: se envía tal cual
  const fh = v("FechaHoraAprobacionComercial");
  const fechaHora = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(fh) ? fh : undefined;
  if (!encf || !rncEmisor || !rncComprador) throw new Error("La fila de aprobación comercial necesita eNCF, RNCEmisor y RNCComprador.");
  if (!Number.isFinite(monto)) throw new Error("La fila de aprobación comercial no trae un MontoTotal válido.");
  if (estado !== 1 && estado !== 2) throw new Error("El Estado de la aprobación debe ser 1 (aprobado) o 2 (rechazado).");
  if (estado === 2 && !motivo) throw new Error("Una aprobación rechazada necesita su DetalleMotivoRechazo.");
  const xml = construirAcecf({ rncEmisor, encf, fechaEmision: v("FechaEmision"), montoTotal: monto.toFixed(2), rncComprador, aceptado: estado === 1, ...(fechaHora ? { fechaHora } : {}), ...(estado === 2 ? { motivoRechazo: motivo } : {}), ahora });
  return { xml, encf, rncEmisor, rncComprador, aceptado: estado === 1 };
}
