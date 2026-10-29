import { describe, expect, it } from "vitest";
import { descuentoOferta, mejorOferta, ofertaVigente, aplicarCupon, prorratear, type Oferta } from "./promociones.js";

const base: Omit<Oferta, "id" | "nombre" | "tipo"> = {
  valor: null, lleva: null, paga: null, cantidadMinima: "1",
  iniciaEn: "2026-01-01T00:00:00Z", terminaEn: "2027-01-01T00:00:00Z",
  diasSemana: null, horaDesde: null, horaHasta: null, prioridad: 0,
};
const oferta = (o: Partial<Oferta> & Pick<Oferta, "tipo">): Oferta => ({ id: "o", nombre: "o", ...base, ...o });
const AHORA = new Date("2026-10-28T16:00:00Z"); // miércoles 12:00 en RD

describe("tipos de oferta", () => {
  it("porcentaje", () => {
    expect(descuentoOferta(oferta({ tipo: "PORCENTAJE", valor: "10" }), { cantidad: 2, precioUnitario: "150" }).toFixed(2)).toBe("30.00");
  });

  it("precio especial", () => {
    expect(descuentoOferta(oferta({ tipo: "PRECIO_ESPECIAL", valor: "650" }), { cantidad: 1, precioUnitario: "750" }).toFixed(2)).toBe("100.00");
  });

  it("2x1 cuenta solo grupos completos", () => {
    const dosPorUno = oferta({ tipo: "LLEVA_PAGA", lleva: 2, paga: 1 });
    expect(descuentoOferta(dosPorUno, { cantidad: 5, precioUnitario: "150" }).toFixed(2)).toBe("300.00"); // 2 gratis
    expect(descuentoOferta(dosPorUno, { cantidad: 1, precioUnitario: "150" }).toFixed(2)).toBe("0.00");
  });

  it("por volumen solo desde la cantidad mínima", () => {
    const vol = oferta({ tipo: "POR_VOLUMEN", valor: "135", cantidadMinima: "6" });
    expect(descuentoOferta(vol, { cantidad: 5, precioUnitario: "150" }).toFixed(2)).toBe("0.00");
    expect(descuentoOferta(vol, { cantidad: 6, precioUnitario: "150" }).toFixed(2)).toBe("90.00");
  });
});

describe("vigencia", () => {
  it("respeta el rango de fechas", () => {
    expect(ofertaVigente(oferta({ tipo: "PORCENTAJE", valor: "5", terminaEn: "2026-10-01T00:00:00Z" }), AHORA)).toBe(false);
  });

  it("happy hour según la hora de RD", () => {
    const hh = oferta({ tipo: "PORCENTAJE", valor: "15", horaDesde: "18:00:00", horaHasta: "21:00:00" });
    expect(ofertaVigente(hh, AHORA)).toBe(false);                                  // 12:00
    expect(ofertaVigente(hh, new Date("2026-10-28T23:30:00Z"))).toBe(true);       // 19:30
  });

  it("happy hour que cruza la medianoche", () => {
    const noche = oferta({ tipo: "PORCENTAJE", valor: "15", horaDesde: "22:00:00", horaHasta: "02:00:00" });
    expect(ofertaVigente(noche, new Date("2026-10-29T05:00:00Z"))).toBe(true);     // 01:00
  });

  it("solo ciertos días", () => {
    const finde = oferta({ tipo: "PORCENTAJE", valor: "10", diasSemana: [5, 6] });  // viernes y sábado
    expect(ofertaVigente(finde, AHORA)).toBe(false);                               // miércoles
  });
});

describe("mejorOferta", () => {
  it("elige la de mayor descuento, sin acumular", () => {
    const r = mejorOferta(
      [oferta({ id: "a", nombre: "10%", tipo: "PORCENTAJE", valor: "10" }), oferta({ id: "b", nombre: "2x1", tipo: "LLEVA_PAGA", lleva: 2, paga: 1 })],
      { cantidad: 2, precioUnitario: "150" },
      AHORA,
    );
    expect(r).toEqual({ ofertaId: "b", nombre: "2x1", descuento: "150.00", precioEfectivo: "75.00", unidades: "2", agotada: false });
  });
});

describe("cupones", () => {
  const cupon = { id: "c", codigo: "BIENVENIDO", tipo: "PORCENTAJE" as const, valor: "10", compraMinima: "500", topeDescuento: "200", acumulableConOfertas: false };

  it("no descuenta líneas en oferta si no es acumulable", () => {
    const r = aplicarCupon(cupon, ["600", "400"], [false, true]);
    expect(r).toEqual({ total: "60.00", porLinea: ["60.00", "0.00"] });
  });

  it("respeta el tope", () => {
    expect(aplicarCupon(cupon, ["5000"], [false]).total).toBe("200.00");
  });

  it("exige compra mínima", () => {
    expect(() => aplicarCupon(cupon, ["100"], [false])).toThrow(/compra mínima/);
  });

  it("el prorrateo cuadra al centavo", () => {
    const partes = prorratear("100", ["33.33", "33.33", "33.34"]);
    expect(partes.reduce((a, p) => a + Number(p), 0)).toBeCloseTo(100, 10);
  });
});

import { ajustarContraste, contraste, extraerPaleta, temaAdmin, temaTerminal } from "./tema.js";
describe("tema camaleón", () => {
  it("un amarillo de logo se oscurece para leerse sobre blanco", () => {
    const c = ajustarContraste("#ffd400", "#ffffff", 4.5);
    expect(contraste(c, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
  it("un azul marino se aclara para leerse sobre la terminal oscura", () => {
    const t = temaTerminal({ primario: "#0a1f44" });
    expect(contraste(t["--primario"], "#16202a")).toBeGreaterThanOrEqual(4.5);
    expect(contraste(t["--cobrar"], "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
  it("el texto de la barra lateral siempre se lee", () => {
    const t = temaAdmin({ primario: "#e30613", secundario: "#ffffff" });
    expect(contraste(t["--marca"], t["--marca-texto"])).toBeGreaterThanOrEqual(4.5);
  });
  it("extrae primero los colores del logo y deja el blanco del fondo al final", () => {
    const px: number[] = [];
    for (let i = 0; i < 600; i++) px.push(255, 255, 255, 255);   // fondo blanco
    for (let i = 0; i < 300; i++) px.push(227, 6, 19, 255);      // rojo
    for (let i = 0; i < 100; i++) px.push(0, 82, 155, 255);      // azul
    const p = extraerPaleta(px);
    expect(p[0]).toMatch(/^#e[0-9a-f]0[0-9a-f]1[0-9a-f]$/);
    expect(p[p.length - 1]).toBe("#ffffff");
  });
});
