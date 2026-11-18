import { describe, expect, it } from "vitest";
import { firmarXml } from "./firma.js";

const digest = (x: string) => /<DigestValue>([^<]+)<\/DigestValue>/.exec(x)?.[1];

describe("firmarXml", () => {
  it("un XML con CRLF se firma igual que el mismo con LF (como lo lee la DGII)", () => {
    const lf = "<Postulacion>\n  <PostulacionID>1</PostulacionID>\n  <Software>\n    <NombreSoftware>FactPos</NombreSoftware>\n  </Software>\n</Postulacion>";
    const crlf = lf.replace(/\n/g, "\r\n");
    const a = firmarXml(lf).xmlFirmado, b = firmarXml(crlf).xmlFirmado;
    expect(digest(a)).toBeTruthy();
    expect(digest(b)).toBe(digest(a));
    expect(b).not.toContain("&#xD;");
  });
});
