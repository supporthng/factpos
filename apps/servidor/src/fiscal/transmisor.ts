import { ecfXmlAJson } from "./xml-a-json.js";
import { firmarXml } from "./firma.js";

/**
 * Envío de e-CF a la DGII. Tres transmisores intercambiables:
 *
 *  - SIMULADO: acepta todo. Para desarrollo y demostraciones.
 *  - DGII:     envío directo a los servicios web de la DGII (requiere estar
 *              certificado como emisor electrónico).
 *  - PSE:      a través de un Proveedor de Servicios Electrónicos autorizado.
 *              Cada PSE tiene su propia API: este adaptador envía el XML firmado
 *              y espera { estado, trackId, mensajes }. Se ajusta al contratar.
 *
 * Las direcciones de la DGII se pueden cambiar por variables de entorno.
 * Deben confirmarse en el proceso de certificación (set de pruebas).
 */
export type EstadoDgii = "ACEPTADO" | "ACEPTADO_COND" | "RECHAZADO" | "EN_PROCESO";
export interface Respuesta { estado: EstadoDgii; trackId?: string; mensajes?: unknown }
/** `xmlCompleto`: el e-CF completo firmado (aunque lo que se transmita sea el resumen RFCE); lo usan los proveedores que reciben el comprobante entero. */
export interface DocumentoEnvio { encf: string; tipo: string; modo: "ECF" | "RFCE"; xml: string; rncEmisor: string; xmlCompleto?: string }

export interface Transmisor {
  enviar(d: DocumentoEnvio): Promise<Respuesta>;
  consultar(trackId: string, d: DocumentoEnvio): Promise<Respuesta>;
  /** Prueba de conexión y autenticación (solo el envío directo a la DGII). Lanza si falla. */
  probar?(): Promise<void>;
  /** Anulación de rangos de e-NCF (ANECF). Solo el envío directo a la DGII. */
  /** Aprobación comercial (ACECF) de un e-CF recibido. Solo el envío directo a la DGII. */
  aprobarComercial?(xmlFirmado: string, rncComprador: string): Promise<{ aceptada: boolean; respuesta: string }>;
  anularRango?(xmlFirmado: string, rncEmisor: string): Promise<{ aceptada: boolean; respuesta: string }>;
}

/** Error de red/servicio: el documento queda en contingencia y se reintenta. */
export class SinConexion extends Error {}

// ---------------------------------------------------------------------
export const simulado: Transmisor = {
  async enviar(d) {
    // RFCE: respuesta inmediata. e-CF completo: queda "en proceso" y se consulta luego.
    return d.modo === "RFCE"
      ? { estado: "ACEPTADO", mensajes: [{ simulado: true }] }
      : { estado: "EN_PROCESO", trackId: `SIM-${d.encf}` };
  },
  async consultar() {
    return { estado: "ACEPTADO", mensajes: [{ simulado: true }] };
  },
};

// ---------------------------------------------------------------------
async function http(url: string, init: RequestInit) {
  let r: Response;
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new SinConexion(`Sin conexión con ${new URL(url).host}: ${(e as Error).message}`);
  }
  const texto = await r.text();
  // Fallas del servicio o límites de uso: el documento NO está rechazado, se reintenta con espera
  if (r.status >= 500 || [408, 425, 429].includes(r.status)) throw new SinConexion(`Servicio no disponible o saturado (${r.status})`);
  let cuerpo: any;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = { texto }; }
  return { status: r.status, cuerpo };
}

const archivo = (xml: string, nombre: string) => {
  const f = new FormData();
  f.append("xml", new Blob([xml], { type: "text/xml" }), nombre);
  return f;
};

export function mapaEstado(v: unknown): EstadoDgii {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("condicional")) return "ACEPTADO_COND";
  if (s.includes("aceptado")) return "ACEPTADO";
  if (s.includes("rechazado")) return "RECHAZADO";
  return "EN_PROCESO";
}

export function dgii(ambiente: "TESTECF" | "CERTECF" | "ECF"): Transmisor {
  const seg = ambiente.toLowerCase();
  const base = process.env.DGII_URL_BASE ?? `https://ecf.dgii.gov.do/${seg}`;
  const baseFc = process.env.DGII_URL_FC ?? `https://fc.dgii.gov.do/${seg}`;
  let token: { valor: string; vence: number } | null = null;

  // Autenticación: se pide una "semilla", se firma con el certificado y se canjea por un token
  async function autenticar() {
    if (token && token.vence > Date.now() + 60000) return token.valor;
    const semilla = await http(`${base}/autenticacion/api/Autenticacion/Semilla`, { method: "GET" });
    const xmlSemilla = typeof semilla.cuerpo.texto === "string" ? semilla.cuerpo.texto : String(semilla.cuerpo);
    const { xmlFirmado } = firmarXml(xmlSemilla);
    const r = await http(`${base}/autenticacion/api/Autenticacion/ValidarSemilla`, {
      method: "POST", body: archivo(xmlFirmado, "semilla.xml"),
    });
    if (!r.cuerpo.token) throw new Error(`La DGII no devolvió token: ${JSON.stringify(r.cuerpo)}`);
    token = { valor: r.cuerpo.token, vence: Date.parse(r.cuerpo.expira ?? "") || Date.now() + 50 * 60000 };
    return token.valor;
  }

  /** Si la DGII responde 401 (token vencido o revocado) se pide uno nuevo y se repite una sola vez. */
  async function conToken(fn: (t: string) => Promise<{ status: number; cuerpo: any }>) {
    let r = await fn(await autenticar());
    if (r.status === 401) { token = null; r = await fn(await autenticar()); }
    if (r.status === 401 || r.status === 403) throw new SinConexion(`La DGII no aceptó la autenticación (${r.status}); se reintenta`);
    return r;
  }

  return {
    async probar() { token = null; await autenticar(); },
    async aprobarComercial(xml, rnc) {
      const r = await conToken((t) => http(`${base}/aprobacioncomercial/api/aprobacioncomercial`, {
        method: "POST", headers: { authorization: `Bearer ${t}` }, body: archivo(xml, `${rnc}ACECF.xml`),
      }));
      const c = r.cuerpo;
      const texto = Array.isArray(c.mensaje) ? c.mensaje.join(" ") : typeof c.texto === "string" ? c.texto : JSON.stringify(c);
      // estado/código 1 = aprobación validada; 2 = rechazada por la DGII (factura no encontrada, etc.)
      return { aceptada: r.status < 400 && String(c.codigo ?? "1") !== "2", respuesta: texto };
    },
    async anularRango(xml, rnc) {
      const r = await conToken((t) => http(`${base}/anulacionrangos/api/Operaciones/AnularRango`, {
        method: "POST", headers: { authorization: `Bearer ${t}` }, body: archivo(xml, `${rnc}ANECF.xml`),
      }));
      const texto = typeof r.cuerpo.texto === "string" ? r.cuerpo.texto : JSON.stringify(r.cuerpo);
      return { aceptada: r.status < 400, respuesta: texto };
    },
    async enviar(d) {
      const url = d.modo === "RFCE" ? `${baseFc}/recepcionfc/api/recepcion/ecf` : `${base}/recepcion/api/FacturasElectronicas`;
      const r = await conToken((t) => http(url, {
        method: "POST", headers: { authorization: `Bearer ${t}` }, body: archivo(d.xml, `${d.rncEmisor}${d.encf}.xml`),
      }));
      if (r.status >= 400) return { estado: "RECHAZADO", mensajes: r.cuerpo };
      if (d.modo === "RFCE") return { estado: mapaEstado(r.cuerpo.estado), mensajes: r.cuerpo.mensajes ?? r.cuerpo };
      return { estado: "EN_PROCESO", trackId: r.cuerpo.trackId, mensajes: r.cuerpo };
    },
    async consultar(trackId) {
      const r = await conToken((t) => http(`${base}/consultaresultado/api/Consultas/Estado?TrackId=${encodeURIComponent(trackId)}`, {
        method: "GET", headers: { authorization: `Bearer ${t}` },
      }));
      return { estado: mapaEstado(r.cuerpo.estado), mensajes: r.cuerpo.mensajes ?? r.cuerpo };
    },
  };
}

// ---------------------------------------------------------------------
/**
 * Proveedor de servicios de facturación electrónica (PSE) autorizado por la DGII.
 *
 * Cada proveedor tiene su propia API. Para no tocar la cola de envío ni el resto del sistema, lo único que
 * cambia entre proveedores es este contrato: cómo se arma la petición y cómo se leen sus respuestas.
 * `generico` es el formato propio de FactPOS (JSON); para un proveedor real se escribe otro `FormatoPse`.
 */
export interface FormatoPse {
  nombre: string;
  /** Petición para emitir el documento */
  emitir(d: DocumentoEnvio): { ruta: string; metodo: "POST" | "PUT"; cuerpo: unknown };
  /** Petición para saber cómo va un documento ya enviado */
  consultar(trackId: string, d: DocumentoEnvio): { ruta: string };
  /** Estado final o en proceso a partir de la respuesta del proveedor */
  leer(status: number, cuerpo: any): Respuesta;
  /** Encabezados de autenticación */
  cabeceras(): Record<string, string>;
}

export const formatoGenerico: FormatoPse = {
  nombre: "generico",
  emitir: (d) => ({ ruta: "/ecf", metodo: "POST", cuerpo: d }),
  consultar: (trackId) => ({ ruta: `/ecf/${encodeURIComponent(trackId)}` }),
  leer: (_status, c) => ({ estado: mapaEstado(c?.estado), trackId: c?.trackId, mensajes: c?.mensajes ?? c }),
  cabeceras: () => ({ "content-type": "application/json", authorization: `Bearer ${process.env.PSE_TOKEN ?? ""}` }),
};

export function pse(url: string, formatoBase: FormatoPse = formatoGenerico, token?: string): Transmisor {
  const base = url.replace(/\/$/, "");
  // Con llave propia de la empresa se usa esa; sin ella, la del servidor (PSE_TOKEN)
  const formato: FormatoPse = token ? { ...formatoBase, cabeceras: () => ({ "content-type": "application/json", authorization: `Bearer ${token}` }) } : formatoBase;
  /** 401/403: son las credenciales de FactPOS ante el proveedor, no un problema del documento: se reintenta, no se rechaza. */
  const revisar = (r: { status: number; cuerpo: any }) => {
    if (r.status === 401 || r.status === 403) throw new SinConexion(`El proveedor no aceptó las credenciales de FactPOS (${r.status}); se reintenta`);
    return r;
  };
  return {
    /** Prueba básica: se llega al proveedor y no rechaza la llave. Cada proveedor tiene su API; esto no valida un envío. */
    async probar() {
      const r = await http(base, { method: "GET", headers: formato.cabeceras() });
      if (r.status === 401 || r.status === 403) throw new Error(`El proveedor no aceptó la llave (${r.status})`);
    },
    async enviar(d) {
      const p = formato.emitir(d);
      const r = revisar(await http(`${base}${p.ruta}`, { method: p.metodo, headers: formato.cabeceras(), body: JSON.stringify(p.cuerpo) }));
      // Ya lo tiene (un envío anterior llegó pero se perdió la respuesta): no se duplica, se consulta por su número
      if (r.status === 409) return { estado: "EN_PROCESO", trackId: d.encf, mensajes: r.cuerpo };
      if (r.status >= 400) return { estado: "RECHAZADO", mensajes: r.cuerpo };
      return formato.leer(r.status, r.cuerpo);
    },
    async consultar(trackId, d) {
      const p = formato.consultar(trackId, d);
      const r = revisar(await http(`${base}${p.ruta}`, { method: "GET", headers: formato.cabeceras() }));
      if (r.status === 404) return { estado: "EN_PROCESO", trackId, mensajes: r.cuerpo };   // aún no lo ve: se consulta de nuevo
      if (r.status >= 400) return { estado: "RECHAZADO", mensajes: r.cuerpo };
      return formato.leer(r.status, r.cuerpo);
    },
  };
}


// ---------------------------------------------------------------------
/**
 * MSeller (ecf.mseller.app): proveedor autorizado que recibe el e-CF en JSON, lo firma con el certificado de la cuenta
 * de cada cliente y lo transmite a la DGII. Cada cliente tiene su cuenta (correo y clave), su plan y su API Key.
 *   POST {base}/{entorno}/customer/authentication      → idToken (60 min) y refreshToken (30 días)
 *   POST {base}/{entorno}/documentos-ecf               → envío (asíncrono)
 *   GET  {base}/{entorno}/documentos-ecf?ecf={e-NCF}   → estado
 *   POST {base}/{entorno}/customer/void-ncf            → anulación de rangos
 */
export interface CredencialesMseller { email: string; password: string; apiKey: string }
export const MSELLER_URL = "https://ecf.api.mseller.app";
const ENTORNO_MSELLER: Record<string, string> = { TESTECF: "TesteCF", CERTECF: "CerteCF", ECF: "eCF" };

/** Las credenciales de una empresa se guardan cifradas como JSON en la llave del proveedor. */
export function leerCredencialesMseller(texto: string | null | undefined): CredencialesMseller | null {
  try {
    const c = JSON.parse(texto ?? "");
    return c?.email && c?.password && c?.apiKey ? { email: String(c.email), password: String(c.password), apiKey: String(c.apiKey) } : null;
  } catch { return null; }
}

export function estadoMseller(v: unknown): EstadoDgii {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "aceptado") return "ACEPTADO";
  if (s === "aceptado condicional") return "ACEPTADO_COND";
  if (s === "rechazado") return "RECHAZADO";
  return "EN_PROCESO";   // En Cola, Enviado a la DGII, En Proceso, No encontrado, Error: MSeller reintenta por su cuenta
}

export function mseller(cred: CredencialesMseller | null, ambiente: string, base = MSELLER_URL): Transmisor {
  const entorno = ENTORNO_MSELLER[ambiente];
  if (!entorno) throw new Error("MSeller se usa en los ambientes TesteCF, CerteCF o eCF");
  if (!cred) throw new Error("Faltan las credenciales de MSeller (correo, clave y API Key) de esta empresa");
  const url = (ruta: string) => `${base.replace(/\/$/, "")}/${entorno}${ruta}`;
  let idToken = "", refresco = "", vence = 0;

  const tokens = (c: any) => { idToken = c.idToken; if (c.refreshToken) refresco = c.refreshToken; vence = Date.now() + 55 * 60_000; };
  async function autenticar() {
    // Con refreshToken se renueva sin volver a mandar la clave; si falla, se entra de nuevo
    if (refresco && idToken) {
      try {
        const sub = JSON.parse(Buffer.from(idToken.split(".")[1]!, "base64url").toString()).sub;
        const r = await http(url("/customer/authentication"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: refresco, username: sub }) });
        if (r.status === 200 && r.cuerpo.idToken) return tokens(r.cuerpo);
      } catch (e) { if (e instanceof SinConexion) throw e; }
    }
    const r = await http(url("/customer/authentication"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: cred!.email, password: cred!.password }) });
    if (r.status !== 200 || !r.cuerpo.idToken) throw new SinConexion(`MSeller no aceptó el correo y la clave de esta empresa (${r.status}); se reintenta`);
    tokens(r.cuerpo);
  }
  const cabeceras = () => ({ authorization: `Bearer ${idToken}`, "x-api-key": cred!.apiKey, "content-type": "application/json" });
  async function conSesion(f: () => Promise<{ status: number; cuerpo: any }>) {
    if (!idToken || Date.now() > vence) await autenticar();
    let r = await f();
    if (r.status === 401) { idToken = ""; await autenticar(); r = await f(); }
    if (r.status === 401 || r.status === 403) throw new SinConexion(`MSeller no aceptó las credenciales o la API Key (${r.status}); se reintenta`);
    return r;
  }
  const resultado = (c: any): Respuesta => ({ estado: estadoMseller(c?.status), trackId: c?.ecf ?? c?.ncf, mensajes: c });

  return {
    /** Comprueba el correo, la clave y la API Key: entra a MSeller y consulta un comprobante que no existe. */
    async probar() {
      await autenticar();
      const r = await http(url("/documentos-ecf?ecf=E000000000000"), { method: "GET", headers: cabeceras() });
      if (r.status === 401) throw new Error("MSeller no aceptó el acceso (401)");
      if (r.status === 403) throw new Error("La API Key no es válida (403)");
    },
    async enviar(d) {
      const xml = d.xmlCompleto ?? d.xml;
      const r = await conSesion(() => http(url("/documentos-ecf"), { method: "POST", headers: cabeceras(), body: JSON.stringify(ecfXmlAJson(xml)) }));
      if (r.status === 409) return { estado: "EN_PROCESO", trackId: d.encf, mensajes: r.cuerpo };   // ya lo tiene: se consulta
      if (r.status >= 400) return { estado: "RECHAZADO", mensajes: r.cuerpo };
      // securityCode y qr_url los genera MSeller con su firma: son los que deben ir en la representación impresa
      return { estado: "EN_PROCESO", trackId: r.cuerpo?.ecf ?? d.encf, mensajes: r.cuerpo };
    },
    async consultar(trackId) {
      const r = await conSesion(() => http(url(`/documentos-ecf?ecf=${encodeURIComponent(trackId)}`), { method: "GET", headers: cabeceras() }));
      if (r.status === 404) return { estado: "EN_PROCESO", trackId, mensajes: r.cuerpo };
      if (r.status >= 400) return { estado: "RECHAZADO", mensajes: r.cuerpo };
      return resultado(r.cuerpo);
    },
  };
}

/** Elige el transmisor del proveedor (PSE) de una empresa según su nombre: MSeller tiene adaptador propio; los demás, el formato genérico. */
export function transmisorPse(cfg: { pse_nombre?: string | null; pse_url?: string | null; pse_token?: string | null; ambiente?: string | null }, token: string | null): Transmisor | null {
  if (/mseller/i.test(cfg.pse_nombre ?? "")) return mseller(leerCredencialesMseller(token), cfg.ambiente ?? "", cfg.pse_url || MSELLER_URL);
  const url = cfg.pse_url || process.env.PSE_URL;
  return url ? pse(url, undefined, token ?? undefined) : null;
}
