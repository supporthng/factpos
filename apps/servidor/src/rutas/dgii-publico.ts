import type { FastifyInstance } from "fastify";
import { uuidv7 } from "@factpos/compartido";
import { pool } from "../db.js";
import { descifrar } from "../fiscal/certificado-guardado.js";
import { certificado, firmarXml, leerP12, type Certificado } from "../fiscal/firma.js";
import {
  construirArecf, emitirToken, firmaValida, nuevaSemilla, semillaValida, tokenValido, valorDe, xmlDeMultipart, xmlSemilla, type MotivoNoRecibido,
} from "../fiscal/servicios-dgii.js";

/**
 * Servicios públicos que la DGII (y otros contribuyentes) llaman en el servidor de la empresa:
 *   GET  /fe/autenticacion/api/semilla             entrega una semilla
 *   POST /fe/autenticacion/api/validacioncertificado  semilla firmada → token (1 hora)
 *   POST /fe/recepcion/api/ecf                     recibe un e-CF y responde el acuse de recibo (ARECF) firmado
 *   POST /fe/aprobacioncomercial/api/ecf           recibe una aprobación/rechazo comercial y responde OK o Error
 * La empresa receptora sale del RNC del comprador. Pasos 7 al 12 del proceso de certificación.
 */
const certificadoDe = async (empresaId: string): Promise<Certificado> => {
  const f = (await pool.query<{ cifrado: string }>("SELECT cifrado FROM certificados_digitales WHERE empresa_id = $1 AND activo", [empresaId]).catch(() => ({ rows: [] as { cifrado: string }[] }))).rows[0];
  if (f) { const d = descifrar(f.cifrado); return leerP12(d.p12, d.clave); }
  return certificado();
};
const soloDigitos = (v: string | null) => (v ?? "").replace(/\D/g, "");
const monto = (v: string | null) => (v && /^\d+(\.\d+)?$/.test(v) ? v : null);

export async function rutasDgiiPublico(app: FastifyInstance) {
  // El cuerpo llega como multipart/form-data (campo «xml») o como XML directo
  await app.register(async (i) => {
    i.addContentTypeParser("multipart/form-data", { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 }, (_req, cuerpo, hecho) => hecho(null, cuerpo));
    i.addContentTypeParser(["application/xml", "text/xml"], { parseAs: "string", bodyLimit: 5 * 1024 * 1024 }, (_req, cuerpo, hecho) => hecho(null, cuerpo));
    const leerXml = (req: { body: unknown; headers: Record<string, unknown> }) => {
      if (Buffer.isBuffer(req.body)) return xmlDeMultipart(req.body, String(req.headers["content-type"] ?? ""));
      return typeof req.body === "string" ? req.body : null;
    };
    const conToken = (req: { headers: Record<string, unknown> }) => tokenValido(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));

    i.get("/fe/autenticacion/api/semilla", async (_req, rep) => rep.type("application/xml").send(xmlSemilla(nuevaSemilla())));

    i.post("/fe/autenticacion/api/validacioncertificado", async (req, rep) => {
      const xml = leerXml(req);
      if (!xml) return rep.code(400).send({ error: "Archivo no válido: envíe el XML en el campo «xml»" });
      const valor = valorDe(xml, "valor");
      if (!valor || !semillaValida(valor)) return rep.code(401).send({ error: "Semilla inválida o vencida" });
      if (!firmaValida(xml)) return rep.code(401).send({ error: "La firma del XML no es válida" });
      return emitirToken();
    });

    i.post("/fe/recepcion/api/ecf", async (req, rep) => {
      if (!conToken(req)) return rep.code(401).send({ error: "Token inválido o vencido" });
      const xml = leerXml(req);
      if (!xml) return rep.code(400).send({ error: "Archivo no válido: envíe el XML en el campo «xml»" });
      const rncEmisor = soloDigitos(valorDe(xml, "RNCEmisor"));
      const rncComprador = soloDigitos(valorDe(xml, "RNCComprador"));
      const encf = (valorDe(xml, "eNCF") ?? "").trim();
      const total = monto(valorDe(xml, "MontoTotal"));
      const emp = rncComprador ? (await pool.query<{ id: string }>("SELECT id FROM empresas WHERE rnc = $1 AND activo", [rncComprador])).rows[0] : undefined;

      let estado: 0 | 1 = 0, motivo: MotivoNoRecibido | undefined;
      const firmaOk = firmaValida(xml);
      if (!/^E\d{12}$/.test(encf) || !rncEmisor) { estado = 1; motivo = 1; }
      else if (!firmaOk) { estado = 1; motivo = 2; }
      else if (!emp) { estado = 1; motivo = 4; }
      else {
        const nuevo = await pool.query(
          `INSERT INTO ecf_recibidos (id, empresa_id, rnc_emisor, encf, monto_total, fecha_emision, xml, firma_valida, acuse_estado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,0) ON CONFLICT (empresa_id, rnc_emisor, encf) DO NOTHING`,
          [uuidv7(), emp.id, rncEmisor, encf, total, valorDe(xml, "FechaEmision"), xml]);
        if (!nuevo.rowCount) { estado = 1; motivo = 3; }
      }
      // El acuse lo firma el comprador (nuestra empresa); si no es nuestra, con el certificado del servidor
      const cert = emp ? await certificadoDe(emp.id) : certificado();
      const { xmlFirmado } = firmarXml(construirArecf({ rncEmisor, rncComprador, encf, estado, motivo }), cert);
      return rep.type("application/xml").send(xmlFirmado);
    });

    i.post("/fe/aprobacioncomercial/api/ecf", async (req, rep) => {
      if (!conToken(req)) return rep.code(401).send({ error: "Token inválido o vencido" });
      const xml = leerXml(req);
      if (!xml) return rep.code(400).send({ error: "Archivo no válido: envíe el XML en el campo «xml»" });
      const rncEmisor = soloDigitos(valorDe(xml, "RNCEmisor"));
      const rncComprador = soloDigitos(valorDe(xml, "RNCComprador"));
      const encf = (valorDe(xml, "eNCF") ?? "").trim();
      const estado = Number(valorDe(xml, "Estado"));
      const firmaOk = firmaValida(xml);
      // Debe ser sobre un comprobante que NOSOTROS emitimos
      const emp = rncEmisor ? (await pool.query<{ id: string }>("SELECT id FROM empresas WHERE rnc = $1 AND activo", [rncEmisor])).rows[0] : undefined;
      const existe = emp && /^E\d{12}$/.test(encf)
        ? (await pool.query("SELECT 1 FROM ecf_documentos d JOIN sucursales s ON s.id = d.sucursal_id WHERE s.empresa_id = $1 AND d.encf = $2", [emp.id, encf])).rowCount
        : 0;
      const ok = firmaOk && !!existe && (estado === 1 || estado === 2);
      await pool.query(
        `INSERT INTO ecf_aprobaciones_recibidas (id, empresa_id, rnc_emisor, rnc_comprador, encf, monto_total, estado, motivo, xml, firma_valida, resultado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [uuidv7(), emp?.id ?? null, rncEmisor, rncComprador || null, encf, monto(valorDe(xml, "MontoTotal")), estado || null, valorDe(xml, "DetalleMotivoRechazo"), xml, firmaOk, ok ? "OK" : "Error"]);
      const mensaje = ok ? "Aprobación comercial recibida" : !firmaOk ? "La firma del XML no es válida" : !existe ? "Factura no encontrada para esta aprobación comercial" : "Estado no válido";
      return rep.code(ok ? 200 : 400).send({ mensaje: [mensaje], estado: ok ? "OK" : "Error", codigo: ok ? "1" : "2" });
    });
  });
}
