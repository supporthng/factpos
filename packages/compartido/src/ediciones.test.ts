import { describe, expect, it } from "vitest";
import { EDICIONES, edicionPorId, nombreEdicion } from "./ediciones.js";
import { TIPOS_NEGOCIO } from "./tipo-negocio.js";

describe("ediciones", () => {
  it("cada edición apunta a un tipo de negocio que existe y tiene id y slug únicos", () => {
    for (const e of EDICIONES) expect(TIPOS_NEGOCIO).toContain(e.tipoNegocio);
    expect(new Set(EDICIONES.map((e) => e.id)).size).toBe(EDICIONES.length);
    expect(new Set(EDICIONES.map((e) => e.slug)).size).toBe(EDICIONES.length);
  });
  it("mueblería y bar/restaurante fijan su tipo; las de tienda quedan en TIENDA", () => {
    expect(edicionPorId("MUEBLERIA")?.tipoNegocio).toBe("MUEBLERIA");
    expect(edicionPorId("BAR_RESTAURANTE")?.tipoNegocio).toBe("RESTAURANTE");
    for (const id of ["ABARROTES", "LICORERIA", "SUPERMERCADO"]) expect(edicionPorId(id)?.tipoNegocio).toBe("TIENDA");
  });
  it("sin edición (o una desconocida) es FactPOS estándar", () => {
    expect(nombreEdicion(null)).toBe("FactPOS");
    expect(nombreEdicion("XYZ")).toBe("FactPOS");
    expect(nombreEdicion("ABARROTES")).toBe("FactPOS Abarrotes");
  });
});
