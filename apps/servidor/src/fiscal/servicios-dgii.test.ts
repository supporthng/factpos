import { describe, expect, it } from "vitest";
import { firmarXml } from "./firma.js";
import {
  construirAcecf, construirAnecf, construirArecf, emitirToken, fechaHoraDgii, firmaValida, nuevaSemilla, semillaValida, tokenValido, valorDe, xmlDeMultipart, xmlSemilla,
} from "./servicios-dgii.js";

describe("autenticación sin estado", () => {
  it("una semilla recién emitida vale; vencida o alterada, no", () => {
    const s = nuevaSemilla(1_000_000);
    expect(semillaValida(s.valor, 1_000_000 + 60_000)).toBe(true);
    expect(semillaValida(s.valor, 1_000_000 + 6 * 60_000)).toBe(false);
    expect(semillaValida(s.valor.replace(/.$/, "x"), 1_000_000 + 1000)).toBe(false);
    expect(semillaValida("cualquier-cosa")).toBe(false);
  });
  it("el token vale una hora y no se puede inventar", () => {
    const t = emitirToken(5_000_000);
    expect(tokenValido(t.token, 5_000_000 + 1000)).toBe(true);
    expect(tokenValido(t.token, 5_000_000 + 2 * 3600_000)).toBe(false);
    expect(tokenValido("a.b")).toBe(false);
    expect(tokenValido(undefined)).toBe(false);
  });
  it("el XML de la semilla lleva su valor", () => {
    const s = nuevaSemilla();
    expect(valorDe(xmlSemilla(s), "valor")).toBe(s.valor);
  });
});

describe("multipart", () => {
  it("saca el archivo del campo xml", () => {
    const b = "----x";
    const cuerpo = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="xml"; filename="a.xml"\r\nContent-Type: text/xml\r\n\r\n<A><B>1</B></A>\r\n--${b}--\r\n`);
    expect(xmlDeMultipart(cuerpo, `multipart/form-data; boundary=${b}`)).toBe("<A><B>1</B></A>");
    expect(xmlDeMultipart(cuerpo, "multipart/form-data")).toBeNull();
  });
});

describe("firma", () => {
  it("un XML firmado verifica y uno alterado no", () => {
    const { xmlFirmado } = firmarXml("<ARECF><Detalle><eNCF>E310000000001</eNCF></Detalle></ARECF>");
    expect(firmaValida(xmlFirmado)).toBe(true);
    expect(firmaValida(xmlFirmado.replace("E310000000001", "E310000000002"))).toBe(false);
    expect(firmaValida("<A/>")).toBe(false);
  });
});

describe("XML de respuesta", () => {
  const ahora = new Date("2026-11-02T14:05:09Z");
  it("hora de la DGII: dd-MM-AAAA HH:mm:ss en hora dominicana", () => {
    expect(fechaHoraDgii(ahora)).toBe("02-11-2026 10:05:09");
  });
  it("acuse de recibo recibido y no recibido (con motivo)", () => {
    const ok = construirArecf({ rncEmisor: "131000001", rncComprador: "131000002", encf: "E310000000001", estado: 0, ahora });
    expect(valorDe(ok, "Estado")).toBe("0");
    expect(ok).not.toContain("CodigoMotivoNoRecibido");
    const no = construirArecf({ rncEmisor: "131000001", rncComprador: "131000002", encf: "E310000000001", estado: 1, motivo: 3, ahora });
    expect(valorDe(no, "CodigoMotivoNoRecibido")).toBe("3");
  });
  it("aprobación comercial: rechazo lleva motivo", () => {
    const base = { rncEmisor: "131000001", encf: "E310000000001", fechaEmision: "01-11-2026", montoTotal: "1180.00", rncComprador: "131000002", ahora };
    expect(construirAcecf({ ...base, aceptado: true })).not.toContain("DetalleMotivoRechazo");
    expect(valorDe(construirAcecf({ ...base, aceptado: false, motivoRechazo: "Mercancía dañada" }), "DetalleMotivoRechazo")).toBe("Mercancía dañada");
  });
  it("anulación: agrupa por tipo y suma la cantidad", () => {
    const x = construirAnecf({ rncEmisor: "131000001", ahora, rangos: [
      { tipo: "E31", desde: "E310000000001", hasta: "E310000000001" },
      { tipo: "E31", desde: "E310000000005", hasta: "E310000000050" },
      { tipo: "E44", desde: "E440000000010", hasta: "E440000000012" },
    ] });
    expect(x.match(/<Anulacion>/g)).toHaveLength(2);
    expect(x).toContain("<CantidadeNCFAnulados>51</CantidadeNCFAnulados>");
    expect(x).toContain("<CantidadeNCFAnulados>3</CantidadeNCFAnulados>");
    expect(valorDe(x, "FechaHoraAnulacioneNCF")).toBe("02-11-2026 10:05:09");
    expect(x.match(/<Encabezado>.*?<\/Encabezado>/)?.[0]).toContain("<CantidadeNCFAnulados>54</CantidadeNCFAnulados>");
  });
});
