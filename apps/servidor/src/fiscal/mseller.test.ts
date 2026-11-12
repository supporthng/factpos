import { afterEach, describe, expect, it, vi } from "vitest";
import { estadoMseller, leerCredencialesMseller, mseller, transmisorPse } from "./transmisor.js";

const cred = { email: "a@b.com", password: "x", apiKey: "k" };
const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.f`;
const xml = `<ECF><Encabezado><IdDoc><TipoeCF>31</TipoeCF><eNCF>E310000000001</eNCF></IdDoc><Totales><MontoTotal>118.00</MontoTotal></Totales></Encabezado><DetallesItems><Item><NumeroLinea>1</NumeroLinea></Item></DetallesItems></ECF>`;
const doc = { encf: "E310000000001", tipo: "E31", modo: "ECF" as const, xml: "<resumen/>", xmlCompleto: xml, rncEmisor: "1" };

afterEach(() => vi.restoreAllMocks());

describe("MSeller", () => {
  it("traduce los estados", () => {
    expect(estadoMseller("Aceptado")).toBe("ACEPTADO");
    expect(estadoMseller("Aceptado Condicional")).toBe("ACEPTADO_COND");
    expect(estadoMseller("Rechazado")).toBe("RECHAZADO");
    for (const s of ["En Cola", "Enviado a la DGII", "En Proceso", "No encontrado", "Error"]) expect(estadoMseller(s)).toBe("EN_PROCESO");
  });
  it("lee las credenciales guardadas y rechaza las incompletas", () => {
    expect(leerCredencialesMseller(JSON.stringify(cred))).toEqual(cred);
    expect(leerCredencialesMseller(JSON.stringify({ email: "a" }))).toBeNull();
    expect(leerCredencialesMseller("basura")).toBeNull();
  });
  it("se autentica, envía el e-CF completo en JSON con la API Key y consulta por e-NCF", async () => {
    const llamadas: { url: string; init: any }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      llamadas.push({ url, init });
      const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      if (url.endsWith("/TesteCF/customer/authentication")) return j({ idToken: jwt("u-1"), accessToken: "a", refreshToken: "r" });
      if (url.endsWith("/TesteCF/documentos-ecf") && init.method === "POST") return j({ ecf: "E310000000001", internalTrackId: "t", securityCode: "ABC123", qr_url: "https://qr" });
      return j({ status: "Aceptado", ecf: "E310000000001" });
    }));
    const t = mseller(cred, "TESTECF");
    const e = await t.enviar(doc);
    expect(e).toMatchObject({ estado: "EN_PROCESO", trackId: "E310000000001" });
    const envio = llamadas.find((l) => l.url.endsWith("/documentos-ecf") && l.init.method === "POST")!;
    expect(envio.init.headers).toMatchObject({ "x-api-key": "k" });
    expect(JSON.parse(envio.init.body).ECF.Encabezado.IdDoc.eNCF).toBe("E310000000001");
    const c = await t.consultar("E310000000001", doc);
    expect(c.estado).toBe("ACEPTADO");
  });
  it("una validación rechazada por MSeller deja el comprobante rechazado, sin reintentos", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/customer/authentication")
      ? new Response(JSON.stringify({ idToken: jwt("u") }), { status: 200 })
      : new Response(JSON.stringify({ code: "ECF_VALIDATION_FAILED" }), { status: 400 })));
    expect((await mseller(cred, "TESTECF").enviar(doc)).estado).toBe("RECHAZADO");
  });
  it("transmisorPse elige MSeller por el nombre del proveedor", () => {
    expect(transmisorPse({ pse_nombre: "MSeller", ambiente: "TESTECF" }, JSON.stringify(cred))).not.toBeNull();
    expect(() => transmisorPse({ pse_nombre: "mseller", ambiente: "SIMULADO" }, JSON.stringify(cred))).toThrow();
  });
});
