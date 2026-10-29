// Arma el instalador único para Windows: FactPOS-Instalador-<versión>.zip
// Al abrir "INSTALAR FactPOS.bat" se elige: Servidor, Caja, Servidor y caja, o Administración.
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
rmSync(join(dir, "instalador/setup"), { recursive: true, force: true }); // fuentes del setup.exe (no van en el paquete)
// Doble clic en la raíz del paquete: menú para elegir qué se instala
copiar("instalador/INSTALAR FactPOS.bat", "INSTALAR FactPOS.bat");
// Los instaladores traen la dirección del PORTAL de FactPOS (variable PORTAL_URL de GitHub):
// con el nombre corto de la empresa, el portal dice dónde está su nube y su administración.
const adminUrl = (process.env.PORTAL_URL || "https://factpos.vercel.app").trim().replace(/\/+$/, "");
for (const f of ["instalador/instalar-administracion.ps1", "instalador/instalar-todo-en-uno.ps1"]) {
  const ruta = join(dir, f);
  writeFileSync(ruta, readFileSync(ruta, "utf8").replaceAll("__PORTAL_URL__", adminUrl));
}
for (const p of ["packages/compartido", "apps/servidor", "apps/terminal", "apps/admin"]) {
  copiar(`${p}/package.json`);
  copiar(`${p}/dist`);
}
// Solo lo que se usa en producción
correr("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", dir);
// Fuera pruebas y ejemplos de las dependencias (pesan y traen nombres de archivo raros)
const podar = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (!statSync(p).isDirectory()) continue;
    if (["test", "tests", "__tests__", "example", "examples", ".github"].includes(n)) rmSync(p, { recursive: true, force: true });
    else podar(p);
  }
};
podar(join(dir, "node_modules"));

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
const zip = join(salida, `FactPOS-Instalador-${version}.zip`);
writeFileSync(zip, zipSync(archivos, { level: 6 }));
console.log(`\nListo: ${relative(raiz, zip)} (${(statSync(zip).size / 1e6).toFixed(1)} MB, ${Object.keys(archivos).length} archivos) · Portal: ${adminUrl}`);

// Instalador gráfico de Windows (FactPOS-Setup-<versión>.exe) si está NSIS (makensis)
let makensis = null;
try { execSync("makensis -VERSION", { stdio: "ignore" }); makensis = "makensis"; } catch { /* sin NSIS */ }
if (makensis) {
  const setup = join(salida, `FactPOS-Setup-${version}.exe`);
  execSync(`${makensis} -V2 -DVERSION=${version} -DPAQUETE="${dir}" -DSALIDA="${setup}" FactPOS.nsi`, { cwd: join(raiz, "instalador/setup"), stdio: "inherit", env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" } });
  console.log(`Listo: ${relative(raiz, setup)} (${(statSync(setup).size / 1e6).toFixed(1)} MB)`);
} else {
  console.log("(No se armó FactPOS-Setup.exe: instale NSIS → apt install nsis / choco install nsis)");
}
