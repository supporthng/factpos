import { describe, expect, it } from "vitest";
import { esMuebleria, esNegocioDeMesas, TIPOS_NEGOCIO } from "./tipo-negocio.js";

describe("tipo de negocio", () => {
  it("los de mesas usan cuentas abiertas; la tienda y la mueblería no", () => {
    for (const t of ["RESTAURANTE", "BAR", "DISCOTECA", "COMIDA_RAPIDA"]) expect(esNegocioDeMesas(t)).toBe(true);
    for (const t of ["TIENDA", "MUEBLERIA", "", null, undefined]) expect(esNegocioDeMesas(t)).toBe(false);
  });
  it("solo MUEBLERIA es mueblería", () => {
    expect(esMuebleria("MUEBLERIA")).toBe(true);
    expect(esMuebleria("TIENDA")).toBe(false);
    expect(TIPOS_NEGOCIO).toContain("MUEBLERIA");
  });
});
