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
export interface DocumentoEnvio { encf: string; tipo: string; modo: "ECF" | "RFCE"; xml: string; rncEmisor: string }

export interface Transmisor {
  enviar(d: DocumentoEnvio): Promise<Respuesta>;
  consultar(trackId: string, d: DocumentoEnvio): Promise<Respuesta>;
  /** Prueba de conexión y autenticación (solo el envío directo a la DGII). Lanza si falla. */
  probar?(): Promise<void>;
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
  if (r.status >= 500) throw new SinConexion(`Servicio no disponible (${r.status})`);
  let cuerpo: any;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = { texto }; }
  return { status: r.status, cuerpo };
}

const archivo = (xml: string, nombre: string) => {
  const f = new FormData();
  f.append("xml", new Blob([xml], { type: "text/xml" }), nombre);
  return f;
};

function mapaEstado(v: unknown): EstadoDgii {
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

  return {
    async probar() { token = null; await autenticar(); },
    async enviar(d) {
      const t = await autenticar();
      const url = d.modo === "RFCE" ? `${baseFc}/recepcionfc/api/recepcion/ecf` : `${base}/recepcion/api/FacturasElectronicas`;
      const r = await http(url, {
        method: "POST", headers: { authorization: `Bearer ${t}` }, body: archivo(d.xml, `${d.rncEmisor}${d.encf}.xml`),
      });
      if (r.status >= 400) return { estado: "RECHAZADO", mensajes: r.cuerpo };
      if (d.modo === "RFCE") return { estado: mapaEstado(r.cuerpo.estado), mensajes: r.cuerpo.mensajes ?? r.cuerpo };
      return { estado: "EN_PROCESO", trackId: r.cuerpo.trackId, mensajes: r.cuerpo };
    },
    async consultar(trackId) {
      const t = await autenticar();
      const r = await http(`${base}/consultaresultado/api/Consultas/Estado?TrackId=${encodeURIComponent(trackId)}`, {
        method: "GET", headers: { authorization: `Bearer ${t}` },
      });
      return { estado: mapaEstado(r.cuerpo.estado), mensajes: r.cuerpo.mensajes ?? r.cuerpo };
    },
  };
}

// ---------------------------------------------------------------------
export function pse(url: string): Transmisor {
  const cab = { "content-type": "application/json", authorization: `Bearer ${process.env.PSE_TOKEN ?? ""}` };
  return {
    async enviar(d) {
      const r = await http(`${url.replace(/\/$/, "")}/ecf`, { method: "POST", headers: cab, body: JSON.stringify(d) });
      if (r.status >= 400) return { estado: "RECHAZADO", mensajes: r.cuerpo };
      return { estado: mapaEstado(r.cuerpo.estado), trackId: r.cuerpo.trackId, mensajes: r.cuerpo.mensajes };
    },
    async consultar(trackId) {
      const r = await http(`${url.replace(/\/$/, "")}/ecf/${encodeURIComponent(trackId)}`, { method: "GET", headers: cab });
      return { estado: mapaEstado(r.cuerpo.estado), mensajes: r.cuerpo.mensajes };
    },
  };
}
