import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import nodemailer from "nodemailer";
import { pool } from "../db.js";

/**
 * Conexión de correo de la empresa (Administración › Correo y envíos).
 *   - SMTP: Gmail, Outlook/Microsoft 365, Zoho, el correo del hosting…
 *   - Resend: servicio por API (solo una clave).
 * La contraseña (o la clave de Resend) se guarda cifrada con PIN_SECRETO.
 */
export interface ConfigCorreo {
  metodo: "SMTP" | "RESEND";
  smtpServidor: string | null;
  smtpPuerto: number | null;
  smtpSeguridad: "SSL" | "STARTTLS" | "NINGUNA";
  usuario: string | null;
  tieneClave: boolean;
  remitenteNombre: string | null;
  remitenteCorreo: string | null;
  responderA: string | null;
  probadoEn: string | null;
  pruebaOk: boolean | null;
  pruebaError: string | null;
}

export interface Correo {
  para: string[];
  asunto: string;
  html: string;
  texto: string;
  adjuntos?: { nombre: string; contenido: string; tipo?: string }[];
}

// ------------------------------------------------------------------ cifrado
function llave() {
  const s = process.env.PIN_SECRETO;
  if (!s) throw new Error("Falta PIN_SECRETO en el servidor: sin él no se puede guardar la contraseña del correo");
  return scryptSync(s, "factpos:correo", 32);
}
export function cifrarClave(texto: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave(), iv);
  const d = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), d]).toString("base64")}`;
}
function descifrarClave(texto: string) {
  const crudo = Buffer.from(texto.slice(3), "base64");
  try {
    const d = createDecipheriv("aes-256-gcm", llave(), crudo.subarray(0, 12));
    d.setAuthTag(crudo.subarray(12, 28));
    return Buffer.concat([d.update(crudo.subarray(28)), d.final()]).toString("utf8");
  } catch {
    throw new Error("No se pudo leer la contraseña guardada del correo (¿cambió PIN_SECRETO?). Escríbala de nuevo.");
  }
}

// ------------------------------------------------------------------ lectura
const SELECT = `SELECT metodo, smtp_servidor AS "smtpServidor", smtp_puerto AS "smtpPuerto", smtp_seguridad AS "smtpSeguridad",
                       usuario, clave_cifrada IS NOT NULL AS "tieneClave", remitente_nombre AS "remitenteNombre",
                       remitente_correo AS "remitenteCorreo", responder_a AS "responderA", probado_en AS "probadoEn",
                       prueba_ok AS "pruebaOk", prueba_error AS "pruebaError", clave_cifrada
                  FROM configuracion_correo WHERE empresa_id = $1`;

export async function leerConfigCorreo(empresaId: string): Promise<ConfigCorreo | null> {
  const r = await pool.query(SELECT, [empresaId]);
  if (!r.rows[0]) return null;
  const { clave_cifrada: _omitida, ...c } = r.rows[0];
  return c;
}

/** ¿Hay una conexión de correo lista para enviar? */
export async function correoListo(empresaId: string) {
  const r = await pool.query(SELECT, [empresaId]).catch(() => null);
  const c = r?.rows[0];
  if (!c?.clave_cifrada || !c.remitenteCorreo) return false;
  return c.metodo === "RESEND" || !!c.smtpServidor;
}

// ------------------------------------------------------------------ envío
const nombreDe = (c: { remitenteNombre: string | null; remitenteCorreo: string | null }) =>
  c.remitenteNombre ? `"${c.remitenteNombre.replace(/"/g, "")}" <${c.remitenteCorreo}>` : c.remitenteCorreo!;

/** Explica en palabras simples los errores típicos del SMTP. */
export function explicarError(e: Error & { code?: string; responseCode?: number }): string {
  const m = e.message ?? "";
  if (e.code === "EAUTH" || e.responseCode === 535 || /auth|credentials|Username and Password/i.test(m)) {
    return /gmail|google/i.test(m) || /5\.7\.8/.test(m)
      ? "Usuario o contraseña rechazados. En Gmail use una «contraseña de aplicación» (Cuenta de Google › Seguridad › Verificación en 2 pasos › Contraseñas de aplicaciones), no su contraseña normal."
      : "El servidor de correo rechazó el usuario o la contraseña.";
  }
  if (e.code === "ESOCKET" && /wrong version number|ssl/i.test(m)) return "La seguridad no coincide con el puerto: use SSL con el puerto 465, o STARTTLS con el 587.";
  if (/ECONNREFUSED/.test(m)) return "El servidor de correo no acepta conexiones en ese puerto (revise el servidor y el puerto).";
  if (e.code === "ETIMEDOUT" || e.code === "ECONNECTION" || /timeout/i.test(m)) return "No se pudo conectar con el servidor de correo (revise el servidor y el puerto).";
  if (e.code === "EDNS" || /ENOTFOUND/.test(m)) return "No existe ese servidor de correo: revise el nombre (por ejemplo smtp.gmail.com).";
  if (e.code === "EENVELOPE" || /recipient|550/i.test(m)) return `El servidor no aceptó la dirección: ${m.slice(0, 160)}`;
  return m.slice(0, 300) || "Error desconocido al enviar el correo";
}

export async function enviarCorreo(empresaId: string, correo: Correo, configNueva?: { clave?: string } & Partial<ConfigCorreo>) {
  const r = await pool.query(SELECT, [empresaId]);
  const guardada = r.rows[0];
  // Para probar antes de guardar se puede pasar la configuración del formulario
  const c = { ...(guardada ?? {}), ...(configNueva ?? {}) } as ConfigCorreo & { clave_cifrada?: string };
  const clave = configNueva?.clave || (guardada?.clave_cifrada ? descifrarClave(guardada.clave_cifrada) : "");
  if (!c.remitenteCorreo) throw new Error("Falta el correo del remitente");
  if (!clave) throw new Error(c.metodo === "RESEND" ? "Falta la clave de Resend" : "Falta la contraseña del correo");
  const para = [...new Set(correo.para.map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!para.length) throw new Error("No hay destinatarios");

  if (c.metodo === "RESEND") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        from: nombreDe(c), to: para, subject: correo.asunto, html: correo.html, text: correo.texto,
        ...(c.responderA ? { reply_to: c.responderA } : {}),
        ...(correo.adjuntos?.length ? { attachments: correo.adjuntos.map((a) => ({ filename: a.nombre, content: Buffer.from(a.contenido).toString("base64") })) } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const t = await res.text();
      let msg = t;
      try { msg = JSON.parse(t).message ?? t; } catch { /* texto */ }
      throw new Error(res.status === 401 || res.status === 403 ? `Resend rechazó la clave o el remitente (${msg.slice(0, 160)})` : `Resend respondió ${res.status}: ${msg.slice(0, 200)}`);
    }
    return { id: ((await res.json()) as { id?: string }).id ?? null };
  }

  if (!c.smtpServidor) throw new Error("Falta el servidor SMTP");
  const t = nodemailer.createTransport({
    host: c.smtpServidor,
    port: c.smtpPuerto ?? (c.smtpSeguridad === "SSL" ? 465 : 587),
    secure: c.smtpSeguridad === "SSL",
    requireTLS: c.smtpSeguridad === "STARTTLS",
    ignoreTLS: c.smtpSeguridad === "NINGUNA",
    auth: { user: c.usuario || c.remitenteCorreo, pass: clave },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  try {
    const info = await t.sendMail({
      from: nombreDe(c), to: para, subject: correo.asunto, html: correo.html, text: correo.texto,
      ...(c.responderA ? { replyTo: c.responderA } : {}),
      attachments: correo.adjuntos?.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo })),
    });
    return { id: info.messageId ?? null };
  } catch (e) {
    throw new Error(explicarError(e as Error));
  } finally {
    t.close();
  }
}
