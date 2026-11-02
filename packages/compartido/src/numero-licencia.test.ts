import { describe, expect, it } from "vitest";
import { numeroLicencia } from "./ids.js";

describe("numeroLicencia", () => {
  it("tiene el formato FPOS-XXXX-XXXX-XXXX y es siempre el mismo para la misma licencia", () => {
    const a = numeroLicencia("01a19290-548c-76f6-ab21-78270e57bbfd");
    expect(a).toMatch(/^FPOS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(numeroLicencia("01a19290-548c-76f6-ab21-78270e57bbfd")).toBe(a);
  });
  it("licencias distintas dan números distintos y sin id muestra un guion", () => {
    expect(numeroLicencia("01a19290-548c-76f6-ab21-78270e57bbfd")).not.toBe(numeroLicencia("01a19290-548c-76f6-ab21-78270e57bbfe"));
    expect(numeroLicencia(null)).toBe("—");
  });
});
