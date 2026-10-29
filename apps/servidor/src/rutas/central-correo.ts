import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";
import { cifrarClave, enviarCorreo, leerConfigCorreo } from "../correo/transporte.js";
import { construir, marcaDe, procesarEnvios, type TipoEnvio } from "../correo/envios.js";
import { correoPrueba } from "../correo/plantillas.js";
import { olvidarCanales } from "../incidentes.js";

/**
 * Administración › Correo y envíos:
 *   - la conexión de correo (SMTP o Resend) y su prueba;
 *   - qué se envía (cierres de caja, resumen diario, incidentes) y a quién;
 *   - la bitácora de lo enviado, con reenvío y vista previa.
 */
const uuid = z.string().uuid();
const correo = z.string().trim().toLowerCase().email("Correo inválido").max(120);
const TIPOS = ["CIERRE_CAJA", "RESUMEN_DIARIO", "INCIDENTES"] as const;

const esquemaConfig = z.object({
  metodo: z.enum(["SMTP", "RESEND"]),
  smtpServidor: z.string().trim().max(120).nullable().optional(),
  smtpPuerto: z.number().int().min(1).max(65535).nullable().optional(),
  smtpSeguridad: z.enum(["SSL", "STARTTLS", "NINGUNA"]).default("SSL"),
  usuario: z.string().trim().max(120).nullable().optional(),
  /** Vacío = dejar la que está guardada */
  clave: z.string().max(300).optional(),
  remitenteNombre: z.string().trim().max(80).nullable().optional(),
  remitenteCorreo: correo,
  responderA: correo.nullable().optional().or(z.literal("").transform(() => null)),
}).refine((c) => c.metodo === "RESEND" || !!c.smtpServidor, { message: "Escriba el servidor SMTP", path: ["smtpServidor"] });

export async function rutasCentralCorreo(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.safeParse(req.headers["x-usuario-id"]).data ?? null;
  const nombreDe = (req: unknown) => (req as { sesion?: { n: string } }).sesion?.n ?? "la administración";

  app.get("/central/correo", async (req) => {
    const e = empresaDe(req);
    const [config, envios] = await Promise.all([
      leerConfigCorreo(e),
      pool.query(
        `SELECT tipo, activo, destinatarios, sucursales, hora, solo_con_diferencia AS "soloConDiferencia", activado_en AS "activadoEn",
                (SELECT MAX(c.enviado_en) FROM correos_enviados c WHERE c.empresa_id = x.empresa_id AND c.tipo = x.tipo AND c.estado = 'ENVIADO') AS "ultimoEnvio"
           FROM envios_correo x WHERE empresa_id = $1`,
        [e],
      ),
    ]);
    const porTipo = Object.fromEntries(envios.rows.map((r) => [r.tipo, r]));
    return {
      config,
      envios: TIPOS.map((t) => porTipo[t] ?? { tipo: t, activo: false, destinatarios: [], sucursales: null, hora: 7, soloConDiferencia: false, activadoEn: null, ultimoEnvio: null }),
      cron: !!process.env.CRON_SECRET || !process.env.VERCEL,
    };
  });

  /** Guardar la conexión. */
  app.put("/central/correo/config", async (req) => {
    const e = empresaDe(req);
    const b = esquemaConfig.parse(req.body);
    const previa = await pool.query("SELECT clave_cifrada FROM configuracion_correo WHERE empresa_id = $1", [e]);
    if (!b.clave && !previa.rows[0]?.clave_cifrada) throw new ErrorNegocio(b.metodo === "RESEND" ? "Escriba la clave de Resend" : "Escriba la contraseña del correo");
    await pool.query(
      `INSERT INTO configuracion_correo (empresa_id, metodo, smtp_servidor, smtp_puerto, smtp_seguridad, usuario, clave_cifrada,
                                         remitente_nombre, remitente_correo, responder_a, actualizado_en, actualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11)
       ON CONFLICT (empresa_id) DO UPDATE SET metodo = $2, smtp_servidor = $3, smtp_puerto = $4, smtp_seguridad = $5, usuario = $6,
              clave_cifrada = COALESCE($7, configuracion_correo.clave_cifrada), remitente_nombre = $8, remitente_correo = $9,
              responder_a = $10, actualizado_en = now(), actualizado_por = $11,
              probado_en = NULL, prueba_ok = NULL, prueba_error = NULL`,
      [e, b.metodo, b.metodo === "SMTP" ? b.smtpServidor : null, b.metodo === "SMTP" ? b.smtpPuerto ?? null : null, b.smtpSeguridad,
       b.metodo === "SMTP" ? b.usuario || null : null, b.clave ? cifrarClave(b.clave) : null,
       b.remitenteNombre || null, b.remitenteCorreo, b.responderA || null, usuarioDe(req)],
    );
    olvidarCanales();
    return { ok: true };
  });

  /** Enviar un correo de prueba con lo guardado (o con lo que está en el formulario, sin guardarlo). */
  app.post("/central/correo/prueba", async (req) => {
    const e = empresaDe(req);
    const b = z.object({ para: correo, config: esquemaConfig.optional() }).parse(req.body);
    const c = correoPrueba(await marcaDe(e), nombreDe(req));
    try {
      await enviarCorreo(e, { para: [b.para], ...c }, b.config ? { ...b.config, clave: b.config.clave || undefined } as never : undefined);
      if (!b.config) await pool.query("UPDATE configuracion_correo SET probado_en = now(), prueba_ok = TRUE, prueba_error = NULL WHERE empresa_id = $1", [e]);
      return { ok: true };
    } catch (err) {
      const msg = (err as Error).message;
      if (!b.config) await pool.query("UPDATE configuracion_correo SET probado_en = now(), prueba_ok = FALSE, prueba_error = $2 WHERE empresa_id = $1", [e, msg]);
      throw new ErrorNegocio(msg, 400);
    }
  });

  /** Configurar un envío automático. */
  app.put("/central/correo/envios/:tipo", async (req) => {
    const e = empresaDe(req);
    const { tipo } = z.object({ tipo: z.enum(TIPOS) }).parse(req.params);
    const b = z.object({
      activo: z.boolean(),
      destinatarios: z.array(correo).max(20),
      sucursales: z.array(uuid).min(1).max(500).nullable().default(null),
      hora: z.number().int().min(0).max(23).default(7),
      soloConDiferencia: z.boolean().default(false),
    }).refine((x) => !x.activo || x.destinatarios.length > 0, { message: "Agregue al menos un correo para activarlo", path: ["destinatarios"] })
      .parse(req.body);
    if (b.activo) {
      const c = await pool.query("SELECT clave_cifrada IS NOT NULL AS lista FROM configuracion_correo WHERE empresa_id = $1", [e]);
      if (!c.rows[0]?.lista) throw new ErrorNegocio("Primero configure la conexión de correo (arriba) y guárdela");
    }
    await pool.query(
      `INSERT INTO envios_correo (empresa_id, tipo, activo, destinatarios, sucursales, hora, solo_con_diferencia, activado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $3 THEN now() END)
       ON CONFLICT (empresa_id, tipo) DO UPDATE SET activo = $3, destinatarios = $4, sucursales = $5, hora = $6, solo_con_diferencia = $7,
              activado_en = CASE WHEN $3 AND NOT envios_correo.activo THEN now() WHEN $3 THEN envios_correo.activado_en END`,
      [e, tipo, b.activo, [...new Set(b.destinatarios)], b.sucursales, b.hora, b.soloConDiferencia],
    );
    olvidarCanales();
    return { ok: true };
  });

  /** Bitácora de correos enviados. */
  app.get("/central/correo/historial", async (req) => {
    const r = await pool.query(
      `SELECT id, tipo, clave, asunto, destinatarios, estado, intentos, error, creado_en AS "creadoEn", enviado_en AS "enviadoEn",
              proximo_intento AS "proximoIntento"
         FROM correos_enviados WHERE empresa_id = $1 ORDER BY creado_en DESC LIMIT 100`,
      [empresaDe(req)],
    );
    return r.rows;
  });

  /** Reenviar uno de la bitácora (a los destinatarios actuales del envío). */
  app.post("/central/correo/historial/:id/reenviar", async (req) => {
    const e = empresaDe(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const h = (await pool.query("SELECT tipo, clave FROM correos_enviados WHERE id = $1 AND empresa_id = $2", [id, e])).rows[0];
    if (!h) throw new ErrorNegocio("No encontrado", 404);
    const env = (await pool.query("SELECT destinatarios, sucursales FROM envios_correo WHERE empresa_id = $1 AND tipo = $2", [e, h.tipo])).rows[0];
    if (!env?.destinatarios?.length) throw new ErrorNegocio("Ese envío no tiene destinatarios");
    const c = await construir(e, h.tipo as TipoEnvio, h.clave, env.sucursales);
    try {
      await enviarCorreo(e, { para: env.destinatarios, ...c });
    } catch (err) {
      throw new ErrorNegocio((err as Error).message, 400);
    }
    await pool.query(
      "UPDATE correos_enviados SET estado = 'ENVIADO', enviado_en = now(), error = NULL, asunto = $2, destinatarios = $3 WHERE id = $1",
      [id, c.asunto, env.destinatarios],
    );
    return { ok: true };
  });

  /**
   * Vista previa: el último cierre de caja o el resumen de ayer, tal como se
   * enviaría (HTML). Con ?enviar=correo@… se manda solo a esa dirección.
   */
  app.get("/central/correo/vista-previa/:tipo", async (req, rep) => {
    const e = empresaDe(req);
    const { tipo } = z.object({ tipo: z.enum(["CIERRE_CAJA", "RESUMEN_DIARIO"]) }).parse(req.params);
    const env = (await pool.query("SELECT sucursales FROM envios_correo WHERE empresa_id = $1 AND tipo = $2", [e, tipo])).rows[0];
    let clave: string | undefined;
    if (tipo === "CIERRE_CAJA") {
      clave = (await pool.query(
        `SELECT t.id FROM turnos t JOIN sucursales s ON s.id = t.sucursal_id WHERE s.empresa_id = $1 AND t.estado = 'CERRADO'
          ORDER BY t.cerrado_en DESC LIMIT 1`, [e])).rows[0]?.id;
      if (!clave) throw new ErrorNegocio("Todavía no hay ningún cierre de caja para mostrar", 404);
    } else {
      // El día anterior con ventas (o ayer)
      clave = (await pool.query(
        `SELECT to_char(COALESCE(MAX(v.fecha), (now() AT TIME ZONE 'America/Santo_Domingo')::date - 1), 'YYYY-MM-DD') AS f
           FROM rpt_ventas_diarias v JOIN sucursales s ON s.id = v.sucursal_id
          WHERE s.empresa_id = $1 AND v.fecha < (now() AT TIME ZONE 'America/Santo_Domingo')::date`, [e])).rows[0].f;
    }
    const c = await construir(e, tipo, clave!, env?.sucursales ?? null);
    rep.header("content-type", "text/html; charset=utf-8");
    return c.html;
  });

  /** Correr ya los envíos pendientes (botón "Enviar pendientes ahora"). */
  app.post("/central/correo/procesar", async (req) => procesarEnvios((m) => req.log.warn(m)));
}
