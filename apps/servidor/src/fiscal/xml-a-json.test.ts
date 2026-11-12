import { describe, expect, it } from "vitest";
import { ecfXmlAJson } from "./xml-a-json.js";

const xml = `<?xml version="1.0" encoding="utf-8"?><ECF><Encabezado><Version>1.0</Version><IdDoc><TipoeCF>32</TipoeCF><eNCF>E320000000001</eNCF><TipoPago>1</TipoPago>` +
  `<TablaFormasPago><FormaDePago><FormaPago>1</FormaPago><MontoPago>118.00</MontoPago></FormaDePago></TablaFormasPago></IdDoc>` +
  `<Emisor><RNCEmisor>101010101</RNCEmisor><RazonSocialEmisor>Pan &amp; Café</RazonSocialEmisor></Emisor>` +
  `<Totales><MontoTotal>118.00</MontoTotal></Totales></Encabezado>` +
  `<DetallesItems><Item><NumeroLinea>1</NumeroLinea><NombreItem>Pollo</NombreItem><CantidadItem>1.00</CantidadItem><MontoItem>118.00</MontoItem></Item></DetallesItems>` +
  `<FechaHoraFirma>01-01-2026 10:00:00</FechaHoraFirma><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature></ECF>`;

describe("ecfXmlAJson", () => {
  const j = ecfXmlAJson(xml) as any;
  it("usa la raíz ECF y quita la firma", () => {
    expect(Object.keys(j)).toEqual(["ECF"]);
    expect(j.ECF.Signature).toBeUndefined();
    expect(j.ECF.FechaHoraFirma).toBe("01-01-2026 10:00:00");
  });
  it("deja como texto los RNC, e-NCF y códigos, y como número los montos", () => {
    expect(j.ECF.Encabezado.IdDoc.eNCF).toBe("E320000000001");
    expect(j.ECF.Encabezado.IdDoc.TipoeCF).toBe("32");
    expect(j.ECF.Encabezado.Emisor.RNCEmisor).toBe("101010101");
    expect(j.ECF.Encabezado.Totales.MontoTotal).toBe(118);
  });
  it("los ítems y las formas de pago siempre son lista", () => {
    expect(Array.isArray(j.ECF.DetallesItems.Item)).toBe(true);
    expect(j.ECF.DetallesItems.Item[0]).toMatchObject({ NumeroLinea: 1, CantidadItem: 1, MontoItem: 118, NombreItem: "Pollo" });
    expect(j.ECF.Encabezado.IdDoc.TablaFormasPago.FormaDePago).toEqual([{ FormaPago: "1", MontoPago: 118 }]);
  });
  it("desescapa el texto", () => {
    expect(j.ECF.Encabezado.Emisor.RazonSocialEmisor).toBe("Pan & Café");
  });
});
