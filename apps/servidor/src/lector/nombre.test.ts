import { describe, expect, it } from "vitest";
import { nombreLimpio } from "./nombre.js";

describe("nombre limpio de producto de factura", () => {
  it("quita el código y el empaque final, deja nombre y presentación", () => {
    expect(nombreLimpio("300028208-CHEETOS CORN JUMBO PUFF 9OZX12X1")).toBe("CHEETOS CORN JUMBO PUFF 9OZ");
    expect(nombreLimpio("CHEETS CORN JUMBO PUFF 8OZXA12X1")).toBe("CHEETS CORN JUMBO PUFF 8OZ");
    expect(nombreLimpio("300055371-CARIBAS AJO CS 110GX30X1")).toBe("CARIBAS AJO CS 110G");
    expect(nombreLimpio("300060578-LAYS CLASICAS CS 80GX24X1")).toBe("LAYS CLASICAS CS 80G");
    expect(nombreLimpio("NATUCHIPS YUCA CS 33GX70X1")).toBe("NATUCHIPS YUCA CS 33G");
    expect(nombreLimpio("CARIBEA 6X12X1.140OZXA1")).toBe("CARIBEA 6X12X1.140OZ");
  });
  it("regla general: cualquier producto, aunque la IA haya leído mal el empaque", () => {
    expect(nombreLimpio("CHICHARRON CS 6X502XA1")).toBe("CHICHARRON CS");
    expect(nombreLimpio("NATYCHIPS PL ALO 12.5X385RXA1")).toBe("NATYCHIPS PL ALO");
    expect(nombreLimpio("LAYS CLASSICS CS 6X30XA1")).toBe("LAYS CLASSICS CS");
    expect(nombreLimpio("RUFFLES CHEDDAR DE SAL 12.5X55OZXA1")).toBe("RUFFLES CHEDDAR DE SAL 55OZ");
    expect(nombreLimpio("300055756-RUFFLES CHEEDAR CS TA 55GX50X1")).toBe("RUFFLES CHEEDAR CS TA 55G");
    expect(nombreLimpio("300059691-NATUCHIPS YUCA CS 33GX70X1")).toBe("NATUCHIPS YUCA CS 33G");
  });
  it("quita el código si viene aparte y repetido al inicio", () => {
    expect(nombreLimpio("30008208 CHEETOS CORN 8OZ", "30008208")).toBe("CHEETOS CORN 8OZ");
  });
  it("no toca NxVOLUMEN ni nombres que no tienen empaque al final", () => {
    expect(nombreLimpio("JW BLUE 6x75 CL")).toBe("JW BLUE 6x75 CL");
    expect(nombreLimpio("OLD PARR 12x75 CL")).toBe("OLD PARR 12x75 CL");
    expect(nombreLimpio("Agua Planeta Azul 500ML")).toBe("Agua Planeta Azul 500ML");
    expect(nombreLimpio("X12X1")).toBe("X12X1"); // si no queda nada, se deja la original
  });
});
