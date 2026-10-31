import { sucursalesDe } from "../sesion.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { guardarCertificado, huellaEnUso } from "../fiscal/certificado-guardado.js";
import { usarCertificado } from "../fiscal/firma.js";

/**
 * Administración de la facturación electrónica (central):
 * configuración fiscal, rangos autorizados por la DGII, bloques por
 * sucursal y monitoreo de los envíos.
 */
const uuid = z.string().uuid();
const TIPOS = ["E31", "E32", "E33", "E34", "E41", "E43", "E44", "E45", "E46", "E47"] as const;

export async function rutasCentralFiscal(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  app.get("/central/fiscal/config", async (req) => {
    const e = empresaDe(req);
    const r = await pool.query(
      `SELECT e.rnc, e.razon_social AS "razonSocial", e.nombre_comercial AS "nombreComercial",
              COALESCE(cf.direccion_emisor, '') AS "direccionEmisor", COALESCE(cf.ambiente, 'SIMULADO') AS ambiente,
              COALESCE(cf.transmisor, 'SIMULADO') AS transmisor, cf.pse_url AS "pseUrl",
              COALESCE(cf.alerta_restantes, 500) AS "alertaRestantes"
         FROM empresas e LEFT JOIN configuracion_fiscal cf ON cf.empresa_id = e.id WHERE e.id = $1`,
      [e],
    );
    return r.rows[0];
  });

  app.put("/central/fiscal/config", async (req) => {
    const b = z
      .object({
        direccionEmisor: z.string().trim().min(5).max(200),
        ambiente: z.enum(["SIMULADO", "TESTECF", "CERTECF", "ECF"]),
        transmisor: z.enum(["SIMULADO", "DGII", "PSE"]),
        pseUrl: z.string().url().nullable().optional(),
        alertaRestantes: z.number().int().min(0).default(500),
      })
      .refine((x) => x.transmisor !== "PSE" || !!x.pseUrl, "Indique la dirección del PSE")
      .refine((x) => (x.ambiente === "SIMULADO") === (x.transmisor === "SIMULADO"), "El transmisor simulado solo se usa en el ambiente simulado")
      .parse(req.body);
    await pool.query(
      `INSERT INTO configuracion_fiscal (empresa_id, direccion_emisor, ambiente, transmisor, pse_url, alerta_restantes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (empresa_id) DO UPDATE SET direccion_emisor = $2, ambiente = $3, transmisor = $4, pse_url = $5, alerta_restantes = $6`,
      [empresaDe(req), b.direccionEmisor, b.ambiente, b.transmisor, b.pseUrl ?? null, b.alertaRestantes],
    );
    return { ok: true };
  });

  // ---- Rangos autorizados por la DGII ----
  app.get("/central/fiscal/autorizaciones", async (req) => {
    const r = await pool.query(
      `SELECT a.id, a.tipo_ecf AS tipo, a.desde, a.hasta, a.vence_en AS "venceEn",
              COALESCE((SELECT MAX(r.hasta) FROM ecf_rangos r WHERE r.autorizacion_id = a.id), a.desde - 1) AS "asignadoHasta"
         FROM ecf_autorizaciones a WHERE a.empresa_id = $1 ORDER BY a.tipo_ecf, a.desde`,
      [empresaDe(req)],
    );
    return r.rows.map((a) => ({ ...a, sinAsignar: String(Number(a.hasta) - Number(a.asignadoHasta)) }));
  });

  app.post("/central/fiscal/autorizaciones", async (req, rep) => {
    const b = z
      .object({ tipo: z.enum(TIPOS), desde: z.number().int().min(1), hasta: z.number().int().max(9999999999), venceEn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .refine((x) => x.hasta >= x.desde, "El rango es inválido")
      .parse(req.body);
    const id = uuidv7();
    await pool.query(
      "INSERT INTO ecf_autorizaciones (id, empresa_id, tipo_ecf, desde, hasta, vence_en) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, empresaDe(req), b.tipo, b.desde, b.hasta, b.venceEn],
    );
    rep.code(201);
    return { id };
  });

  /** Asigna a una sucursal el siguiente bloque libre de una autorización. */
  app.post("/central/fiscal/rangos", async (req, rep) => {
    const b = z.object({ autorizacionId: uuid, sucursalId: uuid, cantidad: z.number().int().min(1).max(10_000_000) }).parse(req.body);
    const r = await enTransaccion(async (c) => {
      const a = (await c.query("SELECT * FROM ecf_autorizaciones WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [b.autorizacionId, empresaDe(req)])).rows[0];
      if (!a) throw new ErrorNegocio("Autorización no encontrada", 404);
      const ult = (await c.query("SELECT MAX(hasta) AS h FROM ecf_rangos WHERE autorizacion_id = $1", [a.id])).rows[0].h;
      const desde = ult ? Number(ult) + 1 : Number(a.desde);
      const hasta = Math.min(desde + b.cantidad - 1, Number(a.hasta));
      if (desde > Number(a.hasta)) throw new ErrorNegocio("Esta autorización ya está asignada completa. Solicite un nuevo rango a la DGII.");
      const id = uuidv7();
      await c.query(
        `INSERT INTO ecf_rangos (id, autorizacion_id, sucursal_id, tipo_ecf, desde, hasta, siguiente, vence_en)
         VALUES ($1,$2,$3,$4,$5,$6,$5,$7)`,
        [id, a.id, b.sucursalId, a.tipo_ecf, desde, hasta, a.vence_en],
      );
      return { id, tipo: a.tipo_ecf, desde, hasta, cantidad: hasta - desde + 1 };
    });
    rep.code(201);
    return r;
  });

  app.get("/central/fiscal/secuencias", async (req) => {
    const r = await pool.query(
      `SELECT s.*, COALESCE(cf.alerta_restantes, 500) AS alerta
         FROM rpt_ecf_secuencias s LEFT JOIN configuracion_fiscal cf ON cf.empresa_id = s.empresa_id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.sucursal_id = ANY($2)) ORDER BY s.sucursal, s.tipo_ecf`,
      [empresaDe(req), sucursalesDe(req)],
    );
    return r.rows;
  });

  // ---- NCF serie B: rangos autorizados (no altera e-CF) ----
  app.get("/central/fiscal/ncf/rangos", async (req) => {
    const r = await pool.query(
      `SELECT r.id, r.sucursal_id AS "sucursalId", s.nombre AS sucursal, r.tipo,
              r.desde::text, r.hasta::text, r.siguiente::text,
              to_char(r.vence_en, 'YYYY-MM-DD') AS "venceEn", r.activo,
              GREATEST(0, r.hasta - r.siguiente + 1)::text AS disponibles
         FROM facturacion_rangos_ncf r
         JOIN sucursales s ON s.id = r.sucursal_id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2))
        ORDER BY s.nombre, r.tipo, r.desde`,
      [empresaDe(req), sucursalesDe(req)],
    );
    return r.rows;
  });

  app.post("/central/fiscal/ncf/rangos", async (req, rep) => {
    const b = z.object({
      sucursalId: uuid, tipo: z.enum(["B01", "B02"]),
      desde: z.number().int().min(1).max(99999999),
      hasta: z.number().int().min(1).max(99999999),
      venceEn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).refine(x => x.hasta >= x.desde, "Rango inválido").parse(req.body);
    const permitidas = sucursalesDe(req);
    if (permitidas && !permitidas.includes(b.sucursalId)) throw new ErrorNegocio("Sucursal no autorizada", 403);
    const resultado = await enTransaccion(async c => {
      // Serializa altas por empresa/tipo para impedir rangos superpuestos.
      await c.query("SELECT id FROM empresas WHERE id=$1 FOR UPDATE", [empresaDe(req)]);
      const suc = await c.query("SELECT id FROM sucursales WHERE id=$1 AND empresa_id=$2", [b.sucursalId, empresaDe(req)]);
      if (!suc.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
      // to_date acepta 2026-02-30 (lo pasa a marzo): la fecha es válida solo si vuelve igual
      const fecha = await c.query(
        "SELECT to_char(to_date($1::text, 'YYYY-MM-DD'), 'YYYY-MM-DD') = $1::text AS valida, to_date($1::text, 'YYYY-MM-DD') >= CURRENT_DATE AS vigente",
        [b.venceEn]);
      if (!fecha.rows[0]?.valida || !fecha.rows[0]?.vigente) throw new ErrorNegocio("Fecha de vencimiento inválida o vencida", 400);
      const choque = await c.query(
        `SELECT r.id FROM facturacion_rangos_ncf r JOIN sucursales s ON s.id=r.sucursal_id
          WHERE s.empresa_id=$1 AND r.tipo=$2 AND r.desde <= $4 AND r.hasta >= $3 LIMIT 1`,
        [empresaDe(req), b.tipo, b.desde, b.hasta],
      );
      if (choque.rowCount) throw new ErrorNegocio("El rango se superpone con uno ya registrado", 409);
      const id = uuidv7();
      await c.query(`INSERT INTO facturacion_rangos_ncf(id,sucursal_id,tipo,desde,hasta,siguiente,vence_en)
                     VALUES($1,$2,$3,$4,$5,$4,$6)`, [id,b.sucursalId,b.tipo,b.desde,b.hasta,b.venceEn]);
      return { id };
    });
    rep.code(201);
    return resultado;
  });

  app.patch("/central/fiscal/ncf/rangos/:id/estado", async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z.object({ activo: z.boolean() }).parse(req.body);
    const r = await pool.query(
      `UPDATE facturacion_rangos_ncf r SET activo=$3
        FROM sucursales s WHERE r.id=$1 AND r.sucursal_id=s.id AND s.empresa_id=$2
          AND ($4::uuid[] IS NULL OR s.id=ANY($4)) RETURNING r.id`,
      [id, empresaDe(req), b.activo, sucursalesDe(req)],
    );
    if (!r.rowCount) throw new ErrorNegocio("Rango no encontrado", 404);
    return { ok: true };
  });

  // ---- Documentos y envíos ----
  app.get("/central/fiscal/documentos", async (req) => {
    const f = z.object({ estado: z.string().optional(), sucursalId: uuid.optional(), encf: z.string().optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT d.id, d.encf, d.tipo_ecf AS tipo, d.modo_envio AS modo, d.estado, d.monto_total AS total,
              d.codigo_seguridad AS "codigoSeguridad", d.fecha_firma AS "fechaFirma", d.intentos,
              d.track_id AS "trackId", d.mensajes, d.url_qr AS "urlQr", s.nombre AS sucursal
         FROM ecf_documentos d JOIN sucursales s ON s.id = d.sucursal_id AND s.empresa_id = $1
        WHERE ($2::text IS NULL OR d.estado = $2) AND ($3::uuid IS NULL OR d.sucursal_id = $3)
          AND ($4::text IS NULL OR d.encf = upper($4)) AND ($5::uuid[] IS NULL OR d.sucursal_id = ANY($5))
        ORDER BY d.creado_en DESC LIMIT 300`,
      [empresaDe(req), f.estado ?? null, f.sucursalId ?? null, f.encf ?? null, sucursalesDe(req)],
    );
    return r.rows;
  });

  app.get("/central/fiscal/resumen", async (req) => {
    const r = await pool.query(
      `SELECT d.estado, COUNT(*) AS documentos, COALESCE(SUM(d.monto_total), 0) AS monto
         FROM ecf_documentos d JOIN sucursales s ON s.id = d.sucursal_id AND s.empresa_id = $1
        WHERE ($2::uuid[] IS NULL OR d.sucursal_id = ANY($2))
        GROUP BY d.estado`,
      [empresaDe(req), sucursalesDe(req)],
    );
    return r.rows;
  });

  /** Descargar el XML firmado (archivo legal del e-CF). */
  app.get("/central/fiscal/documentos/:id/xml", async (req, rep) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      "SELECT d.encf, d.xml FROM ecf_documentos d JOIN sucursales s ON s.id = d.sucursal_id AND s.empresa_id = $2 WHERE d.id = $1",
      [id, empresaDe(req)],
    );
    if (!r.rowCount) throw new ErrorNegocio("Documento no encontrado", 404);
    rep.header("content-type", "application/xml; charset=utf-8");
    rep.header("content-disposition", `attachment; filename="${r.rows[0].encf}.xml"`);
    return r.rows[0].xml;
  });

  /** Reintentar ya (no espera al siguiente ciclo). */
  app.post("/central/fiscal/documentos/:id/reintentar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      `UPDATE ecf_documentos SET proximo_intento = now()
        WHERE id = $1 AND estado IN ('PENDIENTE','CONTINGENCIA','EN_PROCESO','ENVIADO') RETURNING encf, estado`,
      [id],
    );
    if (!r.rowCount) throw new ErrorNegocio("Este documento no está pendiente de envío", 409);
    return r.rows[0];
  });
  // ---- Certificado digital (.p12) ----
  /** El certificado activo y si cada sucursal ya lo tiene cargado. */
  app.get("/central/fiscal/certificado", async (req) => {
    const e = empresaDe(req);
    const c = (await pool.query(
      `SELECT c.id, c.titular, c.emisor, c.numero_serie AS "numeroSerie", c.valido_desde AS "validoDesde", c.vence,
              c.huella, c.subido_en AS "subidoEn", u.nombre AS "subidoPor"
         FROM certificados_digitales c LEFT JOIN usuarios u ON u.id = c.subido_por
        WHERE c.empresa_id = $1 AND c.activo`,
      [e],
    )).rows[0] ?? null;
    const sucursales = (await pool.query(
      `SELECT s.id, s.nombre, s.tipo, s.certificado_habilitado AS habilitado, x.certificado_huella AS huella, x.certificado_error AS error,
              x.certificado_en AS "revisadoEn", x.ultima_bajada AS "ultimaConexion"
         FROM sucursales s LEFT JOIN sync_sucursales x ON x.sucursal_id = s.id
        WHERE s.empresa_id = $1 AND s.activo AND ($2::uuid[] IS NULL OR s.id = ANY($2)) ORDER BY s.nombre`,
      [e, sucursalesDe(req)],
    )).rows.map((s) => ({
      ...s,
      estado: !s.habilitado ? (s.huella ? "QUITANDO" : "DESACTIVADO")
        : !s.ultimaConexion ? "SIN_SERVIDOR" : s.error ? "ERROR" : c && s.huella === c.huella ? "CARGADO" : "PENDIENTE",
    }));
    // Central instalada en una PC (no en Vercel): también firma, se informa su propio estado
    const propio = process.env.VERCEL ? null : { huella: huellaEnUso() };
    return { certificado: c, sucursales, servidorPropio: propio };
  });

  /** Activar o desactivar el uso del certificado en una o varias sucursales. */
  app.put("/central/fiscal/certificado/sucursales", async (req) => {
    const b = z.object({ sucursalIds: z.array(uuid).min(1).max(500), habilitado: z.boolean() }).parse(req.body);
    const r = await pool.query(
      `UPDATE sucursales SET certificado_habilitado = $3
        WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND certificado_habilitado <> $3 RETURNING id`,
      [empresaDe(req), b.sucursalIds, b.habilitado],
    );
    return { cambiadas: r.rowCount };
  });

  /** Subir (o reemplazar) el certificado. Se revisa la contraseña y la vigencia antes de guardarlo. */
  app.post("/central/fiscal/certificado", { bodyLimit: 2 * 1024 * 1024 }, async (req, rep) => {
    const b = z.object({
      archivo: z.string().min(100).max(1_500_000), // .p12 en base64
      clave: z.string().max(200),
    }).parse(req.body);
    const p12 = Buffer.from(b.archivo.replace(/^data:[^,]*,/, ""), "base64");
    const usuario = uuid.safeParse(req.headers["x-usuario-id"]);
    const r = await enTransaccion(async (c) => {
      const cert = await guardarCertificado(c, empresaDe(req), { p12, clave: b.clave }, usuario.success ? usuario.data : null);
      if (cert.vence.getTime() < Date.now()) throw new ErrorNegocio(`Este certificado venció el ${cert.vence.toISOString().slice(0, 10)}: pida la renovación a la entidad certificadora`);
      if (cert.validoDesde && cert.validoDesde.getTime() > Date.now() + 86400e3) throw new ErrorNegocio("Este certificado todavía no es válido (revise la fecha de la computadora o espere a que empiece su vigencia)");
      return cert;
    }).catch((e: Error) => {
      if (e instanceof ErrorNegocio) throw e;
      throw new ErrorNegocio(e.message);
    });
    if (!process.env.VERCEL) usarCertificado(r); // central en una PC: lo usa de una vez
    rep.code(201);
    return { id: r.id, titular: r.titular, emisor: r.emisor, vence: r.vence, huella: r.huella };
  });
}
