// Mete la administración web compilada (apps/admin/dist) dentro del servidor
// compilado (apps/servidor/dist/admin-embebido.js). Así el PORTAL la sirve en
// "/" y en "/<cliente>/" también en Vercel, donde la función no ve otras carpetas.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const origen = join(raiz, "apps/admin/dist");
// --src (solo en Vercel, que compila desde src): se escribe también el .ts
const destino = join(raiz, "apps/servidor/dist/admin-embebido.js");
const destinoSrc = process.argv.includes("--src") ? join(raiz, "apps/servidor/src/admin-embebido.ts") : null;
const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".json": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8" };
if (!existsSync(join(origen, "index.html"))) { console.error("Falta apps/admin/dist: compile la administración primero"); process.exit(1); }
const archivos = {};
const recorrer = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) recorrer(p);
    else archivos[relative(origen, p).replaceAll("\\", "/")] = [tipos[extname(n)] ?? "application/octet-stream", readFileSync(p).toString("base64")];
  }
};
recorrer(origen);
const codigo = `// Generado por scripts/embeber-admin.mjs\nexport const ARCHIVOS_ADMIN = ${JSON.stringify(archivos)};\n`;
writeFileSync(destino, codigo);
if (destinoSrc) writeFileSync(destinoSrc, codigo.replace("export const ARCHIVOS_ADMIN =", "export const ARCHIVOS_ADMIN: Record<string, [string, string]> | null ="));
console.log(`Administración embebida: ${Object.keys(archivos).length} archivos, ${(statSync(destino).size / 1024).toFixed(0)} KB`);
