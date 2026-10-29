import { describe, expect, it } from "vitest";
import { rncValido, cedulaValida, formatoDocumento } from "./documentos.js";

describe("documentos dominicanos", () => {
  it("RNC: dígito verificador de la DGII", () => {
    expect(rncValido("401506254")).toBe(true);      // RNC de la propia DGII
    expect(rncValido("4-01-50625-4")).toBe(true);   // con guiones
    expect(rncValido("131000002")).toBe(true);
    expect(rncValido("131000001")).toBe(false);     // un dígito mal
    expect(rncValido("12345678")).toBe(false);      // incompleto
  });
  it("cédula: Luhn", () => {
    expect(cedulaValida("40212345678")).toBe(true);
    expect(cedulaValida("402-1234567-8")).toBe(true);
    expect(cedulaValida("40212345679")).toBe(false);
    expect(cedulaValida("4021234567")).toBe(false);
  });
  it("formato", () => {
    expect(formatoDocumento("RNC", "401506254")).toBe("4-01-50625-4");
    expect(formatoDocumento("CEDULA", "40212345678")).toBe("402-1234567-8");
  });
});
