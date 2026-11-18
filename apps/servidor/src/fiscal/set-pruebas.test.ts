import { describe, expect, it } from "vitest";
import { armarAcecfDeFila, armarXmlDeFila, limpiarFila } from "./set-pruebas.js";

const base = {
  Version: "1.0", TipoeCF: "32", ENCF: "E320000000003", TipoIngresos: "01", TipoPago: "1",
  "FormaPago[1]": "1", "MontoPago[1]": "118.00", RNCEmisor: "131000001", RazonSocialEmisor: "Empresa SRL", DireccionEmisor: "Calle 1",
  FechaEmision: "01-04-2020", MontoTotal: "118.00",
  "NumeroLinea[1]": "1", "IndicadorFacturacion[1]": "1", "NombreItem[1]": "Producto A & B", "IndicadorBienoServicio[1]": "1",
  "CantidadItem[1]": "1", "PrecioUnitarioItem[1]": "118.00", "MontoItem[1]": "118.00",
  "NumeroLinea[2]": "2", "IndicadorFacturacion[2]": "1", "NombreItem[2]": "Producto C", "IndicadorBienoServicio[2]": "1",
  "CantidadItem[2]": "1", "PrecioUnitarioItem[2]": "10.00", "MontoItem[2]": "10.00",
  "TipoCodigo[2][1]": "Interno", "CodigoItem[2][1]": "X1", "TelefonoEmisor[1]": "809-000-0001", "TelefonoEmisor[2]": "809-000-0002",
};

describe("set de pruebas de la DGII", () => {
  it("quita las celdas vacías y el marcador #e", () => {
    expect(limpiarFila({ A: "x", B: "#e", C: "", D: null, E: " 5 " })).toEqual({ A: "x", E: "5" });
  });
  it("arma el XML en el orden del esquema, con tablas e ítems indexados y texto escapado", () => {
    const { xml, tipo, encf, sinUsar } = armarXmlDeFila(base, "ECF", { FechaHoraFirma: "01-04-2020 10:00:00" });
    expect(tipo).toBe("E32");
    expect(encf).toBe("E320000000003");
    expect(sinUsar).toEqual([]);
    expect(xml).toContain("<TablaFormasPago><FormaDePago><FormaPago>1</FormaPago><MontoPago>118.00</MontoPago></FormaDePago></TablaFormasPago>");
    expect(xml).toContain("<TablaTelefonoEmisor><TelefonoEmisor>809-000-0001</TelefonoEmisor><TelefonoEmisor>809-000-0002</TelefonoEmisor></TablaTelefonoEmisor>");
    expect(xml).toContain("Producto A &amp; B");
    expect(xml.match(/<Item>/g)).toHaveLength(2);
    expect(xml).toContain("<TablaCodigosItem><CodigosItem><TipoCodigo>Interno</TipoCodigo><CodigoItem>X1</CodigoItem></CodigosItem></TablaCodigosItem>");
    expect(xml.indexOf("<IdDoc>")).toBeLessThan(xml.indexOf("<Emisor>"));
    expect(xml.endsWith("<FechaHoraFirma>01-04-2020 10:00:00</FechaHoraFirma></ECF>")).toBe(true);
  });
  it("el E32 lleva el bloque Comprador aunque el set no traiga datos del comprador", () => {
    expect(armarXmlDeFila(base, "ECF").xml).toContain("<Comprador></Comprador>");
  });
  it("avisa de las columnas que el esquema no reconoce", () => {
    expect(armarXmlDeFila({ ...base, ColumnaRara: "1" }, "ECF").sinUsar).toEqual(["columnarara"]);
  });
  it("rechaza un tipo que no se puede armar", () => {
    expect(() => armarXmlDeFila({ ...base, TipoeCF: "99" }, "ECF")).toThrow(/no soportado/);
  });
  it("el resumen RFCE lleva el código de seguridad", () => {
    const r = armarXmlDeFila({ Version: "1.0", TipoeCF: "32", ENCF: "E320000000003", TipoIngresos: "01", TipoPago: "1", RNCEmisor: "1", RazonSocialEmisor: "X", FechaEmision: "01-04-2020", MontoTotal: "5" }, "RFCE", { CodigoSeguridadeCF: "ABC123" });
    expect(r.xml).toContain("<CodigoSeguridadeCF>ABC123</CodigoSeguridadeCF></Encabezado></RFCE>");
  });
});

describe("aprobaciones comerciales del set (hoja ACECF)", () => {
  const fila = { RNCEmisor: "130-89207-5", eNCF: "E310000000010", FechaEmision: "05-11-2026", MontoTotal: "1,180.50", RNCComprador: "131565296", Estado: "1" };
  it("arma el ACECF aprobado con los datos de la fila", () => {
    const r = armarAcecfDeFila(fila, new Date("2026-11-18T14:00:00Z"));
    expect(r.aceptado).toBe(true);
    expect(r.rncComprador).toBe("131565296");
    expect(r.xml).toContain("<RNCEmisor>130892075</RNCEmisor>");
    expect(r.xml).toContain("<eNCF>E310000000010</eNCF>");
    expect(r.xml).toContain("<MontoTotal>1180.50</MontoTotal>");
    expect(r.xml).toContain("<Estado>1</Estado>");
    expect(r.xml).not.toContain("DetalleMotivoRechazo");
  });
  it("usa la fecha y hora de aprobación que trae el set (la DGII la compara)", () => {
    const r = armarAcecfDeFila({ ...fila, FechaHoraAprobacionComercial: "18-11-2026 16:58:42" }, new Date("2026-11-18T14:00:00Z"));
    expect(r.xml).toContain("<FechaHoraAprobacionComercial>18-11-2026 16:58:42</FechaHoraAprobacionComercial>");
  });
  it("un rechazo lleva su motivo y sin motivo no se arma", () => {
    expect(armarAcecfDeFila({ ...fila, Estado: "2", DetalleMotivoRechazo: "Monto incorrecto" }).xml).toContain("<DetalleMotivoRechazo>Monto incorrecto</DetalleMotivoRechazo>");
    expect(() => armarAcecfDeFila({ ...fila, Estado: "2" })).toThrow(/motivo/i);
  });
  it("avisa de lo que falta o no es válido", () => {
    expect(() => armarAcecfDeFila({ ...fila, Estado: "3" })).toThrow(/Estado/);
    expect(() => armarAcecfDeFila({ ...fila, eNCF: "" })).toThrow(/eNCF/);
  });
});
