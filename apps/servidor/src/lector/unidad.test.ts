import { describe, expect, it } from "vitest";
import { esUnidadSuelta } from "./unidad.js";

describe("esUnidadSuelta", () => {
  it("UND y similares son unidades sueltas", () => {
    for (const u of ["UND", "und", " Un ", "UDS", "PZA", "Unidad", "u."]) expect(esUnidadSuelta(u)).toBe(true);
  });
  it("cajas y empaques no", () => {
    for (const u of ["CAJ", "CAJA06", "Caja-12", "CAJ / 24 PZA", "6x75", "", null, undefined]) expect(esUnidadSuelta(u)).toBe(false);
  });
});
