import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { uuidv7 } from "@factpos/compartido";
import { pool } from "../db.js";
import { certificado, leerP12, usarCertificado, type Certificado } from "./firma.js";

/**
 * Certificado digital subido en la Administración.
 *
 * El .p12 y su contraseña se guardan juntos y CIFRADOS (AES-256-GCM). La llave
 * sale de PIN_SECRETO, que es igual en la central y en todas las sucursales:
 * así la central lo guarda, cada sucursal lo baja tal cual y lo puede abrir,
 * y en la base de datos nunca queda la contraseña a la vista.
 */
const VERSION = "v1";

function llave() {
  const s = process.env.PIN_SECRETO;
  if (!s) throw new Error("Falta PIN_SECRETO en este servidor: sin él no se puede guardar ni abrir el certificado");
  return scryptSync(s, "factpos:certificado-digital", 32);
}

export function cifrar(p12: Buffer, clave: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave(), iv);
  const datos = Buffer.concat([c.update(JSON.stringify({ p12: p12.toString("base64"), clave }), "utf8"), c.final()]);
  return `${VERSION}:${Buffer.concat([iv, c.getAuthTag(), datos]).toString("base64")}`;
}

export function descifrar(texto: string): { p12: Buffer; clave: string } {
  const [v, b64] = texto.split(":");
  if (v !== VERSION || !b64) throw new Error("Formato de certificado guardado desconocido");
  const crudo = Buffer.from(b64, "base64");
  try {
    const d = createDecipheriv("aes-256-gcm", llave(), crudo.subarray(0, 12));
    d.setAuthTag(crudo.subarray(12, 28));
    const json = Buffer.concat([d.update(crudo.subarray(28)), d.final()]).toString("utf8");
    const o = JSON.parse(json) as { p12: string; clave: string };
    return { p12: Buffer.from(o.p12, "base64"), clave: o.clave };
  } catch {
    throw new Error("No se pudo abrir el certificado: el PIN_SECRETO de este servidor no es el mismo de la central");
  }
}

export interface FilaCertificado {
  id: string; empresa_id: string; titular: string; emisor: string | null; numero_serie: string | null;
  valido_desde: string; vence: string; huella: string; cifrado: string; subido_por: string | null; subido_en: string;
}

/** Guarda un certificado como el activo de la empresa (el anterior queda inactivo). */
export async function guardarCertificado(
  c: { query: typeof pool.query },
  empresaId: string,
  datos: { p12: Buffer; clave: string } | FilaCertificado,
  usuarioId: string | null,
): Promise<Certificado & { id: string }> {
  let fila: Omit<FilaCertificado, "empresa_id">;
  let cert: Certificado;
  if ("p12" in datos) {
    cert = leerP12(datos.p12, datos.clave);
    fila = {
      id: uuidv7(), titular: cert.titular, emisor: cert.emisor ?? null, numero_serie: cert.numeroSerie ?? null,
      valido_desde: cert.validoDesde!.toISOString(), vence: cert.vence.toISOString(), huella: cert.huella!,
      cifrado: cifrar(datos.p12, datos.clave), subido_por: usuarioId, subido_en: new Date().toISOString(),
    };
  } else {
    // Viene de la central: se comprueba que se pueda abrir antes de reemplazar el que hay
    const d = descifrar(datos.cifrado);
    cert = leerP12(d.p12, d.clave);
    fila = datos;
  }
  await c.query("UPDATE certificados_digitales SET activo = FALSE WHERE empresa_id = $1 AND activo AND id <> $2", [empresaId, fila.id]);
  await c.query(
    `INSERT INTO certificados_digitales (id, empresa_id, titular, emisor, numero_serie, valido_desde, vence, huella, cifrado, activo, subido_por, subido_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11)
     ON CONFLICT (id) DO UPDATE SET activo = TRUE`,
    [fila.id, empresaId, fila.titular, fila.emisor, fila.numero_serie, fila.valido_desde, fila.vence, fila.huella, fila.cifrado, fila.subido_por, fila.subido_en],
  );
  return { ...cert, id: fila.id };
}

/** Al arrancar un servidor que firma (sucursal o PC de prueba): usa el certificado guardado, si hay. */
export async function cargarCertificadoGuardado(log: (m: string) => void) {
  if (process.env.CERT_P12_RUTA) return; // manda el archivo del .env
  // En una sucursal: solo si la Administración se lo activó
  const suc = process.env.SUCURSAL_ID;
  if (suc && /^[0-9a-f-]{36}$/i.test(suc)) {
    const h = await pool.query<{ habilitado: boolean }>("SELECT certificado_habilitado AS habilitado FROM sucursales WHERE id = $1", [suc]).catch(() => null);
    if (h?.rows[0] && !h.rows[0].habilitado) return;
  }
  const r = await pool.query<FilaCertificado>(
    "SELECT * FROM certificados_digitales WHERE activo ORDER BY subido_en DESC LIMIT 1",
  ).catch(() => null); // base sin la migración todavía
  const f = r?.rows[0];
  if (!f) return;
  try {
    const d = descifrar(f.cifrado);
    usarCertificado(leerP12(d.p12, d.clave));
  } catch (e) {
    log(`e-CF: el certificado guardado no se pudo usar: ${(e as Error).message}`);
  }
}

/** Lo que este servidor informa a la central: qué certificado tiene en uso. */
export function huellaEnUso(): string | null {
  try {
    const c = certificado();
    return c.prueba ? null : c.huella ?? null;
  } catch {
    return null;
  }
}
