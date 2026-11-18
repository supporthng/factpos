import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { certificado, compactarXml, firmarXml } from "./firma.js";

const digest = (x: string) => /<DigestValue>([^<]+)<\/DigestValue>/.exec(x)?.[1];

/** Verifica la firma EN CONTEXTO (con los espacios de nombres que declara la raíz), como lo hace la DGII (.NET). */
function verifica(xmlFirmado: string): boolean {
  const doc = new DOMParser().parseFromString(xmlFirmado, "text/xml");
  const s = (doc as unknown as { getElementsByTagNameNS(ns: string, n: string): ArrayLike<unknown> })
    .getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0];
  const v = new SignedXml({ publicCert: certificado().certPem });
  v.loadSignature(s as never);
  return v.checkSignature(xmlFirmado);
}

describe("firmarXml", () => {
  it("un XML con CRLF se firma igual que el mismo con LF (como lo lee la DGII)", () => {
    const lf = "<Postulacion>\n  <PostulacionID>1</PostulacionID>\n  <Software>\n    <NombreSoftware>FactPos</NombreSoftware>\n  </Software>\n</Postulacion>";
    const crlf = lf.replace(/\n/g, "\r\n");
    const a = firmarXml(lf).xmlFirmado, b = firmarXml(crlf).xmlFirmado;
    expect(digest(a)).toBeTruthy();
    expect(digest(b)).toBe(digest(a));
    expect(b).not.toContain("&#xD;");
  });

  it("la firma de un XML sin espacios de nombres verifica en contexto (comprobantes)", () => {
    expect(verifica(firmarXml("<ECF><Encabezado><Version>1.0</Version></Encabezado></ECF>").xmlFirmado)).toBe(true);
  });

  it("la firma de la semilla de la DGII (raíz con xmlns:xsi y xmlns:xsd) verifica en contexto", () => {
    const semilla = `<?xml version="1.0" encoding="utf-8"?><SemillaModel xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><valor>abc123</valor><fecha>2026-11-18T13:00:00.000-04:00</fecha></SemillaModel>`;
    expect(verifica(firmarXml(semilla).xmlFirmado)).toBe(true);
  });

  it("la firma de la postulación (raíz con xmlns:xsi y xmlns:xsd) verifica en contexto", () => {
    const x = `<Postulacion xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><PostulacionID>1</PostulacionID></Postulacion>`;
    expect(verifica(firmarXml(x).xmlFirmado)).toBe(true);
  });

  it("la semilla de la DGII (CRLF y sangría entre etiquetas) se compacta antes de firmar", () => {
    const semilla = '<SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\r\n  <valor>9/1jfFwb+Xx=</valor>\r\n  <fecha>2026-11-18T14:00:00.000-04:00</fecha>\r\n</SemillaModel>';
    const c = compactarXml(`<?xml version="1.0" encoding="utf-8"?>\r\n`.replace(/^<\?xml[^>]*\?>\s*/, "") + semilla);
    expect(c).not.toMatch(/[\r\n]/);
    expect(c).not.toMatch(/>\s+</);
    expect(c).toContain("<valor>9/1jfFwb+Xx=</valor><fecha>");
    expect(verifica(firmarXml(c).xmlFirmado)).toBe(true);
  });

  it("compactar no toca el texto de los valores", () => {
    expect(compactarXml("<a>\n  <b>un  texto con espacios</b>\n</a>")).toBe("<a><b>un  texto con espacios</b></a>");
  });
});
