import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

/**
 * Licencias de FactPOS.
 *
 * El proveedor (portal) FIRMA cada licencia con su llave privada Ed25519
 * (variable LICENCIAS_CLAVE_PRIVADA, solo en el portal). Las instalaciones de
 * los clientes la VERIFICAN con la llave pública que viene en el código: no
 * necesitan preguntarle al portal en cada venta y funcionan sin internet.
 *
 * Licencia = base64url(JSON) + "." + base64url(firma)
 *
 * Estados (por sucursal se cobra; "sucursales" es el máximo de tiendas activas):
 *   VIGENTE      todo normal
 *   POR_VENCER   faltan 15 días o menos: aviso
 *   GRACIA       venció hace 7 días o menos: aviso fuerte, sigue vendiendo
 *   VENCIDA      pasó la gracia: solo consulta y reportes (no vende). No se borra nada.
 *   PRUEBA       sin licencia todavía: 15 días desde la primera instalación
 *   PRUEBA_VENCIDA
 */
export const LLAVE_PUBLICA_PROVEEDOR = "MCowBQYDK2VwAyEALySfqQ5dbsXt3Jkdqa4qs33cIVtc8NEEpRwT3lqhXMY=";

export const DIAS_AVISO = 15;
export const DIAS_GRACIA = 7;
export const DIAS_PRUEBA = 15;

export interface DatosLicencia {
  v: 1;
  id: string;                // licencia en el portal
  cliente: { id: string; nombre: string; slug: string; rnc: string | null };
  instalacion: string;       // nube del cliente a la que se activó
  sucursales: number;        // máximo de sucursales (tiendas) activas
  modulos: string[];
  plan?: string;             // nombre del plan contratado (informativo)
  emitida: string;           // ISO
  vence: string;             // AAAA-MM-DD (incluido)
}

export type EstadoLicencia = "VIGENTE" | "POR_VENCER" | "GRACIA" | "VENCIDA" | "PRUEBA" | "PRUEBA_VENCIDA";

export interface ResultadoLicencia {
  estado: EstadoLicencia;
  /** false = no se puede vender (solo consulta y reportes) */
  permiteVender: boolean;
  /** Días hasta el vencimiento (negativo si ya venció) o hasta el fin de la prueba */
  dias: number;
  mensaje: string | null;
  datos: DatosLicencia | null;
  /** La licencia guardada no pasó la verificación (firma o instalación) */
  error?: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function firmarLicencia(datos: DatosLicencia, llavePrivadaB64: string) {
  const llave = createPrivateKey({ key: Buffer.from(llavePrivadaB64, "base64"), format: "der", type: "pkcs8" });
  const cuerpo = b64(JSON.stringify(datos));
  return `${cuerpo}.${b64(sign(null, Buffer.from(cuerpo), llave))}`;
}

let publica: ReturnType<typeof createPublicKey> | null = null;
export function leerLicencia(token: string): DatosLicencia {
  const [cuerpo, firma] = token.trim().split(".");
  if (!cuerpo || !firma) throw new Error("La licencia no tiene el formato correcto");
  publica ??= createPublicKey({ key: Buffer.from(process.env.LICENCIAS_CLAVE_PUBLICA || LLAVE_PUBLICA_PROVEEDOR, "base64"), format: "der", type: "spki" });
  if (!verify(null, Buffer.from(cuerpo), publica, Buffer.from(firma, "base64url"))) throw new Error("La firma de la licencia no es válida");
  const d = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as DatosLicencia;
  if (d.v !== 1) throw new Error("Versión de licencia desconocida");
  return d;
}

const DIA = 86_400_000;
/** Días enteros desde hoy hasta el final del día `vence` (AAAA-MM-DD, hora de Santo Domingo). */
function diasHasta(vence: string, ahora: Date) {
  const fin = new Date(`${vence}T23:59:59-04:00`).getTime();
  return Math.ceil((fin - ahora.getTime()) / DIA) - 1;
}
const fecha = (iso: string) => new Date(`${iso}T12:00:00-04:00`).toLocaleDateString("es-DO", { day: "numeric", month: "long", year: "numeric" });

/** Estado de la licencia de una instalación (o de su prueba si no tiene). */
export function evaluarLicencia(token: string | null | undefined, opciones: { instalacion?: string | null; pruebaDesde?: Date | string | null; ahora?: Date } = {}): ResultadoLicencia {
  const ahora = opciones.ahora ?? new Date();
  let datos: DatosLicencia | null = null;
  let error: string | undefined;
  if (token) {
    try {
      datos = leerLicencia(token);
      if (opciones.instalacion && datos.instalacion !== opciones.instalacion) throw new Error("La licencia es de otra instalación");
    } catch (e) { error = (e as Error).message; datos = null; }
  }

  if (!datos) {
    const desde = opciones.pruebaDesde ? new Date(opciones.pruebaDesde) : ahora;
    const dias = DIAS_PRUEBA - Math.floor((ahora.getTime() - desde.getTime()) / DIA);
    if (dias > 0) {
      return { estado: "PRUEBA", permiteVender: true, dias, datos: null, error,
        mensaje: `Versión de prueba: quedan ${dias} día(s). Active su licencia en Administración › Licencia.` };
    }
    return { estado: "PRUEBA_VENCIDA", permiteVender: false, dias, datos: null, error,
      mensaje: "Terminó el periodo de prueba. Active su licencia en Administración › Licencia para seguir vendiendo." };
  }

  const dias = diasHasta(datos.vence, ahora);
  if (dias >= DIAS_AVISO) return { estado: "VIGENTE", permiteVender: true, dias, datos, mensaje: null };
  if (dias >= 0) {
    return { estado: "POR_VENCER", permiteVender: true, dias, datos,
      mensaje: dias === 0 ? "Su licencia de FactPOS vence hoy. Renuévela para no interrumpir la operación."
        : `Su licencia de FactPOS vence el ${fecha(datos.vence)} (en ${dias} día${dias === 1 ? "" : "s"}). Renuévela con su proveedor.` };
  }
  if (dias >= -DIAS_GRACIA) {
    const quedan = DIAS_GRACIA + dias;
    return { estado: "GRACIA", permiteVender: true, dias, datos,
      mensaje: `Su licencia venció el ${fecha(datos.vence)}. Le quedan ${quedan} día(s) de gracia; después solo podrá consultar.` };
  }
  return { estado: "VENCIDA", permiteVender: false, dias, datos,
    mensaje: `La licencia venció el ${fecha(datos.vence)}. El sistema quedó en modo consulta (no se pierde nada). Renuévela con su proveedor.` };
}
