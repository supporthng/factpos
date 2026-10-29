/**
 * Carga el archivo .env de la raíz del proyecto (si existe) antes que nada.
 * Las variables ya definidas en el sistema tienen prioridad.
 * Debe ser la PRIMERA importación de cada punto de entrada.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const archivo = path.join(raiz, ".env");
if (existsSync(archivo) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(archivo);
}
