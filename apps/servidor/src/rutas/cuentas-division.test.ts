import { describe, expect, it } from "vitest";
import { dividirPorAsientos, dividirPorLineas, dividirPorMontos, ErrorDivision, propinaPorParte, repartirIgual, repartirProporcional } from "./cuentas-division.js";

const suma = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("repartirIgual", () => {
  it("reparte sin perder centavos", () => {
    expect(repartirIgual(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(suma(repartirIgual(99999, 7))).toBe(99999);
  });
  it("una sola parte es el total", () => expect(repartirIgual(12345, 1)).toEqual([12345]));
  it("rechaza partes inválidas", () => { expect(() => repartirIgual(100, 0)).toThrow(ErrorDivision); expect(() => repartirIgual(100, 101)).toThrow(ErrorDivision); });
});

describe("repartirProporcional", () => {
  it("la suma es exacta", () => {
    for (const total of [1, 7, 999, 123457]) expect(suma(repartirProporcional(total, [1, 5, 11, 3]))).toBe(total);
  });
  it("con todos los pesos en cero reparte igual", () => expect(repartirProporcional(100, [0, 0])).toEqual([50, 50]));
});

describe("dividirPorMontos", () => {
  it("acepta montos que suman el total", () => expect(dividirPorMontos(10000, [2500, 7500])).toEqual([2500, 7500]));
  it("rechaza si no suman", () => expect(() => dividirPorMontos(10000, [2500, 7000])).toThrow(/suman/));
});

describe("dividirPorLineas", () => {
  const lineas = [{ id: "a", total: 5000 }, { id: "b", total: 3000 }, { id: "c", total: 9001 }];
  it("asigna cada línea a una persona", () => expect(dividirPorLineas(lineas, 2, { a: 0, b: 1, c: 1 })).toEqual([5000, 12001]));
  it("una botella compartida se reparte entre quienes la toman", () => {
    const r = dividirPorLineas(lineas, 3, { a: 0, b: 1 }, { c: [0, 1, 2] });
    expect(suma(r)).toBe(17001);
    expect(r).toEqual([5000 + 3001, 3000 + 3000, 3000]);
  });
  it("falla si queda algo sin asignar", () => expect(() => dividirPorLineas(lineas, 2, { a: 0, b: 1 })).toThrow(/sin asignar/));
});

describe("dividirPorAsientos (antes de ordenar)", () => {
  it("lo de toda la mesa se reparte entre los asientos", () => {
    const r = dividirPorAsientos([{ total: 3000, asiento: 0 }, { total: 2000, asiento: 1 }, { total: 1001, asiento: null }], 2);
    expect(r).toEqual([3000 + 501, 2000 + 500]);
    expect(suma(r)).toBe(6001);
  });
});

describe("propinaPorParte", () => {
  it("la propina de las partes suma la del total", () => {
    const bases = [3334, 3333, 3333];
    expect(suma(propinaPorParte(bases))).toBe(1000);
  });
  it("proporcional a lo consumido", () => expect(propinaPorParte([10000, 30000])).toEqual([1000, 3000]));
});
