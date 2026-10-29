// Arma el paquete de instalación para Windows: FactPOS-Servidor-<versión>.zip
//   npm run empaquetar
// Contiene el servidor ya compilado, la caja, la administración, las
// migraciones, las dependencias de producción (todas en JavaScript puro, así
// que sirven en Windows aunque se armen en Linux) y los instaladores.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const raiz = new URL("..", import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const salida = join(raiz, "paquete");
const dir = join(salida, "FactPOS");
const correr = (cmd, cwd = raiz) => execSync(cmd, { cwd, stdio: "inherit" });

if (!existsSync(join(raiz, "apps/servidor/dist/index.js")) || !existsSync(join(raiz, "apps/terminal/dist/index.html"))) {
  console.log("Compilando…");
  correr("npm run build");
}

rmSync(salida, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const copiar = (de, a = de) => cpSync(join(raiz, de), join(dir, a), { recursive: true });
for (const f of ["package.json", "package-lock.json", ".env.example", "README.md"]) copiar(f);
copiar("db/migrations");
copiar("instalador");
for (const p of ["packages/compartido", "apps/servidor", "apps/terminal", "apps/admin"]) {
  copiar(`${p}/package.json`);
  copiar(`${p}/dist`);
}
// Solo lo que se usa en producción
correr("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", dir);

// ZIP
const archivos = {};
const agregar = (ruta) => {
  for (const n of readdirSync(ruta)) {
    const p = join(ruta, n);
    if (statSync(p).isDirectory()) agregar(p);
    else archivos[`FactPOS/${relative(dir, p).replaceAll("\\", "/")}`] = readFileSync(p);
  }
};
agregar(dir);
const zip = join(salida, `FactPOS-Servidor-${version}.zip`);
writeFileSync(zip, zipSync(archivos, { level: 6 }));
console.log(`\nListo: ${relative(raiz, zip)} (${(statSync(zip).size / 1e6).toFixed(1)} MB, ${Object.keys(archivos).length} archivos)`);
