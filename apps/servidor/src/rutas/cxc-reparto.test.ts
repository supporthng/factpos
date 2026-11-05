import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { errorPagoAFactura, repartirACuenta } from "./cxc-reparto.js";

const F = (ventaId: string, pendiente: string) => ({ ventaId, pendiente });
const montos = (p: { monto: Decimal }[]) => p.map((x) => x.monto.toFixed(2));

describe("repartirACuenta (abono a la cuenta)", () => {
  it("paga primero la factura más antigua", () => {
    const r = repartirACuenta([F("a", "100.00"), F("b", "50.00")], "60.00");
    expect(r.map((x) => x.ventaId)).toEqual(["a"]);
    expect(montos(r)).toEqual(["60.00"]);
  });
  it("el sobrante de una factura pasa a la siguiente", () => {
    const r = repartirACuenta([F("a", "100.00"), F("b", "50.00")], "130.00");
    expect(r.map((x) => x.ventaId)).toEqual(["a", "b"]);
    expect(montos(r)).toEqual(["100.00", "30.00"]);
  });
  it("pago exacto de todas las facturas no deja sobrante sin factura", () => {
    const r = repartirACuenta([F("a", "100.00"), F("b", "50.00")], "150.00");
    expect(r.map((x) => x.ventaId)).toEqual(["a", "b"]);
    expect(r.some((x) => x.ventaId === null)).toBe(false);
  });
  it("lo que sobra de todas las facturas queda como abono sin factura", () => {
    const r = repartirACuenta([F("a", "100.00")], "130.00");
    expect(r.map((x) => x.ventaId)).toEqual(["a", null]);
    expect(montos(r)).toEqual(["100.00", "30.00"]);
  });
  it("sin facturas pendientes todo queda a la cuenta", () => {
    const r = repartirACuenta([], "75.50");
    expect(r.map((x) => x.ventaId)).toEqual([null]);
    expect(montos(r)).toEqual(["75.50"]);
  });
  it("ignora facturas ya pagadas (pendiente 0)", () => {
    const r = repartirACuenta([F("a", "0.00"), F("b", "40.00")], "40.00");
    expect(r.map((x) => x.ventaId)).toEqual(["b"]);
  });
  it("la suma de las partes siempre es el monto pagado (sin perder centavos)", () => {
    const monto = "333.33";
    const r = repartirACuenta([F("a", "100.10"), F("b", "99.99"), F("c", "200.00")], monto);
    const suma = r.reduce((a, x) => a.plus(x.monto), new Decimal(0));
    expect(suma.toFixed(2)).toBe(monto);
  });
});

describe("errorPagoAFactura (abono a una factura)", () => {
  it("acepta un pago menor o igual a lo que debe", () => {
    expect(errorPagoAFactura("100.00", "100.00")).toBeNull();
    expect(errorPagoAFactura("100.00", "0.01")).toBeNull();
  });
  it("rechaza un pago mayor a lo que debe la factura", () => {
    expect(errorPagoAFactura("100.00", "100.01")).toBe("La factura debe 100.00: el pago no puede ser mayor");
  });
  it("rechaza pagar una factura que ya está pagada", () => {
    expect(errorPagoAFactura("0.00", "10.00")).toBe("Esa factura ya está pagada");
  });
});
