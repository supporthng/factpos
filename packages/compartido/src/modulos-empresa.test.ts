import { describe, expect, it } from "vitest";
import { TAMANOS_VEHICULO, modulosDeEmpresa, tieneMesas, tieneModulo } from "./modulos-empresa.js";
import { TIPOS_NEGOCIO, esNegocioDeMesas } from "./tipo-negocio.js";

describe("módulos de la empresa", () => {
  it("sin extras, tieneMesas coincide exactamente con esNegocioDeMesas para cada tipo", () => {
    for (const t of TIPOS_NEGOCIO) expect(tieneMesas(t)).toBe(esNegocioDeMesas(t));
    expect(tieneMesas(null)).toBe(false);
    expect(tieneMesas(undefined, [])).toBe(false);
  });
  it("un tipo sin mesas las enciende con el módulo extra", () => {
    expect(tieneMesas("TIENDA", ["MESAS"])).toBe(true);
    expect(tieneMesas("FARMACIA", ["MESAS"])).toBe(true);
  });
  it("el módulo de lavado solo existe si se enciende", () => {
    expect(tieneModulo("LAVADO", "BAR")).toBe(false);
    expect(tieneModulo("LAVADO", "BAR", ["LAVADO"])).toBe(true);
    expect(tieneMesas("BAR", ["LAVADO"])).toBe(true);
    expect(tieneModulo("SALON", "TIENDA")).toBe(false);
    expect(tieneModulo("SALON", "TIENDA", ["SALON"])).toBe(true);
  });
  it("sin duplicados y se ignora lo desconocido", () => {
    expect(modulosDeEmpresa("BAR", ["MESAS", "MESAS", "OTRO"])).toEqual(["MESAS"]);
    expect(modulosDeEmpresa("TIENDA", ["OTRO"])).toEqual([]);
  });
  it("la gomera enciende GOMERA y sus servicios de taller", () => {
    expect(modulosDeEmpresa("TIENDA", ["GOMERA", "LAVADO"]).sort()).toEqual(["GOMERA", "LAVADO"]);
    expect(tieneModulo("GOMERA", "TIENDA", [])).toBe(false);
  });
  it("la bicicleta es un tamaño de vehículo", () => {
    expect(TAMANOS_VEHICULO.map((t) => t.id)).toContain("BICICLETA");
  });
});
