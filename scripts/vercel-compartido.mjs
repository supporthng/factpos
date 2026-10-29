// Vercel no incluye en la función los paquetes del monorepo que npm enlaza
// (node_modules/@factpos/compartido es un enlace simbólico) y la API se cae al
// arrancar con "Cannot find package '@factpos/compartido'". Aquí se copia el
// paquete ya compilado, como carpeta real, junto al servidor.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origen = path.join(raiz, "packages/compartido");
const destino = path.join(raiz, "apps/servidor/node_modules/@factpos/compartido");
rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
cpSync(path.join(origen, "package.json"), path.join(destino, "package.json"));
cpSync(path.join(origen, "dist"), path.join(destino, "dist"), { recursive: true });
console.log("@factpos/compartido copiado junto al servidor para Vercel");
