import { describe, expect, it } from "vitest";
import { crearLimitador, ipCliente } from "./seguridad-web.js";

describe("seguridad web", () => {
  it("toma la dirección real detrás de un proxy", () => {
    expect(ipCliente({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, ip: "10.0.0.1" } as never)).toBe("1.2.3.4");
    expect(ipCliente({ headers: { "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" }, ip: "10.0.0.1" } as never)).toBe("9.9.9.9");
    expect(ipCliente({ headers: {}, ip: "5.5.5.5" } as never)).toBe("5.5.5.5");
  });
  it("limita por ventana y vuelve a permitir después", () => {
    const l = crearLimitador(2, 1000);
    expect(l("a", 0)).toBe(true); expect(l("a", 1)).toBe(true); expect(l("a", 2)).toBe(false);
    expect(l("b", 3)).toBe(true);
    expect(l("a", 2000)).toBe(true);
  });
});
