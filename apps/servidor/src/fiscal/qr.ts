import { fechaDGII, fechaHoraDGII } from "./xml.js";

/**
 * URL del código QR (timbre electrónico) de la representación impresa.
 * - Factura de consumo menor a RD$250,000 → ConsultaTimbreFC
 * - Los demás e-CF → ConsultaTimbre
 */
export function urlQr(d: {
  rncEmisor: string; rncComprador: string | null; encf: string; fechaEmision: Date;
  montoTotal: string; fechaFirma: Date; codigoSeguridad: string; modo: "ECF" | "RFCE"; ambiente: string;
}) {
  const p = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  // En los ambientes de prueba la DGII usa rutas propias (testecf / certecf)
  const ruta = d.ambiente === "TESTECF" ? "testecf" : d.ambiente === "CERTECF" ? "certecf" : "ecf";
  if (d.modo === "RFCE") {
    return `https://fc.dgii.gov.do/${ruta === "ecf" ? "eCF" : ruta}/ConsultaTimbreFC?` +
      p({ RncEmisor: d.rncEmisor, ENCF: d.encf, MontoTotal: d.montoTotal, CodigoSeguridad: d.codigoSeguridad });
  }
  return `https://ecf.dgii.gov.do/${ruta}/ConsultaTimbre?` + p({
    RncEmisor: d.rncEmisor,
    RncComprador: d.rncComprador ?? "",
    ENCF: d.encf,
    FechaEmision: fechaDGII(d.fechaEmision),
    MontoTotal: d.montoTotal,
    FechaFirma: fechaHoraDGII(d.fechaFirma),
    CodigoSeguridad: d.codigoSeguridad,
  });
}
