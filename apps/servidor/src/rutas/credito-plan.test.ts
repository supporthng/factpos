import { describe, expect, it } from "vitest";
import { armarCuotas, estadoCuotas, sumarPeriodos } from "./credito-plan.js";

describe("fechas de las cuotas", () => {
  it("mensual ajusta al último día del mes", () => {
    expect(sumarPeriodos("2026-01-31", "MENSUAL", 1)).toBe("2026-02-28");
    expect(sumarPeriodos("2026-11-16", "MENSUAL", 3)).toBe("2027-02-16");
  });
  it("semanal y quincenal", () => {
    expect(sumarPeriodos("2026-11-16", "SEMANAL", 2)).toBe("2026-11-30");
    expect(sumarPeriodos("2026-11-16", "QUINCENAL", 1)).toBe("2026-12-01");
  });
});

describe("armar cuotas", () => {
  it("interés fijo sobre el capital, repartido en cuotas iguales", () => {
    const p = armarCuotas({ capital: "10000", interesPct: "12", cuotas: 6, frecuencia: "MENSUAL", desde: "2026-11-16" });
    expect(p.interes).toBe("1200.00");
    expect(p.total).toBe("11200.00");
    expect(p.cuotas.map((c) => c.monto)).toEqual(["1866.66", "1866.66", "1866.66", "1866.66", "1866.66", "1866.70"]);
    expect(p.cuotas[0]!.vence).toBe("2026-12-16");
    expect(p.cuotas.reduce((a, c) => a + Number(c.monto), 0)).toBeCloseTo(11200, 2);
  });
  it("sin interés", () => {
    const p = armarCuotas({ capital: "900", interesPct: "0", cuotas: 3, frecuencia: "QUINCENAL", desde: "2026-11-16" });
    expect(p.cuotas.map((c) => c.monto)).toEqual(["300.00", "300.00", "300.00"]);
  });
  it("primera cuota en la fecha indicada", () => {
    const p = armarCuotas({ capital: "100", interesPct: "0", cuotas: 2, frecuencia: "MENSUAL", desde: "2026-11-16", primera: "2026-11-30" });
    expect(p.cuotas.map((c) => c.vence)).toEqual(["2026-11-30", "2026-12-30"]);
  });
});

describe("estado de las cuotas y mora", () => {
  const cuotas = [{ numero: 1, vence: "2026-11-01", monto: "1000.00" }, { numero: 2, vence: "2026-12-01", monto: "1000.00" }];
  it("lo pagado cubre las cuotas por orden", () => {
    const e = estadoCuotas(cuotas, "1500", "2026-11-16", "3", 0);
    expect(e.map((x) => x.estado)).toEqual(["PAGADA", "PARCIAL"]);
    expect(e[1]!.pendiente).toBe("500.00");
  });
  it("mora diaria sobre lo vencido, con días de gracia", () => {
    const e = estadoCuotas(cuotas, "0", "2026-11-16", "3", 5);
    expect(e[0]!.estado).toBe("VENCIDA");
    expect(e[0]!.diasAtraso).toBe(10);
    expect(e[0]!.moraDevengada).toBe("10.00"); // 1000 × 3 % ÷ 30 × 10 días
    expect(e[1]!.estado).toBe("PENDIENTE");
  });
  it("descuenta la mora ya cobrada", () => {
    const e = estadoCuotas([{ ...cuotas[0]!, moraCobrada: "4.00" }], "0", "2026-11-16", "3", 5);
    expect(e[0]!.moraPorCobrar).toBe("6.00");
  });
  it("sin mora configurada no hay recargo", () => {
    expect(estadoCuotas(cuotas, "0", "2026-11-16", "0", 0)[0]!.moraDevengada).toBe("0.00");
  });
});
