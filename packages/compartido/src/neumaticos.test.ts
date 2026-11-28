import { describe, expect, it } from "vitest";
import { leerMedida, leerDot, fechaDeFabricacion, vencimientoDot, edadDot } from "./neumaticos.js";

describe("medida del neumático", () => {
  it("entiende las formas de escribirla", () => {
    for (const t of ["205/55R16", "205/55 r16", "205 55 16", "205/55-16", "205/55ZR16"]) {
      const m = leerMedida(t);
      expect(m?.ancho).toBe(205);
      expect(m?.perfil).toBe(55);
      expect(m?.rin).toBe(16);
    }
    expect(leerMedida("205 55 16")?.texto).toBe("205/55R16");
  });
  it("moto, camión y bicicleta", () => {
    expect(leerMedida("90/90-18")).toMatchObject({ ancho: 90, perfil: 90, rin: 18, texto: "90/90-18" });
    expect(leerMedida("11R22.5")).toMatchObject({ ancho: 11, perfil: null, rin: 22.5 });
    expect(leerMedida("295/80R22.5")).toMatchObject({ ancho: 295, perfil: 80, rin: 22.5 });
    expect(leerMedida("26x1.95")).toMatchObject({ ancho: 1.95, perfil: null, rin: 26, texto: "26x1.95" });
  });
  it("lo que no es una medida devuelve null", () => {
    expect(leerMedida("")).toBeNull();
    expect(leerMedida("llanta grande")).toBeNull();
  });
});

describe("DOT", () => {
  it("semana y año", () => {
    expect(leerDot("2324")).toEqual({ semana: 23, anio: 2024 });
    expect(leerDot("5424")).toBeNull();
    expect(leerDot("12")).toBeNull();
  });
  it("fecha de fabricación y vencimiento a 6 años", () => {
    expect(fechaDeFabricacion("0124")).toBe("2024-01-01");
    expect(fechaDeFabricacion("0224")).toBe("2024-01-08");
    expect(vencimientoDot("0124")).toBe("2030-01-01");
    expect(vencimientoDot("xx")).toBeNull();
  });
  it("edad en años", () => {
    expect(edadDot("0120", new Date("2026-01-01T00:00:00Z"))).toBe(6);
  });
});
