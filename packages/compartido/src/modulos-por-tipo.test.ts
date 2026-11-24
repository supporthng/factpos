import { describe, expect, it } from "vitest";
import { seccionDisponible, funcionProductoDisponible, SECCIONES_POR_TIPO } from "./modulos-por-tipo.js";
import { TIPOS_NEGOCIO } from "./tipo-negocio.js";

describe("pantallas por tipo de negocio", () => {
  it("cada pantalla exclusiva apunta a tipos que existen", () => {
    for (const tipos of Object.values(SECCIONES_POR_TIPO)) for (const t of tipos) expect(TIPOS_NEGOCIO).toContain(t);
  });
  it("la farmacia solo la ve la farmacia; la mueblería su cobranza y entregas", () => {
    expect(seccionDisponible("farmacia", "FARMACIA")).toBe(true);
    for (const t of ["TIENDA", "MUEBLERIA", "BAR"]) expect(seccionDisponible("farmacia", t)).toBe(false);
    for (const id of ["planes", "cobranza", "mora", "entregas"]) {
      expect(seccionDisponible(id, "MUEBLERIA")).toBe(true);
      for (const t of ["TIENDA", "FARMACIA", "RESTAURANTE"]) expect(seccionDisponible(id, t)).toBe(false);
    }
  });
  it("lo común (ventas, inventario, cuentas por cobrar…) lo ve todo tipo; sin tipo conocido no se esconde nada", () => {
    for (const t of TIPOS_NEGOCIO) for (const id of ["vender", "facturas", "productos", "cxc", "atrasados", "recibos", "comisiones", "delivery"]) expect(seccionDisponible(id, t)).toBe(true);
    expect(seccionDisponible("farmacia", "")).toBe(true);
    expect(seccionDisponible("planes", null)).toBe(true);
  });
  it("series y servicio técnico: tiendas y mueblerías, no bares ni farmacias", () => {
    for (const id of ["series", "servicio"]) {
      expect(seccionDisponible(id, "TIENDA")).toBe(true);
      expect(seccionDisponible(id, "MUEBLERIA")).toBe(true);
      expect(seccionDisponible(id, "FARMACIA")).toBe(false);
      expect(seccionDisponible(id, "BAR")).toBe(false);
    }
  });
  it("funciones de la ficha del producto", () => {
    expect(funcionProductoDisponible("valeConsumos", "DISCOTECA")).toBe(true);
    expect(funcionProductoDisponible("valeConsumos", "TIENDA")).toBe(false);
    expect(funcionProductoDisponible("seriesGarantia", "FARMACIA")).toBe(false);
    expect(funcionProductoDisponible("tragos", "MUEBLERIA")).toBe(false);
    expect(funcionProductoDisponible("tragos", "")).toBe(true);
  });
});
