import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cifrarArchivo, descifrarArchivo, nuevaClave } from "./cripto.js";
import { presignar } from "./s3.js";

describe("presignar (AWS SigV4)", () => {
  it("coincide con el ejemplo oficial de AWS", () => {
    const url = presignar({ endpoint: "https://s3.amazonaws.com", bucket: "examplebucket", keyId: "AKIAIOSFODNN7EXAMPLE",
      secreto: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", estilo: "virtual" },
      "GET", "test.txt", 86400, new Date("2013-05-24T00:00:00Z"));
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(url.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?")).toBe(true);
  });
});

describe("cifrado de respaldos", () => {
  const carpeta = mkdtempSync(path.join(tmpdir(), "fpbak-"));
  const claro = path.join(carpeta, "a.fpbak");
  const datos = Buffer.alloc(300_000, "FactPOS respaldo ");

  it("cifra y descifra igual", async () => {
    writeFileSync(claro, datos);
    const k = nuevaClave();
    const r = await cifrarArchivo(claro, path.join(carpeta, "a.cif"), k);
    expect(r.tamano).toBe(readFileSync(path.join(carpeta, "a.cif")).length);
    expect(readFileSync(path.join(carpeta, "a.cif")).includes("FactPOS respaldo")).toBe(false);
    await descifrarArchivo(path.join(carpeta, "a.cif"), path.join(carpeta, "b.fpbak"), k);
    expect(readFileSync(path.join(carpeta, "b.fpbak")).equals(datos)).toBe(true);
  });
  it("rechaza una clave equivocada o un archivo alterado", async () => {
    writeFileSync(claro, datos);
    const k = nuevaClave();
    const cif = path.join(carpeta, "c.cif");
    await cifrarArchivo(claro, cif, k);
    await expect(descifrarArchivo(cif, path.join(carpeta, "x"), nuevaClave())).rejects.toThrow(/clave/);
    const b = readFileSync(cif); b[100] ^= 1; writeFileSync(cif, b);
    await expect(descifrarArchivo(cif, path.join(carpeta, "y"), k)).rejects.toThrow(/clave|dañado/);
  });
});
