import { afterEach, describe, expect, it, vi } from "vitest";
import { mapaEstado, pse, SinConexion, type DocumentoEnvio, type FormatoPse } from "./transmisor.js";

const doc: DocumentoEnvio = { encf: "E320000000001", tipo: "E32", modo: "ECF", xml: "<ECF/>", rncEmisor: "131000000" };
const responder = (status: number, cuerpo: unknown) => vi.fn(async () => new Response(JSON.stringify(cuerpo), { status }));

afterEach(() => { vi.unstubAllGlobals(); });

describe("estado devuelto por el proveedor", () => {
  it("lo traduce a los estados de FactPOS", () => {
    expect(mapaEstado("Aceptado")).toBe("ACEPTADO");
    expect(mapaEstado("Aceptado Condicional")).toBe("ACEPTADO_COND");
    expect(mapaEstado("Rechazado")).toBe("RECHAZADO");
    expect(mapaEstado("En Proceso")).toBe("EN_PROCESO");
    expect(mapaEstado(undefined)).toBe("EN_PROCESO");
  });
});

describe("proveedor (PSE)", () => {
  it("acepta un documento y guarda su número de seguimiento", async () => {
    vi.stubGlobal("fetch", responder(200, { estado: "Aceptado", trackId: "T-1" }));
    const r = await pse("https://proveedor.test/api/").enviar(doc);
    expect(r).toMatchObject({ estado: "ACEPTADO", trackId: "T-1" });
    expect((fetch as any).mock.calls[0][0]).toBe("https://proveedor.test/api/ecf");
  });

  it("un documento inválido (400) queda rechazado con el motivo", async () => {
    vi.stubGlobal("fetch", responder(400, { error: "RNC comprador inválido" }));
    const r = await pse("https://proveedor.test").enviar(doc);
    expect(r.estado).toBe("RECHAZADO");
    expect(JSON.stringify(r.mensajes)).toContain("RNC comprador inválido");
  });

  it.each([401, 403])("credenciales rechazadas (%i): NO rechaza el documento, se reintenta", async (status) => {
    vi.stubGlobal("fetch", responder(status, { error: "no autorizado" }));
    await expect(pse("https://proveedor.test").enviar(doc)).rejects.toBeInstanceOf(SinConexion);
  });

  it.each([408, 429, 500, 503])("falla temporal (%i): se reintenta, no se rechaza", async (status) => {
    vi.stubGlobal("fetch", responder(status, {}));
    await expect(pse("https://proveedor.test").enviar(doc)).rejects.toBeInstanceOf(SinConexion);
  });

  it("sin internet: queda en contingencia (SinConexion)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    await expect(pse("https://proveedor.test").enviar(doc)).rejects.toBeInstanceOf(SinConexion);
  });

  it("si el proveedor ya lo tiene (409) no lo duplica: lo consulta por su número", async () => {
    vi.stubGlobal("fetch", responder(409, { error: "ya existe" }));
    const r = await pse("https://proveedor.test").enviar(doc);
    expect(r).toMatchObject({ estado: "EN_PROCESO", trackId: doc.encf });
  });

  it("consultar un documento que aún no aparece (404) lo deja en proceso", async () => {
    vi.stubGlobal("fetch", responder(404, {}));
    const r = await pse("https://proveedor.test").consultar("T-1", doc);
    expect(r).toMatchObject({ estado: "EN_PROCESO", trackId: "T-1" });
  });

  it("consultar devuelve el estado final", async () => {
    vi.stubGlobal("fetch", responder(200, { estado: "Rechazado", mensajes: [{ codigo: 612 }] }));
    const r = await pse("https://proveedor.test").consultar("T-1", doc);
    expect(r.estado).toBe("RECHAZADO");
  });

  it("un proveedor con otro formato solo cambia cómo se arma y se lee la petición", async () => {
    const otro: FormatoPse = {
      nombre: "otro",
      emitir: (d) => ({ ruta: "/v2/documentos", metodo: "POST", cuerpo: { numero: d.encf, xml: d.xml } }),
      consultar: (t) => ({ ruta: `/v2/documentos/${t}/estado` }),
      leer: (_s, c) => ({ estado: c.status === "OK" ? "ACEPTADO" : "EN_PROCESO", trackId: c.id }),
      cabeceras: () => ({ "x-api-key": "k" }),
    };
    vi.stubGlobal("fetch", responder(200, { status: "OK", id: "abc" }));
    const r = await pse("https://otro.test", otro).enviar(doc);
    expect(r).toEqual({ estado: "ACEPTADO", trackId: "abc" });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("https://otro.test/v2/documentos");
    expect(JSON.parse(init.body)).toEqual({ numero: doc.encf, xml: "<ECF/>" });
    expect(init.headers["x-api-key"]).toBe("k");
  });
});
