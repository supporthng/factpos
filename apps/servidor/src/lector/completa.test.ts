import { describe, expect, it } from "vitest";
import { montoFaltante, unirFaltantes } from "./completa.js";

const l = (descripcion: string, cantidad: number, precioUnitario: number) => ({ descripcion, cantidad, precioUnitario });

describe("lectura completa de la factura", () => {
  it("detecta cuando las líneas leídas suman mucho menos que el subtotal impreso", () => {
    const f = { subtotal: 7426.8, total: 8763.68, items: [l("A", 12, 100), l("B", 10, 100)] };
    expect(montoFaltante(f)).toBeGreaterThan(5000);
  });
  it("no avisa si cuadra dentro de la tolerancia", () => {
    expect(montoFaltante({ subtotal: 2250, items: [l("A", 12, 100), l("B", 10, 100)] })).toBe(0);
  });
  it("sin cifras para comparar no hace nada", () => {
    expect(montoFaltante({ items: [l("A", 1, 100)] })).toBe(0);
  });
  it("usa el total si no hay subtotal", () => {
    expect(montoFaltante({ total: 11800, items: [l("A", 10, 100)] })).toBeGreaterThan(8000);
  });
  it("une solo las líneas nuevas", () => {
    const r = unirFaltantes({ items: [l("A", 1, 1)] }, { items: [l("A", 1, 1), l("B", 2, 5)] });
    expect(r.agregadas).toBe(1);
    expect(r.factura.items).toHaveLength(2);
  });
});
