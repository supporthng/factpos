import { describe, expect, it } from "vitest";
import { calcularLinea, totalizar, validarPagos, formatoRD } from "./impuestos.js";
import { uuidv7 } from "./ids.js";
import { leerCodigoBalanza, digitoVerificadorEan13 } from "./balanza.js";

describe("calcularLinea", () => {
  it("separa el ITBIS de un precio que ya lo incluye", () => {
    const l = calcularLinea({ cantidad: 1, precioUnitario: "118.00", tasaItbis: "0.18", precioIncluyeItbis: true });
    expect(l).toMatchObject({ base: "100.00", itbis: "18.00", total: "118.00" });
  });

  it("base + itbis siempre suma el total exacto", () => {
    const l = calcularLinea({ cantidad: 3, precioUnitario: "45.50", tasaItbis: "0.18", precioIncluyeItbis: true });
    expect(Number(l.base) + Number(l.itbis)).toBeCloseTo(Number(l.total), 10);
    expect(l.total).toBe("136.50");
  });

  it("agrega el ITBIS cuando el precio no lo incluye", () => {
    const l = calcularLinea({ cantidad: 2, precioUnitario: "50", tasaItbis: "0.18", precioIncluyeItbis: false });
    expect(l).toMatchObject({ base: "100.00", itbis: "18.00", total: "118.00" });
  });

  it("producto exento no lleva ITBIS", () => {
    const l = calcularLinea({ cantidad: 5, precioUnitario: "25", tasaItbis: 0, precioIncluyeItbis: true });
    expect(l).toMatchObject({ base: "125.00", itbis: "0.00", total: "125.00" });
  });

  it("maneja productos pesables con tres decimales", () => {
    const l = calcularLinea({ cantidad: "1.235", precioUnitario: "89.00", tasaItbis: 0, precioIncluyeItbis: true });
    expect(l.total).toBe("109.92"); // 1.235 × 89 = 109.915 → 109.92
  });

  it("aplica el descuento antes del impuesto", () => {
    const l = calcularLinea({ cantidad: 1, precioUnitario: "236", tasaItbis: "0.18", precioIncluyeItbis: true, descuento: "118" });
    expect(l).toMatchObject({ base: "100.00", itbis: "18.00", total: "118.00", descuento: "118.00" });
  });

  it("evita los errores de punto flotante", () => {
    const l = calcularLinea({ cantidad: 3, precioUnitario: "0.10", tasaItbis: 0, precioIncluyeItbis: true });
    expect(l.total).toBe("0.30"); // con float sería 0.30000000000000004
  });

  it("rechaza datos inválidos", () => {
    expect(() => calcularLinea({ cantidad: 0, precioUnitario: 10, tasaItbis: 0, precioIncluyeItbis: true })).toThrow();
    expect(() => calcularLinea({ cantidad: 1, precioUnitario: 10, tasaItbis: 0, precioIncluyeItbis: true, descuento: 20 })).toThrow();
  });
});

describe("totalizar y pagos", () => {
  const lineas = [
    calcularLinea({ cantidad: 1, precioUnitario: "118", tasaItbis: "0.18", precioIncluyeItbis: true }),
    calcularLinea({ cantidad: 2, precioUnitario: "25", tasaItbis: 0, precioIncluyeItbis: true }),
  ];
  const tot = totalizar(lineas);

  it("suma las líneas", () => {
    expect(tot).toEqual({ subtotal: "150.00", descuento: "0.00", itbis: "18.00", total: "168.00" });
  });

  it("calcula el cambio en pago mixto", () => {
    const p = validarPagos(tot.total, [
      { formaPago: "TARJETA", monto: "100", referencia: "482913" },
      { formaPago: "EFECTIVO", monto: "68", recibido: "100" },
    ]);
    expect(p[1].cambio).toBe("32.00");
  });

  it("rechaza pagos que no cuadran", () => {
    expect(() => validarPagos(tot.total, [{ formaPago: "EFECTIVO", monto: "100" }])).toThrow();
  });

  it("formatea en pesos dominicanos", () => {
    expect(formatoRD("1234567.5")).toBe("RD$1,234,567.50");
  });
});

describe("uuidv7", () => {
  it("genera IDs válidos y ordenados por tiempo", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe("códigos de balanza", () => {
  it("lee producto y peso", () => {
    const doce = "200123001235"; // 2 + producto 00123 + 0 + peso 01235 g
    const codigo = doce + digitoVerificadorEan13(doce);
    expect(leerCodigoBalanza(codigo)).toEqual({ codigoProducto: "00123", valor: 1.235, modo: "PESO" });
  });

  it("rechaza un dígito verificador incorrecto", () => {
    expect(leerCodigoBalanza("2001230012358")).toBeNull();
  });
});

describe("pago con tarjeta", () => {
  it("exige el número de aprobación del voucher", () => {
    expect(() => validarPagos("100", [{ formaPago: "TARJETA", monto: "100" }])).toThrow(/aprobación/);
    expect(() => validarPagos("100", [{ formaPago: "TARJETA", monto: "100", referencia: "12" }])).toThrow(/aprobación/);
    expect(validarPagos("100", [{ formaPago: "TARJETA", monto: "100", referencia: "482913" }])[0].monto).toBe("100.00");
  });
  it("pago mixto: efectivo con cambio y tarjeta con aprobación", () => {
    const r = validarPagos("1500", [
      { formaPago: "TARJETA", monto: "1000", referencia: "A7731" },
      { formaPago: "EFECTIVO", monto: "500", recibido: "1000" },
    ]);
    expect(r[1].cambio).toBe("500.00");
  });
});
