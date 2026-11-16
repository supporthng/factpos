import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";
import { firmarXml, codigoSeguridad, certificado } from "../fiscal/firma.js";
import { dgii, type EstadoDgii } from "../fiscal/transmisor.js";
import { armarXmlDeFila, fechaHoraFirma, limpiarFila } from "../fiscal/set-pruebas.js";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const soloDigitos = (s: string | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * Set de pruebas de la DGII: la administración lee el Excel que la DGII le generó a la empresa y manda un caso a la vez.
 * Aquí se arma el XML con los datos EXACTOS del caso, se firma con el certificado de la empresa y (si se pide) se envía
 * a TesteCF/CerteCF y se espera el resultado. No crea ventas ni gasta e-NCF de la sucursal: los números vienen en el set.
 */
export async function rutasSetPruebasFiscal(app: FastifyInstance) {
  app.post("/central/fiscal/set-pruebas/caso", async (req) => {
    const empresa = z.string().uuid().parse(req.headers["x-empresa-id"]);
    const b = z.object({
      ecf: z.record(z.string(), z.unknown()),
      /** Fila del resumen de consumo (hoja RFCE) del mismo e-NCF, si el caso se envía como resumen */
      rfce: z.record(z.string(), z.unknown()).optional(),
      enviar: z.boolean().default(false),
    }).parse(req.body);

    const cfg = (await pool.query(
      `SELECT e.rnc, COALESCE(cf.ambiente, 'SIMULADO') AS ambiente, COALESCE(cf.transmisor, 'SIMULADO') AS transmisor
         FROM empresas e LEFT JOIN configuracion_fiscal cf ON cf.empresa_id = e.id WHERE e.id = $1`, [empresa])).rows[0];
    if (!cfg) throw new ErrorNegocio("Empresa no encontrada", 404);
    if (b.enviar) {
      if (cfg.ambiente !== "TESTECF" && cfg.ambiente !== "CERTECF") throw new ErrorNegocio("Para enviar el set de pruebas el ambiente debe ser Pruebas (TesteCF) o Certificación (CerteCF): cámbielo en Fiscal › Facturación electrónica.", 409);
      if (cfg.transmisor !== "DGII") throw new ErrorNegocio("El set de pruebas se envía directo a la DGII: elija «DGII» como transmisor en Fiscal › Facturación electrónica.", 409);
      if (certificado().prueba) throw new ErrorNegocio("Falta el certificado digital de la empresa: cárguelo en Fiscal › Certificado digital.", 503);
    }

    const fila = limpiarFila(b.ecf);
    const armado = armarXmlDeFila(fila, "ECF", { FechaHoraFirma: fechaHoraFirma() });
    const rncCaso = soloDigitos(fila["RNCEmisor"]);
    const aviso = rncCaso && soloDigitos(cfg.rnc) && rncCaso !== soloDigitos(cfg.rnc)
      ? `El set es del RNC ${rncCaso} pero la empresa tiene el RNC ${soloDigitos(cfg.rnc)}: la DGII lo rechazará si el certificado no es del RNC del set.` : undefined;

    const firmado = firmarXml(armado.xml);
    const codigo = codigoSeguridad(firmado.signatureValue);
    let modo: "ECF" | "RFCE" = "ECF";
    let xmlEnvio = firmado.xmlFirmado;
    let sinUsar = armado.sinUsar;
    if (b.rfce) {
      const resumen = armarXmlDeFila(limpiarFila(b.rfce), "RFCE", { CodigoSeguridadeCF: codigo });
      modo = "RFCE";
      xmlEnvio = firmarXml(resumen.xml).xmlFirmado;
      sinUsar = [...sinUsar, ...resumen.sinUsar];
    }
    const base = { encf: armado.encf, tipo: armado.tipo, modo, codigoSeguridad: codigo, aviso, sinUsar, xmlFirmado: xmlEnvio, xmlCompleto: modo === "RFCE" ? firmado.xmlFirmado : undefined };
    if (!b.enviar) return { ...base, enviado: false, estado: "ARMADO" as const };

    try {
      const tx = dgii(cfg.ambiente);
      const doc = { encf: armado.encf, tipo: armado.tipo, modo, xml: xmlEnvio, rncEmisor: rncCaso || soloDigitos(cfg.rnc) };
      let r = await tx.enviar(doc);
      // El e-CF completo responde con un número de seguimiento: se consulta hasta que la DGII lo resuelva
      for (let i = 0; i < 8 && r.estado === "EN_PROCESO" && r.trackId; i++) {
        await esperar(2500);
        r = await tx.consultar(r.trackId, doc);
      }
      return { ...base, enviado: true, estado: r.estado as EstadoDgii, trackId: r.trackId, mensajes: r.mensajes };
    } catch (e) {
      return { ...base, enviado: true, estado: "ERROR" as const, mensajes: (e as Error).message.slice(0, 500) };
    }
  });
}
