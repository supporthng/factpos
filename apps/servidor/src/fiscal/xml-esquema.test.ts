import { describe, expect, it } from "vitest";
import { construirEcf, construirRfce, type DatosEcf } from "./xml.js";

const base = (tipo: "E31" | "E32"): DatosEcf => ({
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
});
