import { describe, expect, it } from "vitest";
import { cotizarCarrito, type LineaCarrito } from "./carrito.js";

const linea = (extra: Partial<LineaCarrito> = {}): LineaCarrito => ({
  cantidad: "2", precio: "100.00", tasaItbis: "0.18", precioIncluyeItbis: true, esPesable: false, nombre: "Producto", ofertas: [], ...extra,
});

describe("descuento por nivel de precio (precios 2 y 3 como % sobre el precio 1)", () => {
  it("cobra el precio 1 y marca el descuento en la línea", () => {
    const r = cotizarCarrito([linea({ descuentoNivelPct: "10" })]);
    expect(r.lineas[0]!.descuentoNivel).toBe("20.00");   // 10 % de 200
    expect(r.lineas[0]!.calc.descuento).toBe("20.00");
    expect(r.totales.total).toBe("180.00");
  });

  it("sin porcentaje no cambia nada", () => {
    const r = cotizarCarrito([linea()]);
    expect(r.lineas[0]!.descuentoNivel).toBe("0.00");
    expect(r.totales.total).toBe("200.00");
  });

  it("un descuento manual reemplaza al del nivel (no se acumulan)", () => {
    const r = cotizarCarrito([linea({ descuentoNivelPct: "10", descuentoManual: "5.00" })]);
    expect(r.lineas[0]!.descuentoNivel).toBe("0.00");
    expect(r.totales.total).toBe("195.00");
  });

  it("base e ITBIS cuadran con el total", () => {
    const r = cotizarCarrito([linea({ cantidad: "3", precio: "59.90", descuentoNivelPct: "12.5" })]);
    const c = r.lineas[0]!.calc;
    expect(Number(c.base) + Number(c.itbis)).toBeCloseTo(Number(c.total), 2);
  });
});
