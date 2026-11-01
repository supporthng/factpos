import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, openSync, readSync, closeSync, fstatSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";

/**
 * Cifrado de los respaldos que salen a la nube: AES-256-GCM. La clave la tiene solo el cliente
 * (clave de recuperación); FactPOS y el proveedor de almacenamiento guardan archivos ilegibles.
 * Formato: "FPBK1\0" (6) + iv (12) + datos cifrados + etiqueta de autenticación (16).
 */
const MARCA = Buffer.from("FPBK1\0");
const IV = 12, ETIQUETA = 16;

export const nuevaClave = () => randomBytes(32).toString("hex");
const llave = (hex: string) => {
  const b = Buffer.from(hex.replace(/[^0-9a-f]/gi, ""), "hex");
  if (b.length !== 32) throw new Error("La clave de recuperación no es válida");
  return b;
};
/** 64 caracteres en grupos de 8, para leerla y escribirla */
export const formatearClave = (hex: string) => hex.match(/.{8}/g)!.join("-").toUpperCase();

export async function cifrarArchivo(origen: string, destino: string, claveHex: string): Promise<{ tamano: number; sha256: string }> {
  const iv = randomBytes(IV);
  const cif = createCipheriv("aes-256-gcm", llave(claveHex), iv);
  const hash = createHash("sha256");
  const out = createWriteStream(destino);
  out.write(Buffer.concat([MARCA, iv]));
  const fin = new Promise<void>((ok, mal) => { out.on("finish", ok); out.on("error", mal); });
  await pipeline(createReadStream(origen), cif, async function* (fuente: AsyncIterable<Buffer>) {
    for await (const t of fuente) { hash.update(t); yield t; }
  }, out, { end: false } as never).catch(async (e) => { out.destroy(); throw e; });
  out.end(cif.getAuthTag());
  await fin;
  const tamano = MARCA.length + IV + statSync(origen).size + ETIQUETA;
  return { tamano, sha256: hash.digest("hex") };
}

export async function descifrarArchivo(origen: string, destino: string, claveHex: string): Promise<void> {
  const fd = openSync(origen, "r");
  let cab: Buffer, etiqueta: Buffer, tam: number;
  try {
    tam = fstatSync(fd).size;
    if (tam < MARCA.length + IV + ETIQUETA) throw new Error("El archivo de respaldo está dañado");
    cab = Buffer.alloc(MARCA.length + IV); readSync(fd, cab, 0, cab.length, 0);
    etiqueta = Buffer.alloc(ETIQUETA); readSync(fd, etiqueta, 0, ETIQUETA, tam - ETIQUETA);
  } finally { closeSync(fd); }
  if (!cab.subarray(0, MARCA.length).equals(MARCA)) throw new Error("El archivo no es un respaldo cifrado de FactPOS");
  const dec = createDecipheriv("aes-256-gcm", llave(claveHex), cab.subarray(MARCA.length));
  dec.setAuthTag(etiqueta);
  try {
    await pipeline(createReadStream(origen, { start: cab.length, end: tam - ETIQUETA - 1 }), dec, createWriteStream(destino));
  } catch {
    throw new Error("No se pudo descifrar: la clave de recuperación no es la de este respaldo o el archivo está dañado");
  }
}
