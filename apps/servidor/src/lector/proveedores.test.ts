import { describe, expect, it } from "vitest";
import { cuerpoGemini, leerRespuestaGemini, ordenProveedores } from "./proveedores.js";

describe("orden de proveedores del lector", () => {
  const g = { GEMINI_API_KEY: "g" }, a = { ANTHROPIC_API_KEY: "a" };
  it("auto: gratis primero y el de pago como respaldo solo si la licencia lo autoriza", () => {
    expect(ordenProveedores({ ...g, ...a }, true)).toEqual(["gratis", "pago"]);
    expect(ordenProveedores({ ...g, ...a }, false)).toEqual(["gratis"]);
    expect(ordenProveedores({ ...g, ...a })).toEqual(["gratis"]); // sin autorización por omisión
    expect(ordenProveedores({ ...g }, true)).toEqual(["gratis"]);
    expect(ordenProveedores({ ...a }, true)).toEqual(["pago"]);
    expect(ordenProveedores({ ...a }, false)).toEqual([]); // sin llave gratis y sin permiso: no se llama a Claude
    expect(ordenProveedores({})).toEqual([]);
  });
  it("se puede forzar uno solo", () => {
    expect(ordenProveedores({ ...g, ...a, LECTOR_PROVEEDOR: "pago" }, true)).toEqual(["pago"]);
    expect(ordenProveedores({ ...g, ...a, LECTOR_PROVEEDOR: "pago" }, false)).toEqual([]);
    expect(ordenProveedores({ ...g, ...a, LECTOR_PROVEEDOR: "gratis" }, true)).toEqual(["gratis"]);
    expect(ordenProveedores({ ...a, LECTOR_PROVEEDOR: "gratis" }, true)).toEqual([]); // sin la llave que pide
    expect(ordenProveedores({ ...g, ...a, LECTOR_PROVEEDOR: "GRATIS" }, true)).toEqual(["gratis"]);
  });
});

describe("petición a Gemini", () => {
  it("lleva el documento, las instrucciones y el esquema", () => {
    const c = cuerpoGemini({ tipo: "application/pdf", datos: "QUJD", instrucciones: "Lee la factura.", esquema: { type: "object" } });
    expect(c.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "application/pdf", data: "QUJD" } });
    expect(c.systemInstruction.parts[0].text).toContain("Lee la factura.");
    expect(c.systemInstruction.parts[0].text).toContain('{"type":"object"}');
    expect(c.generationConfig.responseMimeType).toBe("application/json");
  });
});

describe("respuesta de Gemini", () => {
  const resp = (texto: string, extra: object = {}) => ({ candidates: [{ content: { parts: [{ text: texto }] }, ...extra }] });
  const ok = { items: [{ descripcion: "Ron 12x75cl", cantidad: 2, precioUnitario: 100 }], preciosIncluyenItbis: true, columnas: ["Cant"] };
  it("lee el JSON, también si viene en un bloque de código", () => {
    expect(leerRespuestaGemini(resp(JSON.stringify(ok))).preciosIncluyenItbis).toBe(true);
    expect(leerRespuestaGemini(resp("```json\n" + JSON.stringify(ok) + "\n```")).items).toHaveLength(1);
  });
  it("completa lo mínimo que el sistema espera", () => {
    const r = leerRespuestaGemini(resp(JSON.stringify({ items: ok.items })));
    expect(r.columnas).toEqual([]);
    expect(r.preciosIncluyenItbis).toBe(false);
  });
  it("rechaza respuestas vacías, rotas o sin productos", () => {
    expect(() => leerRespuestaGemini({})).toThrow(/no devolvió datos/);
    expect(() => leerRespuestaGemini({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(/SAFETY/);
    expect(() => leerRespuestaGemini(resp("no es json"))).toThrow(/no es JSON/);
    expect(() => leerRespuestaGemini(resp("[]"))).toThrow(/inesperado/);
    expect(() => leerRespuestaGemini(resp(JSON.stringify({ items: [] })))).toThrow(/no encontró productos/);
    expect(() => leerRespuestaGemini(resp(JSON.stringify({ items: [{ cantidad: 1 }] })))).toThrow(/sin descripción/);
    expect(() => leerRespuestaGemini(resp("{\"items\":[", { finishReason: "MAX_TOKENS" }))).toThrow(/muy larga/);
  });
});
