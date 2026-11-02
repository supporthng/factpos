import { describe, expect, it } from "vitest";
import { upcaAUpce, upceAUpca, variantesCodigoBarra } from "./codigos-barra.js";

describe("variantesCodigoBarra", () => {
  it("la forma leída va primero", () => {
    expect(variantesCodigoBarra("7501055300075")[0]).toBe("7501055300075");
  });
  it("EAN-13 con cero inicial incluye el UPC-A y viceversa", () => {
    const v = variantesCodigoBarra("0012345678905");
    expect(v).toContain("012345678905");
    expect(variantesCodigoBarra("012345678905")).toContain("0012345678905");
  });
  it("sin ceros iniciales (los que borra Excel)", () => {
    expect(variantesCodigoBarra("0012345678905")).toContain("12345678905");
  });
  it("UPC-E ↔ UPC-A", () => {
    const upca = "042100005264";
    const upce = upcaAUpce(upca)[0];
    expect(upce).toBe("04252614");
    expect(upceAUpca(upce)).toBe(upca);
    expect(variantesCodigoBarra(upce)).toContain(upca);
  });
  it("texto no numérico se deja igual", () => {
    expect(variantesCodigoBarra(" AB-12 ")).toEqual(["AB-12"]);
  });
});
