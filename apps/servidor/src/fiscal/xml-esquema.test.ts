import { describe, expect, it } from "vitest";
import { construirEcf, construirRfce, TIPOS_ECF_SOPORTADOS, type DatosEcf, type TipoEcf } from "./xml.js";

const base = (tipo: TipoEcf): DatosEcf => ({
  tipo, encf: `E${tipo.slice(1)}0000000001`, venceSecuencia: "2027-12-31", fechaEmision: new Date("2026-11-02T14:00:00Z"),
  emisor: { rnc: "131000001", razonSocial: "Empresa SRL", direccion: "Calle 1" },
  comprador: null, condicion: "CONTADO", pagos: [{ formaPago: "EFECTIVO", monto: "1180.00" }],
  lineas: [{ nombre: "Producto", cantidad: "1", precioUnitario: "1180.00", descuento: "0", tasaItbis: "0.18", base: "1000.00", itbis: "180.00", total: "1180.00" }],
  totales: { subtotal: "1000.00", itbis: "180.00", total: "1180.00" },
});

// Verificado contra los XSD oficiales de la DGII (apps/servidor/xsd) con xmllint
describe("XML según los esquemas de la DGII", () => {
  it("el E32 de consumo final lleva el bloque Comprador (aunque vacío)", () => {
    expect(construirEcf(base("E32"), new Date())).toContain("<Comprador></Comprador>");
  });
  it("el resumen RFCE lleva Comprador y no lleva ITBIS1/ITBIS2", () => {
    const x = construirRfce(base("E32"), "ABC123");
    expect(x).toContain("<Comprador></Comprador>");
    expect(x).not.toContain("<ITBIS1>");
    expect(x).toContain("<TotalITBIS1>");
  });
  it("el e-CF completo sí conserva ITBIS1", () => {
    expect(construirEcf(base("E31"), new Date())).toContain("<ITBIS1>18</ITBIS1>");
  });
  it("venta a crédito: FechaLimitePago y TerminoPago van justo después de TipoPago", () => {
    const d = { ...base("E31"), condicion: "CREDITO" as const, pagos: [], diasCredito: 30, comprador: { rnc: "101000001", nombre: "Cliente SRL" } };
    const x = construirEcf(d, new Date());
    expect(x).toContain("<TipoPago>2</TipoPago><FechaLimitePago>02-12-2026</FechaLimitePago><TerminoPago>30 dias</TerminoPago>");
    expect(x).not.toContain("TablaFormasPago");
  });
  it("crédito sin días: solo FechaLimitePago (la de emisión); contado no lleva ninguno", () => {
    const sin = construirEcf({ ...base("E31"), condicion: "CREDITO", pagos: [] }, new Date());
    expect(sin).toContain("<FechaLimitePago>02-11-2026</FechaLimitePago>");
    expect(sin).not.toContain("TerminoPago");
    expect(construirEcf(base("E31"), new Date())).not.toContain("FechaLimitePago");
  });
  it("la fecha límite usa hora de RD: una venta a las 11 pm no corre un día", () => {
    const d = { ...base("E31"), condicion: "CREDITO" as const, pagos: [], diasCredito: 15, fechaEmision: new Date("2026-11-03T03:00:00Z") };
    expect(construirEcf(d, new Date())).toContain("<FechaLimitePago>17-11-2026</FechaLimitePago>");
  });
  it("soporta los 10 tipos", () => {
    expect([...TIPOS_ECF_SOPORTADOS]).toEqual(["E31", "E32", "E33", "E34", "E41", "E43", "E44", "E45", "E46", "E47"]);
  });
  it("E34 lleva TipoPago y referencia obligatoria", () => {
    const d = { ...base("E34"), referencia: { encf: "E310000000009", fecha: new Date("2026-10-20T14:00:00Z"), codigoModificacion: "1", razon: "Anulación" } };
    const x = construirEcf(d, new Date());
    expect(x).toContain("<TipoPago>1</TipoPago>");
    expect(x).toContain("<NCFModificado>E310000000009</NCFModificado>");
    expect(x).not.toContain("FechaVencimientoSecuencia");
  });
  it("E43 y E47 van sin ITBIS (exentos) y E47 con retención por línea", () => {
    const l = { nombre: "Gasto", cantidad: "1", precioUnitario: "500.00", descuento: "0", tasaItbis: "0", base: "500.00", itbis: "0.00", total: "500.00", retencion: { isr: "50.00" } };
    const e43 = construirEcf({ ...base("E43"), lineas: [l] }, new Date());
    expect(e43).toContain("<IndicadorFacturacion>4</IndicadorFacturacion>");
    expect(e43).not.toContain("<Comprador");
    const e47 = construirEcf({ ...base("E47"), lineas: [l] }, new Date());
    expect(e47).toContain("<MontoISRRetenido>50.00</MontoISRRetenido>");
    expect(e47).toContain("<TotalISRRetencion>50.00</TotalISRRetencion>");
  });
  it("E46 (exportación) factura gravado a tasa 0", () => {
    const x = construirEcf(base("E46"), new Date());
    expect(x).toContain("<IndicadorFacturacion>3</IndicadorFacturacion>");
    expect(x).toContain("<MontoGravadoI3>");
  });
});
