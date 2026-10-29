/**
 * Carga el padrón de la DGII desde la línea de comandos:
 *   npm run padron                      → lo descarga de la DGII
 *   npm run padron -- C:\ruta\DGII_RNC.zip  → desde un archivo descargado a mano
 * Lo usa también GitHub Actions para la base de Supabase.
 */
import "./entorno.js";
import { readFile } from "node:fs/promises";
import { migrar } from "./migrar.js";
import { pool } from "./db.js";
import { actualizarPadronDesdeDgii, cargarPadron, leerArchivoPadron } from "./padron.js";

await migrar(() => {});
const archivo = process.argv[2];
const inicio = Date.now();
const n = archivo
  ? await cargarPadron(leerArchivoPadron(new Uint8Array(await readFile(archivo))), `Archivo ${archivo}`)
  : await actualizarPadronDesdeDgii();
console.log(`Padrón DGII: ${n.toLocaleString("es-DO")} contribuyentes cargados en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
await pool.end();
