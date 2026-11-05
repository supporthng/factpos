import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { construirEcf, construirRfce, LIMITE_RFCE, type DatosEcf, type TipoEcf } from "../fiscal/xml.js";
import { firmarXml, codigoSeguridad, certificado } from "../fiscal/firma.js";
import { asignarEncf } from "../fiscal/emitir.js";
import { dgii } from "../fiscal/transmisor.js";
import { Decimal } from "decimal.js";

export interface ResultadoEnsayo {
  tipo: TipoEcf; encf: string; modo: "ECF" | "RFCE"; enviado: boolean;
  estado: string; trackId?: string; mensaje?: string;
}

/** Orden que pide la DGII para la simulación: 31, 32, 41, 43, 44, 45, 46, 47; luego 33 y 34. */
const ORDEN: TipoEcf[] = ["E31", "E32", "E41", "E43", "E44", "E45", "E46", "E47", "E33", "E34"];

function lineaDe(tipo: TipoEcf): DatosEcf["lineas"][number] {
  if (tipo === "E43" || tipo === "E47") {
    return { nombre: "Ensayo FactPOS", cantidad: "1", precioUnitario: "500.00", descuento: "0", tasaItbis: "0", base: "500.00", itbis: "0.00", total: "500.00",
      ...(tipo === "E47" ? { retencion: { isr: "50.00" } } : {}) };
  }
  return { nombre: "Ensayo FactPOS", cantidad: "1", precioUnitario: "1180.00", descuento: "0", tasaItbis: "0.18", base: "1000.00", itbis: "180.00", total: "1180.00" };
}

/**
 * Ensayo de certificación: arma, firma y (si el ambiente es de pruebas/certificación) envía un e-CF de cada tipo.
 * No crea ventas ni toca inventario o caja. En SIMULADO no consume números ni envía nada.
 * Con envío real SÍ consume un e-NCF de cada tipo de los rangos de la sucursal (rangos de prueba).
 */
export async function rutasEnsayoFiscal(app: FastifyInstance) {
  app.post("/central/fiscal/ensayo", async (req) => {
    const empresa = z.string().uuid().parse(req.headers["x-empresa-id"]);
    const { sucursalId } = z.object({ sucursalId: z.string().uuid() }).parse(req.body);
    const cfg = (await pool.query(
      `SELECT e.rnc, e.razon_social, e.nombre_comercial, COALESCE(cf.direccion_emisor, '') AS direccion,
              COALESCE(cf.ambiente, 'SIMULADO') AS ambiente, COALESCE(cf.transmisor, 'SIMULADO') AS transmisor
         FROM sucursales s JOIN empresas e ON e.id = s.empresa_id LEFT JOIN configuracion_fiscal cf ON cf.empresa_id = e.id
        WHERE s.id = $1 AND e.id = $2`, [sucursalId, empresa])).rows[0];
    if (!cfg) throw new ErrorNegocio("Sucursal no encontrada", 404);
    if (cfg.ambiente === "ECF") throw new ErrorNegocio("El ensayo no se puede correr en producción: cambie el ambiente a pruebas (TesteCF) o certificación (CerteCF).", 409);
    const real = cfg.transmisor === "DGII" && cfg.ambiente !== "SIMULADO";
    if (real && certificado().prueba) throw new ErrorNegocio("Falta el certificado digital: cárguelo en Fiscal › Certificado digital antes del ensayo.", 503);

    const ahora = new Date();
    const resultados: ResultadoEnsayo[] = [];
    let encfE31: { encf: string; fecha: Date } | null = null;
    for (const tipo of ORDEN) {
      try {
        const num = real
          ? await enTransaccion((c) => asignarEncf(c, sucursalId, tipo))
          : { encf: `${tipo}${String(resultados.length + 1).padStart(10, "0")}`, venceSecuencia: "2099-12-31" };
        const linea = lineaDe(tipo);
        const datos: DatosEcf = {
          tipo, encf: num.encf, venceSecuencia: String(num.venceSecuencia).slice(0, 10), fechaEmision: ahora,
          emisor: { rnc: cfg.rnc, razonSocial: cfg.razon_social, nombreComercial: cfg.nombre_comercial, direccion: cfg.direccion || "N/D" },
          // Comprador: la propia empresa (sirve para ensayar; los tipos de consumo final van sin comprador)
          comprador: tipo === "E32" || tipo === "E43" ? null
            : tipo === "E47" ? { rnc: null, nombre: "Proveedor del exterior (ensayo)", identificadorExtranjero: "EXT-0001", pais: "US" }
            : tipo === "E44" || tipo === "E46" ? { rnc: null, nombre: cfg.razon_social }
            : { rnc: cfg.rnc, nombre: cfg.razon_social },
          condicion: "CONTADO", pagos: [{ formaPago: "EFECTIVO", monto: linea.total }],
          lineas: [linea], totales: { subtotal: linea.base, itbis: linea.itbis, total: linea.total },
        };
        if ((tipo === "E33" || tipo === "E34") && encfE31) {
          datos.referencia = { encf: encfE31.encf, fecha: encfE31.fecha, codigoModificacion: "1", razon: "Ensayo de certificación" };
        }
        const modo: "ECF" | "RFCE" = tipo === "E32" && new Decimal(linea.total).lt(LIMITE_RFCE) ? "RFCE" : "ECF";
        const { xmlFirmado, signatureValue } = firmarXml(construirEcf(datos, ahora));
        if (tipo === "E31") encfE31 = { encf: num.encf, fecha: ahora };
        if (!real) { resultados.push({ tipo, encf: num.encf, modo, enviado: false, estado: "ARMADO", mensaje: "Armado y firmado; no se envió (modo simulado)" }); continue; }
        const xml = modo === "RFCE" ? firmarXml(construirRfce(datos, codigoSeguridad(signatureValue))).xmlFirmado : xmlFirmado;
        const r = await dgii(cfg.ambiente).enviar({ encf: num.encf, tipo, modo, xml, rncEmisor: cfg.rnc });
        resultados.push({ tipo, encf: num.encf, modo, enviado: true, estado: r.estado, trackId: r.trackId, mensaje: r.mensajes ? JSON.stringify(r.mensajes).slice(0, 400) : undefined });
      } catch (e) {
        resultados.push({ tipo, encf: "", modo: "ECF", enviado: false, estado: "ERROR", mensaje: (e as Error).message.slice(0, 400) });
      }
    }
    return { ambiente: cfg.ambiente, transmisor: cfg.transmisor, real, resultados };
  });
}
