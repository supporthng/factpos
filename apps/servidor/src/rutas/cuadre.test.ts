import { describe, expect, it } from "vitest";
import { diferenciaCierre, efectivoContado, efectivoEsperado, esperadoPorForma } from "./cuadre.js";

describe("efectivoEsperado", () => {
  it("fondo + ventas en efectivo + entradas − salidas", () => {
    expect(efectivoEsperado({ fondoInicial: "5000.00", ventasEfectivo: "12000.50", entradas: "300.00", salidas: "1500.25" }).toFixed(2)).toBe("15800.25");
  });
  it("sin movimientos es solo el fondo inicial", () => {
    expect(efectivoEsperado({ fondoInicial: "2000", ventasEfectivo: 0, entradas: 0, salidas: 0 }).toFixed(2)).toBe("2000.00");
  });
});

describe("esperadoPorForma", () => {
  const base = { fondoInicial: "1000", ventasEfectivo: "500", entradas: "0", salidas: "0", ventasTarjeta: "800", ventasTransferencia: "200", abonosTarjeta: "0", abonosTransferencia: "0" };
  it("tarjeta y transferencia son lo vendido con esa forma", () => {
    const e = esperadoPorForma(base);
    expect(e).toEqual({ EFECTIVO: "1500.00", TARJETA: "800.00", TRANSFERENCIA: "200.00" });
  });
  it("los abonos con tarjeta o transferencia se cuadran en su forma, no en la gaveta", () => {
    const e = esperadoPorForma({ ...base, abonosTarjeta: "150.00", abonosTransferencia: "75.50" });
    expect(e.TARJETA).toBe("950.00");
    expect(e.TRANSFERENCIA).toBe("275.50");
    expect(e.EFECTIVO).toBe("1500.00");
  });
});

describe("diferenciaCierre", () => {
  const esperado = { EFECTIVO: "1500.00", TARJETA: "800.00", TRANSFERENCIA: "200.00" };
  it("cuadra exacto: diferencia 0", () => {
    expect(diferenciaCierre({ ...esperado }, esperado).toFixed(2)).toBe("0.00");
  });
  it("falta dinero en la gaveta: diferencia negativa", () => {
    expect(diferenciaCierre({ ...esperado, EFECTIVO: "1450.00" }, esperado).toFixed(2)).toBe("-50.00");
  });
  it("sobra dinero: diferencia positiva", () => {
    expect(diferenciaCierre({ ...esperado, TARJETA: "805.25" }, esperado).toFixed(2)).toBe("5.25");
  });
  it("las diferencias de cada forma se suman", () => {
    expect(diferenciaCierre({ EFECTIVO: "1400.00", TARJETA: "810.00", TRANSFERENCIA: "200.00" }, esperado).toFixed(2)).toBe("-90.00");
  });
});

describe("efectivoContado", () => {
  it("suma billetes y monedas por denominación", () => {
    expect(efectivoContado({ "2000": 3, "500": 4, "25": 2, "1": 7 }).toFixed(2)).toBe("8057.00");
  });
  it("sin conteo es cero", () => {
    expect(efectivoContado({}).toFixed(2)).toBe("0.00");
  });
});
