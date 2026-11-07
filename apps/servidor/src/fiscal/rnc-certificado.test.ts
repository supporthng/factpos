import { describe, expect, it } from "vitest";
import { rncDelCertificado } from "./firma.js";

describe("rncDelCertificado", () => {
  it("coincide cuando el titular trae el RNC de la empresa", () => {
    expect(rncDelCertificado("CN=JUAN PEREZ SRL, serialNumber=RNC131234567, C=DO", "131234567").coincide).toBe(true);
  });
  it("no coincide cuando trae el RNC de otra empresa", () => {
    const r = rncDelCertificado("CN=JUAN PEREZ 1 SRL, serialNumber=131111111", "132222222");
    expect(r.coincide).toBe(false);
    expect(r.encontrados).toEqual(["131111111"]);
  });
  it("coincide con la cédula si la empresa es una persona física", () => {
    expect(rncDelCertificado("CN=Juan Perez, serialNumber=IDCDO-00112345678", "00112345678").coincide).toBe(true);
  });
  it("devuelve null cuando el certificado no trae ningún RNC visible", () => {
    expect(rncDelCertificado("CN=Juan Perez, O=Perez", "131234567").coincide).toBeNull();
    expect(rncDelCertificado(undefined, "131234567").coincide).toBeNull();
  });
});
