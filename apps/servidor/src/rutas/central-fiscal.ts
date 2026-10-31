import { sucursalesDe } from "../sesion.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { guardarCertificado, huellaEnUso } from "../fiscal/certificado-guardado.js";
import { usarCertificado, certificado } from "../fiscal/firma.js";
import { dgii } from "../fiscal/transmisor.js";
import { rncValido } from "@factpos/compartido";
import { PORTAL_URL } from "../licencia/cliente.js";

/** Estado de la certificación del software en el portal de FactPOS (caché de 10 min). */
let cacheCert: { t: number; v: { autorizado: boolean; fecha: string | null; software: string; pasosHechos: number; totalPasos: number } | null } | null = null;
async function certificacionSoftware() {
  if (cacheCert && Date.now() - cacheCert.t < 600_000) return cacheCert.v;
  let v = null;
  try {
    const r = await fetch(`${PORTAL_URL()}/licencias/certificacion-dgii`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) v = await r.json();
  } catch { /* sin internet */ }
  cacheCert = { t: Date.now(), v };
  return v;
}

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
      sucursalId: uuid, tipo: z.enum(["B01", "B02", "B14", "B15", "B16"]),
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


  /**
   * ¿Puede esta empresa emitir comprobantes electrónicos con la DGII? Revisa cada requisito y, si falta algo, dice qué.
   * Lo que solo la DGII puede dar (autorización de emisor, e-NCF) se comprueba por sus efectos:
   * una autenticación exitosa con su certificado y un rango vigente.
   */
  app.get("/central/fiscal/verificacion", async (req) => {
    const e = empresaDe(req);
    type Estado = "ok" | "falta" | "aviso" | "info";
    const items: { id: string; titulo: string; estado: Estado; detalle: string; accion?: string }[] = [];
    const poner = (id: string, titulo: string, estado: Estado, detalle: string, accion?: string) => items.push({ id, titulo, estado, detalle, accion });

    const emp = (await pool.query(
      `SELECT e.rnc, e.razon_social, COALESCE(cf.direccion_emisor, '') AS direccion, COALESCE(cf.ambiente, 'SIMULADO') AS ambiente,
              COALESCE(cf.transmisor, 'SIMULADO') AS transmisor, cf.pse_url, COALESCE(cf.alerta_restantes, 500) AS alerta,
              cf.autenticacion_ok_en AS "autOk"
         FROM empresas e LEFT JOIN configuracion_fiscal cf ON cf.empresa_id = e.id WHERE e.id = $1`, [e])).rows[0];
    let autenticadoProduccion = false;

    // 0. ¿Puede esta empresa emitir ya con la DGII? Se confirma con la autenticación en producción (abajo).
    const idxAut = items.length;
    poner("autorizacion", "Autorización de la DGII para emitir e-CF", "falta", "", "");

    // 0b. Certificación del software (FactPOS) ante la DGII: la lleva el proveedor en su portal
    const sw = await certificacionSoftware();
    if (!sw) poner("software", "Certificación de FactPOS ante la DGII", "info", "No se pudo consultar el portal de FactPOS (sin internet).");
    else if (sw.autorizado) poner("software", "Certificación de FactPOS ante la DGII", "ok", `${sw.software} está autorizado por la DGII${sw.fecha ? ` desde el ${new Date(sw.fecha + "T12:00:00").toLocaleDateString("es-DO")}` : ""}.`);
    else poner("software", "Certificación de FactPOS ante la DGII", "aviso", `${sw.software} está en proceso de certificación: ${sw.pasosHechos} de ${sw.totalPasos} pasos completados.`, "Lo gestiona FactPOS; no necesita hacer nada. Hasta entonces no se garantiza la emisión de e-CF en producción.");

    // 1. Datos del emisor
    const rnc = String(emp.rnc ?? "").replace(/\D/g, "");
    if (!rnc || !rncValido(rnc)) poner("rnc", "RNC del emisor", "falta", rnc ? `El RNC «${emp.rnc}» no es válido.` : "La empresa no tiene RNC.", "Corrija el RNC de la empresa (Configuración › Marca / datos de la empresa).");
    else poner("rnc", "RNC del emisor", "ok", `RNC ${rnc} · ${emp.razon_social}`);
    if (String(emp.direccion).trim().length < 5) poner("direccion", "Dirección del emisor", "falta", "Falta la dirección fiscal que sale en el comprobante.", "Escríbala en Fiscal › Configuración.");
    else poner("direccion", "Dirección del emisor", "ok", String(emp.direccion));

    // 2. Ambiente y forma de envío
    const real = emp.transmisor !== "SIMULADO" && emp.ambiente !== "SIMULADO";
    if (!real) poner("ambiente", "Envío a la DGII", "falta", "Está en modo SIMULADO: los comprobantes NO se envían a la DGII y no tienen validez fiscal.", "En Fiscal › Configuración elija el ambiente (TesteCF / CerteCF / producción) y el envío «DGII» cuando ya esté autorizado.");
    else if (emp.ambiente !== "ECF") poner("ambiente", "Envío a la DGII", "aviso", `Ambiente de ${emp.ambiente === "TESTECF" ? "pruebas (TesteCF)" : "certificación (CerteCF)"}: sirve para las pruebas, no para facturar de verdad.`, "Cuando la DGII le autorice como emisor, cambie el ambiente a producción (ECF).");
    else poner("ambiente", "Envío a la DGII", "ok", emp.transmisor === "PSE" ? "Producción, a través de un proveedor (PSE)." : "Producción, envío directo a la DGII.");
    if (emp.transmisor === "PSE" && !emp.pse_url) poner("pse", "Proveedor de servicios (PSE)", "falta", "Eligió enviar por un PSE pero no indicó su dirección.", "Escríbala en Fiscal › Configuración.");

    // 3. Certificado digital
    const cert = (await pool.query("SELECT titular, vence, huella FROM certificados_digitales WHERE empresa_id = $1 AND activo", [e])).rows[0];
    if (!cert) poner("certificado", "Certificado digital", "falta", "No hay un certificado digital cargado: sin él no se pueden firmar los comprobantes.", "Cargue el archivo .p12 en Fiscal › Certificado digital.");
    else {
      const dias = Math.floor((new Date(cert.vence).getTime() - Date.now()) / 86400000);
      if (dias < 0) poner("certificado", "Certificado digital", "falta", `El certificado de ${cert.titular} venció hace ${-dias} día(s).`, "Renueve el certificado con la prestadora y cárguelo de nuevo.");
      else if (dias <= 30) poner("certificado", "Certificado digital", "aviso", `Vigente, pero vence en ${dias} día(s) (${cert.titular}).`, "Renuévelo antes de que venza para no dejar de facturar.");
      else poner("certificado", "Certificado digital", "ok", `Vigente hasta el ${new Date(cert.vence).toLocaleDateString("es-DO")} · ${cert.titular}`);
      const suc = (await pool.query(
        `SELECT s.nombre, s.certificado_habilitado AS hab, x.certificado_huella AS huella, x.certificado_error AS error, x.ultima_bajada AS ultima
           FROM sucursales s LEFT JOIN sync_sucursales x ON x.sucursal_id = s.id WHERE s.empresa_id = $1 AND s.activo`, [e])).rows;
      const sinCert = suc.filter((s) => s.hab && (s.error || (s.ultima && s.huella !== cert.huella)));
      if (suc.some((s) => !s.hab)) poner("cert-sucursales", "Certificado en las sucursales", "aviso", `El certificado no está habilitado en: ${suc.filter((s) => !s.hab).map((s) => s.nombre).join(", ")}.`, "Habilítelo en Fiscal › Certificado digital.");
      else if (sinCert.length) poner("cert-sucursales", "Certificado en las sucursales", "aviso", `Aún no llega o falló en: ${sinCert.map((s) => s.nombre).join(", ")}.`, "Espere a que la sucursal se conecte y sincronice, o revise su error en Certificado digital.");
      else poner("cert-sucursales", "Certificado en las sucursales", "ok", "Todas las sucursales activas lo tienen habilitado.");
    }

    // 4. Secuencias e-NCF (por sucursal y tipo)
    const sucs = (await pool.query("SELECT id, nombre FROM sucursales WHERE empresa_id = $1 AND activo ORDER BY nombre", [e])).rows;
    const disp = (await pool.query(
      `SELECT sucursal_id, tipo_ecf, SUM(hasta - siguiente + 1)::bigint AS disponibles
         FROM ecf_rangos WHERE activo AND siguiente <= hasta AND vence_en >= CURRENT_DATE AND sucursal_id = ANY($1::uuid[])
        GROUP BY 1, 2`, [sucs.map((s) => s.id)])).rows;
    for (const tipo of ["E32", "E31"]) {
      const faltan: string[] = [], pocas: string[] = [];
      for (const s of sucs) {
        const d = Number(disp.find((x) => x.sucursal_id === s.id && x.tipo_ecf === tipo)?.disponibles ?? 0);
        if (d <= 0) faltan.push(s.nombre); else if (d < Number(emp.alerta)) pocas.push(`${s.nombre} (${d})`);
      }
      const nombre = tipo === "E32" ? "e-NCF de consumo (E32)" : "e-NCF de crédito fiscal (E31)";
      if (faltan.length) poner("sec-" + tipo, nombre, "falta", `Sin números vigentes en: ${faltan.join(", ")}.`, "Solicite los e-NCF en la Oficina Virtual de la DGII y regístrelos en Fiscal › Secuencias e-NCF.");
      else if (pocas.length) poner("sec-" + tipo, nombre, "aviso", `Quedan pocos en: ${pocas.join(", ")}.`, "Solicite un rango nuevo a la DGII.");
      else poner("sec-" + tipo, nombre, "ok", "Hay números vigentes en todas las sucursales.");
    }

    // 5. Conexión y autenticación con la DGII (la prueba real de que está autorizado)
    if (real && emp.transmisor === "DGII") {
      let certCargado = true;
      try { certificado(); } catch { certCargado = false; }
      if (!certCargado) poner("dgii", "Conexión con la DGII", "aviso", "Este servidor no tiene el certificado en memoria, por eso no se pudo probar la autenticación con la DGII.", "Pruebe desde el servidor de la sucursal, o cargue el certificado de nuevo.");
      else {
        try {
          await dgii(emp.ambiente).probar!();
          if (emp.ambiente === "ECF") {
            autenticadoProduccion = true;
            // Autenticar en producción solo es posible siendo emisor autorizado: queda constancia
            await pool.query(
              `INSERT INTO configuracion_fiscal (empresa_id, etapa_dgii, autenticacion_ok_en) VALUES ($1,'AUTORIZADO', now())
               ON CONFLICT (empresa_id) DO UPDATE SET etapa_dgii = 'AUTORIZADO', autenticacion_ok_en = now()`, [e]);
          }
          poner("dgii", "Conexión con la DGII", "ok", `La DGII aceptó la autenticación con su certificado (${emp.ambiente}).`);
        } catch (err) {
          poner("dgii", "Conexión con la DGII", "falta", `No se pudo autenticar: ${(err as Error).message}`,
            "Si es un error de conexión, revise el internet. Si la DGII rechazó el certificado, confirme en la Oficina Virtual que su solicitud de emisor electrónico fue aprobada y que el certificado es el mismo.");
        }
      }
    } else if (real) {
      poner("dgii", "Conexión con la DGII", "info", "Se envía por un proveedor (PSE): su autorización se confirma con el proveedor.");
    } else {
      poner("dgii", "Conexión con la DGII", "falta", "No se puede probar mientras esté en modo simulado.", "Primero pase la configuración a TesteCF/CerteCF o producción.");
    }

    {
      const it = items[idxAut];
      if (autenticadoProduccion) {
        it.estado = "ok"; it.detalle = "La DGII aceptó la autenticación en producción con su certificado: puede emitir e-CF."; it.accion = undefined;
      } else {
        const cuando = emp.autOk ? ` Última autenticación exitosa en producción: ${new Date(emp.autOk).toLocaleString("es-DO")}.` : "";
        it.detalle = `Todavía no se confirma con la DGII.${cuando} Se confirma cuando la autenticación en producción funciona.`;
        it.accion = "Pase la configuración a producción (ECF) con envío «DGII» y revise la conexión con la DGII más abajo. El avance de la certificación del software lo lleva FactPOS.";
      }
    }

    // 6. Estado de los envíos recientes
    const env = (await pool.query(
      `SELECT d.estado, COUNT(*)::int AS n FROM ecf_documentos d JOIN sucursales s ON s.id = d.sucursal_id AND s.empresa_id = $1
        WHERE d.creado_en > now() - interval '7 days' GROUP BY d.estado`, [e])).rows;
    const n = (st: string[]) => env.filter((x) => st.includes(x.estado)).reduce((a, x) => a + x.n, 0);
    if (n(["RECHAZADO"]) > 0) poner("envios", "Comprobantes de los últimos 7 días", "aviso", `${n(["RECHAZADO"])} rechazado(s) por la DGII.`, "Revíselos en Fiscal › Envíos a la DGII.");
    else if (n(["CONTINGENCIA", "SIN_FIRMA"]) > 0) poner("envios", "Comprobantes de los últimos 7 días", "aviso", `${n(["CONTINGENCIA", "SIN_FIRMA"])} sin enviar (contingencia o sin firma).`, "Revíselos en Fiscal › Envíos a la DGII y reintente.");
    else poner("envios", "Comprobantes de los últimos 7 días", "ok", n(["ACEPTADO", "ACEPTADO_COND"]) ? `${n(["ACEPTADO", "ACEPTADO_COND"])} aceptado(s), sin rechazos.` : "Sin envíos recientes.");

    poner("tipos", "Tipos de e-CF que emite FactPOS", "info", "E31 (crédito fiscal), E32 (consumo) y E34 (nota de crédito). Otros tipos (E41, E43, E44, E45, E46, E47) todavía no se emiten.");

    const faltas = items.filter((i) => i.estado === "falta");
    const avisos = items.filter((i) => i.estado === "aviso");
    return {
      puedeFacturar: faltas.length === 0,
      resultado: faltas.length ? "NO_LISTO" : avisos.length ? "LISTO_CON_AVISOS" : "LISTO",
      resumen: faltas.length ? `Falta ${faltas.length} requisito(s) para facturar con la DGII.` : avisos.length ? "Puede facturar, pero hay avisos que revisar." : "Todo en orden para facturar con la DGII.",
      items, revisadoEn: new Date().toISOString(),
    };
  });

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
