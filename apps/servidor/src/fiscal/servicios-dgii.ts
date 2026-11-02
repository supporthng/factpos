import { createHmac, randomUUID, timingSafeEqual, X509Certificate } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

/**
 * Piezas de los servicios que la DGII llama en el servidor del contribuyente (autenticación, recepción de e-CF y
 * aprobación comercial) y de los XML que respondemos (ARECF, ACECF, ANECF). Sin base de datos: todo se puede probar solo.
 * Los campos siguen los formatos v1.0 de la DGII (Formato Acuse de Recibo, Aprobación Comercial y Anulación de e-NCF).
 */
const secreto = () => process.env.SESION_SECRETO ?? process.env.PIN_SECRETO ?? "factpos-desarrollo-cambiar-en-produccion";
const hmac = (tipo: string, texto: string) => createHmac("sha256", secreto()).update(`${tipo}:${texto}`).digest("base64url");
const igual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ------------------------------------------------------------ Autenticación (sin estado: todo va firmado)
export function nuevaSemilla(ahora = Date.now()) {
  const base = `${randomUUID()}.${ahora}`;
  return { valor: `${base}.${hmac("semilla", base)}`, fecha: new Date(ahora).toISOString() };
}
export function semillaValida(valor: string, ahora = Date.now(), maxMs = 5 * 60_000) {
  const p = valor.split(".");
  if (p.length !== 3) return false;
  const base = `${p[0]}.${p[1]}`;
  const ts = Number(p[1]);
  return igual(p[2], hmac("semilla", base)) && Number.isFinite(ts) && ahora - ts >= 0 && ahora - ts <= maxMs;
}
export function xmlSemilla(s: { valor: string; fecha: string }) {
  return `<?xml version="1.0" encoding="utf-8"?><SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><valor>${s.valor}</valor><fecha>${s.fecha}</fecha></SemillaModel>`;
}
export function emitirToken(ahora = Date.now(), horas = 1) {
  const cuerpo = Buffer.from(JSON.stringify({ exp: ahora + horas * 3600_000 })).toString("base64url");
  return { token: `${cuerpo}.${hmac("token-dgii", cuerpo)}`, expedido: new Date(ahora).toISOString(), expira: new Date(ahora + horas * 3600_000).toISOString() };
}
export function tokenValido(token: string | undefined | null, ahora = Date.now()) {
  const [cuerpo, firma] = (token ?? "").split(".");
  if (!cuerpo || !firma || !igual(firma, hmac("token-dgii", cuerpo))) return false;
  try { return (JSON.parse(Buffer.from(cuerpo, "base64url").toString()) as { exp: number }).exp > ahora; } catch { return false; }
}

// ------------------------------------------------------------ Lectura de lo que llega
/** Saca el archivo del campo «xml» de un multipart/form-data. */
export function xmlDeMultipart(cuerpo: Buffer, tipoContenido: string): string | null {
  const limite = /boundary="?([^";]+)"?/i.exec(tipoContenido)?.[1];
  if (!limite) return null;
  for (const parte of cuerpo.toString("utf8").split(`--${limite}`)) {
    const i = parte.indexOf("\r\n\r\n");
    if (i < 0 || !/name="?xml"?/i.test(parte.slice(0, i))) continue;
    return parte.slice(i + 4).replace(/\r\n$/, "").trim();
  }
  return null;
}
/** Valor de una etiqueta simple (<RNCEmisor>…</RNCEmisor>). */
export const valorDe = (xml: string, etiqueta: string) => new RegExp(`<${etiqueta}>\\s*([^<]*?)\\s*</${etiqueta}>`).exec(xml)?.[1] ?? null;

/** La firma del documento completo es válida (certificado incluido en el propio XML; no se valida la cadena de confianza). */
export function firmaValida(xml: string): boolean {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const firmas = doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature");
    if (firmas.length !== 1) return false;
    if (!/<(?:\w+:)?Reference[^>]*URI=""/.test(xml)) return false; // la firma debe cubrir todo el documento
    const b64 = /<(?:\w+:)?X509Certificate>([^<]+)<\/(?:\w+:)?X509Certificate>/.exec(xml)?.[1]?.replace(/\s/g, "");
    if (!b64) return false;
    const pem = `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----`;
    new X509Certificate(pem);
    const s = new SignedXml({ publicCert: pem });
    s.loadSignature(firmas.item(0) as any);
    return s.checkSignature(xml);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ XML que respondemos (se firman con firmarXml)
const esc = (v: string | number) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const el = (n: string, v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : `<${n}>${esc(v)}</${n}>`);

/** dd-MM-AAAA HH:mm:ss en hora de República Dominicana. */
export function fechaHoraDgii(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santo_Domingo", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}

export type MotivoNoRecibido = 1 | 2 | 3 | 4; // especificación · firma digital · envío duplicado · RNC comprador no corresponde
export function construirArecf(d: { rncEmisor: string; rncComprador: string; encf: string; estado: 0 | 1; motivo?: MotivoNoRecibido; ahora?: Date }) {
  return `<?xml version="1.0" encoding="UTF-8"?><ARECF><DetalleAcusedeRecibo>${el("Version", "1.0")}${el("RNCEmisor", d.rncEmisor)}${el("RNCComprador", d.rncComprador)}${el("eNCF", d.encf)}${el("Estado", d.estado)}${d.estado === 1 ? el("CodigoMotivoNoRecibido", d.motivo ?? 1) : ""}${el("FechaHoraAcuseRecibo", fechaHoraDgii(d.ahora))}</DetalleAcusedeRecibo></ARECF>`;
}

export function construirAcecf(d: { rncEmisor: string; encf: string; fechaEmision: string; montoTotal: string; rncComprador: string; aceptado: boolean; motivoRechazo?: string; ahora?: Date }) {
  return `<?xml version="1.0" encoding="UTF-8"?><ACECF><DetalleAprobacionComercial>${el("Version", "1.0")}${el("RNCEmisor", d.rncEmisor)}${el("eNCF", d.encf)}${el("FechaEmision", d.fechaEmision)}${el("MontoTotal", d.montoTotal)}${el("RNCComprador", d.rncComprador)}${el("Estado", d.aceptado ? 1 : 2)}${d.aceptado ? "" : el("DetalleMotivoRechazo", (d.motivoRechazo ?? "Rechazado").slice(0, 250))}${el("FechaHoraAprobacionComercial", fechaHoraDgii(d.ahora))}</DetalleAprobacionComercial></ACECF>`;
}

export interface RangoAnulado { tipo: string; desde: string; hasta: string }
const numeroDe = (encf: string) => Number(encf.slice(3));
/** Anulación de rangos de e-NCF no usados (hasta 10 rangos por tipo). */
export function construirAnecf(d: { rncEmisor: string; rangos: RangoAnulado[]; ahora?: Date }) {
  const tipos = [...new Set(d.rangos.map((r) => r.tipo.replace(/^E/, "")))];
  let total = 0;
  const detalle = tipos.map((t, i) => {
    const rs = d.rangos.filter((r) => r.tipo.replace(/^E/, "") === t);
    const cant = rs.reduce((a, r) => a + (numeroDe(r.hasta) - numeroDe(r.desde) + 1), 0);
    total += cant;
    return `<Anulacion>${el("NoLinea", i + 1)}${el("TipoeCF", t)}<TablaRangoSecuenciasAnuladaseNCF>${rs.map((r) => `<Secuencias>${el("SecuenciaeNCFDesde", r.desde)}${el("SecuenciaeNCFHasta", r.hasta)}</Secuencias>`).join("")}</TablaRangoSecuenciasAnuladaseNCF>${el("CantidadeNCFAnulados", cant)}</Anulacion>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ANECF><Encabezado>${el("Version", "1.0")}${el("RncEmisor", d.rncEmisor)}${el("CantidadeNCFAnulados", total)}${el("FechaHoraAnulacioneNCF", fechaHoraDgii(d.ahora))}</Encabezado><DetalleAnulacion>${detalle}</DetalleAnulacion></ANECF>`;
}
