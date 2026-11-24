import { describe, expect, it } from "vitest";
import { EDICIONES, edicionPorId, nombreEdicion, tituloPorTipo } from "./ediciones.js";
import { TIPOS_NEGOCIO } from "./tipo-negocio.js";

describe("ediciones", () => {
  it("cada edición apunta a un tipo de negocio que existe y tiene id y slug únicos", () => {
    for (const e of EDICIONES) expect(TIPOS_NEGOCIO).toContain(e.tipoNegocio);
    expect(new Set(EDICIONES.map((e) => e.id)).size).toBe(EDICIONES.length);
    expect(new Set(EDICIONES.map((e) => e.slug)).size).toBe(EDICIONES.length);
  });
  it("mueblería y bar/restaurante son derivados y fijan su tipo de negocio", () => {
    expect(edicionPorId("MUEBLERIA")?.tipoNegocio).toBe("MUEBLERIA");
    expect(edicionPorId("BAR_RESTAURANTE")?.tipoNegocio).toBe("RESTAURANTE");
  });
  it("farmacia es una edición derivada", () => {
    expect(edicionPorId("FARMACIA")?.tipoNegocio).toBe("FARMACIA");
    expect(nombreEdicion("FARMACIA")).toBe("FactPOS Farmacia");
  });
  it("abarrotes, supermercado y licorería son FactPOS a secas (no tienen edición)", () => {
    for (const id of ["ABARROTES", "LICORERIA", "SUPERMERCADO"]) expect(edicionPorId(id)).toBeUndefined();
  });
  it("sin edición (o una desconocida) es FactPOS estándar", () => {
    expect(nombreEdicion(null)).toBe("FactPOS");
    expect(nombreEdicion("XYZ")).toBe("FactPOS");
    expect(nombreEdicion("MUEBLERIA")).toBe("FactPOS Mueblería");
  });
  it("el título de la ventana lleva el tipo de negocio; la tienda es FactPOS a secas", () => {
    expect(tituloPorTipo("FARMACIA")).toBe("FactPOS Farmacia");
    expect(tituloPorTipo("MUEBLERIA")).toBe("FactPOS Mueblería");
    expect(tituloPorTipo("TIENDA")).toBe("FactPOS");
    expect(tituloPorTipo(null)).toBe("FactPOS");
    for (const t of TIPOS_NEGOCIO) expect(tituloPorTipo(t).startsWith("FactPOS")).toBe(true);
  });
});
