import { describe, expect, it } from "vitest";
import { cotizarCarrito, type LineaCarrito } from "./carrito.js";
import { descuentoOferta, type Oferta } from "./promociones.js";

/**
 * Caso del audio: "20 whiskies a 800; cuando facture los 20, que avise que se
 * acabó la oferta y siga facturando a precio normal".
 */
const whisky = (restantes: string | null): Oferta => ({
  id: "of-whisky", nombre: "Whisky a 800", tipo: "PRECIO_ESPECIAL", valor: "800", lleva: null, paga: null,
  cantidadMinima: "1", iniciaEn: "2026-01-01T00:00:00Z", terminaEn: "2027-01-01T00:00:00Z",
  diasSemana: null, horaDesde: null, horaHasta: null, prioridad: 0, restantes,
});
const linea = (cantidad: string, o: Oferta, factor = "1", precio = "1000"): LineaCarrito => ({
  cantidad, precio, tasaItbis: "0.18", precioIncluyeItbis: true, esPesable: false, nombre: "Whisky", ofertas: [o], factor,
});
const AHORA = new Date("2026-10-28T16:00:00Z");

describe("ofertas con tope de unidades", () => {
  it("sin tope aplica a todas las unidades", () => {
    expect(descuentoOferta(whisky(null), { cantidad: 25, precioUnitario: "1000" }).toFixed(2)).toBe("5000.00");
  });

  it("con 20 restantes, 25 unidades: 20 a 800 y 5 a precio normal", () => {
    const r = cotizarCarrito([linea("25", whisky("20"))], null, AHORA);
    expect(r.lineas[0].oferta?.unidades).toBe("20");
    expect(r.lineas[0].oferta?.agotada).toBe(true);
    expect(r.totales.total).toBe((20 * 800 + 5 * 1000).toFixed(2));
    expect(r.ofertasAgotadas).toEqual([{ ofertaId: "of-whisky", nombre: "Whisky a 800" }]);
  });

  it("el tope se comparte entre líneas de la misma venta", () => {
    const o = whisky("3");
    const r = cotizarCarrito([linea("2", o), linea("2", o)], null, AHORA);
    expect(r.lineas[0].oferta?.unidades).toBe("2");
    expect(r.lineas[1].oferta?.unidades).toBe("1");
    expect(r.totales.total).toBe((3 * 800 + 1 * 1000).toFixed(2));
  });

  it("agotada: todo a precio normal y avisa", () => {
    const r = cotizarCarrito([linea("2", whisky("0"))], null, AHORA);
    expect(r.lineas[0].oferta).toBeNull();
    expect(r.totales.total).toBe("2000.00");
    expect(r.ofertasAgotadas).toHaveLength(1);
  });

  it("las cajas consumen unidades base (caja x12 cuenta 12)", () => {
    // Quedan 20 unidades: solo 1 caja de 12 cabe en la oferta; la segunda va a precio normal
    const r = cotizarCarrito([linea("2", { ...whisky("20"), valor: "9000" }, "12", "11000")], null, AHORA);
    expect(r.lineas[0].oferta?.unidades).toBe("1");
    expect(r.totales.total).toBe((9000 + 11000).toFixed(2));
  });

  it("si no se llega al tope no avisa", () => {
    const r = cotizarCarrito([linea("5", whisky("20"))], null, AHORA);
    expect(r.ofertasAgotadas).toEqual([]);
    expect(r.totales.total).toBe("4000.00");
  });
});
