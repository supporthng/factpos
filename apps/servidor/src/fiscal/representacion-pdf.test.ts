import { describe, expect, it } from "vitest";
import { representacionPdf, urlTimbre } from "./representacion-pdf.js";
import { anchoTexto, aWinAnsi } from "./pdf-minimo.js";

const XML = `<?xml version="1.0"?><ECF><Encabezado><IdDoc><TipoeCF>32</TipoeCF><eNCF>E320000000101</eNCF></IdDoc>
<Emisor><RNCEmisor>131565296</RNCEmisor><RazonSocialEmisor>ONETECH SRL</RazonSocialEmisor><FechaEmision>18-11-2026</FechaEmision></Emisor>
<Totales><MontoGravadoTotal>1000.00</MontoGravadoTotal><TotalITBIS>180.00</TotalITBIS><MontoTotal>1180.00</MontoTotal></Totales></Encabezado>
<DetallesItems><Item><IndicadorFacturacion>1</IndicadorFacturacion><NombreItem>Servicio “premium” – área</NombreItem><CantidadItem>1</CantidadItem><PrecioUnitarioItem>1000.00</PrecioUnitarioItem><MontoItem>1000.00</MontoItem></Item></DetallesItems>
<FechaHoraFirma>18-11-2026 09:40:00</FechaHoraFirma><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>AbCdEf123456</SignatureValue></Signature></ECF>`;

describe("representación impresa en PDF", () => {
  it("arma un PDF válido con el e-NCF y el RNC del XML", () => {
    const r = representacionPdf(XML, "CERTECF");
    expect(r.encf).toBe("E320000000101");
    expect(r.rnc).toBe("131565296");
    expect(Buffer.from(r.pdf.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(Buffer.from(r.pdf.slice(-6)).toString("latin1")).toContain("%%EOF");
  });
  it("rechaza un XML sin firmar", () => {
    expect(() => representacionPdf(XML.replace(/<Signature[\s\S]*<\/Signature>/, ""))).toThrow(/firmado/);
  });
  it("el QR de una factura de consumo menor de 250 mil consulta el resumen (FC); las demás, el timbre", () => {
    const base = { ambiente: "CERTECF", rncEmisor: "131565296", rncComprador: "", fechaEmision: "18-11-2026", fechaFirma: "18-11-2026 09:40:00", codigo: "AbCdEf" };
    expect(urlTimbre({ ...base, encf: "E320000000101", total: 1180 })).toContain("fc.dgii.gov.do/certecf/consultatimbrefc?rncemisor=131565296&encf=E320000000101&montototal=1180.00&codigoseguridad=AbCdEf");
    const u = urlTimbre({ ...base, encf: "E310000000101", rncComprador: "130-89207-5", total: 1180 });
    expect(u).toContain("ecf.dgii.gov.do/certecf/consultatimbre?");
    expect(u).toContain("RncComprador=130892075&");
    expect(u).toContain("fechafirma=18-11-2026%2009%3A40%3A00");
  });
  it("mide el texto con Helvetica y pasa los acentos a WinAnsi", () => {
    expect(Math.round(anchoTexto("A", 10))).toBe(7);
    expect(aWinAnsi("Áñ–")).toEqual([193, 241, 150]);
  });
});
