import { describe, expect, it } from "vitest";
import { cantidadSegunPrecio, esUnidadSuelta } from "./unidad.js";

describe("esUnidadSuelta", () => {
  it("UND y similares son unidades sueltas", () => {
    for (const u of ["UND", "und", " Un ", "UDS", "PZA", "Unidad", "u.", "2 UND", "0/15 UND", "20 UND"]) expect(esUnidadSuelta(u)).toBe(true);
  });
  it("cajas y empaques no", () => {
    for (const u of ["CAJ", "CAJA06", "Caja-12", "CAJ / 24 PZA", "6x75", "", null, undefined]) expect(esUnidadSuelta(u)).toBe(false);
  });
});

describe("cantidadSegunPrecio", () => {
  it("corrige la cantidad cuando importe ÷ precio da un entero distinto", () => {
    expect(cantidadSegunPrecio(2, 55.11, 826.65)).toBe(15);
    expect(cantidadSegunPrecio(2, 55.11, 330.66)).toBe(6);
  });
  it("no toca lo coherente, lo dudoso ni lo que tiene descuento", () => {
    expect(cantidadSegunPrecio(15, 55.11, 826.65)).toBeNull();
    expect(cantidadSegunPrecio(2, 55.11, 400)).toBeNull();
    expect(cantidadSegunPrecio(2, 55.11, 826.65, 10)).toBeNull();
    expect(cantidadSegunPrecio(2, 0, 826.65)).toBeNull();
  });
});
