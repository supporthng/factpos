import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";

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
        WHERE s.empresa_id = $1 ORDER BY s.sucursal, s.tipo_ecf`,
      [empresaDe(req)],
    );
    return r.rows;
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
          AND ($4::text IS NULL OR d.encf = upper($4))
        ORDER BY d.creado_en DESC LIMIT 300`,
      [empresaDe(req), f.estado ?? null, f.sucursalId ?? null, f.encf ?? null],
    );
    return r.rows;
  });

  app.get("/central/fiscal/resumen", async (req) => {
    const r = await pool.query(
      `SELECT d.estado, COUNT(*) AS documentos, COALESCE(SUM(d.monto_total), 0) AS monto
         FROM ecf_documentos d JOIN sucursales s ON s.id = d.sucursal_id AND s.empresa_id = $1
        GROUP BY d.estado`,
      [empresaDe(req)],
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
}
