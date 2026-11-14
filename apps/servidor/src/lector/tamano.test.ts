import { describe, expect, it } from "vitest";
import { compararTamano, sinTamano, tamanoDe } from "./tamano.js";

describe("tamaño", () => {
  it("convierte a gramos y mililitros", () => {
    expect(tamanoDe("DORITOS NACHO CHEESE 55OZ")?.base).toBeCloseTo(1559.2, 0);
    expect(tamanoDe("DORITOS NACHO CHEESE 85G")?.base).toBe(85);
    expect(tamanoDe("AGUA 1.5 L")?.base).toBe(1500);
    expect(tamanoDe("JW BLUE 75 CL")?.base).toBe(750);
    expect(tamanoDe("PAPAS TA")).toBeNull();
  });
  it("compara con conversión y detecta la confusión de unidad", () => {
    expect(compararTamano(tamanoDe("LECHE 1 L"), tamanoDe("LECHE 1000 ML"))).toBe("igual");
    expect(compararTamano(tamanoDe("QUESO 16 OZ"), tamanoDe("QUESO 454 G"))).toBe("igual");
    expect(compararTamano(tamanoDe("DORITOS 55OZ"), tamanoDe("DORITOS 55G"))).toBe("confundible");
    expect(compararTamano(tamanoDe("DORITOS 55OZ"), tamanoDe("DORITOS 85G"))).toBe("distinto");
    expect(compararTamano(tamanoDe("AGUA 1 L"), tamanoDe("AGUA 1 KG"))).toBe("n/a");
  });
  it("sinTamano deja solo el nombre", () => {
    expect(sinTamano("DORITOS NACHO CHEESE 55OZ")).toBe("DORITOS NACHO CHEESE");
    expect(sinTamano("7UP LIMON 1.5 L")).toBe("7UP LIMON");
  });
});
