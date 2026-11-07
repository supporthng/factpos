// Arma el instalador único para Windows: FactPOS-Instalador-<versión>.zip
// Al abrir "INSTALAR FactPOS.bat" se elige: Servidor, Caja, Servidor y caja, o Administración.
//   npm run empaquetar
// Contiene el servidor ya compilado, la caja, la administración, las
// migraciones, las dependencias de producción (todas en JavaScript puro, así
// que sirven en Windows aunque se armen en Linux) y los instaladores.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
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
for (const f of ["package.json", "package-lock.json", ".env.example", "README.md"]) if (existsSync(join(raiz, f))) copiar(f); // .env.example puede faltar (GitHub web no sube archivos que empiezan con punto)
copiar("db/migrations");
// Copiar solo scripts de instalación; Electron se distribuye aparte como ejecutable.
// Nunca copiar instalador/escritorio/node_modules ni su carpeta out al paquete.
mkdirSync(join(dir, "instalador"), { recursive: true });
for (const nombre of readdirSync(join(raiz, "instalador"))) {
  if (["escritorio", "setup"].includes(nombre)) continue;
  cpSync(join(raiz, "instalador", nombre), join(dir, "instalador", nombre), { recursive: true });
}
// Código de la ventana de escritorio, para que el servidor se lo ofrezca a las cajas (se actualizan solas, sin reinstalar)
mkdirSync(join(dir, "instalador/escritorio-codigo"), { recursive: true });
for (const f of ["app.cjs", "preload.cjs", "actualizando.html"]) cpSync(join(raiz, "instalador/escritorio", f), join(dir, "instalador/escritorio-codigo", f));
// La aplicación Electron se compila antes de empaquetar, en una carpeta fuera de paquete/. Va DESCOMPRIMIDA (carpeta con su .exe):
// el .exe «portable» se descomprimía en %TEMP% (~200 MB, revisado por el antivirus) en cada apertura y la Caja tardaba ~1 minuto en aparecer.
const escritorioDir = join(raiz, "instalador/escritorio/out/win-unpacked");
const exeEscritorio = existsSync(escritorioDir) ? readdirSync(escritorioDir).find(n => /^FactPOS[ -]Escritorio\.exe$/i.test(n)) : undefined;
if (process.env.FACTPOS_REQUIERE_ESCRITORIO === "1" && !exeEscritorio) {
  throw new Error("Falta la aplicación Electron para el instalador. Compílela primero.");
}
if (exeEscritorio) {
  mkdirSync(join(dir, "escritorio"), { recursive: true });
  cpSync(escritorioDir, join(dir, "escritorio"), { recursive: true });
  if (exeEscritorio !== "FactPOS-Escritorio.exe") renameSync(join(dir, "escritorio", exeEscritorio), join(dir, "escritorio/FactPOS-Escritorio.exe"));
}

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
// Windows PowerShell 5.1 lee los .ps1 SIN BOM como ANSI: "│" pasa a "â”‚" y ese "”"
// cierra las cadenas (error "Falta el paréntesis de cierre"). Forzar UTF-8 CON BOM.
for (const nombre of readdirSync(join(dir, "instalador"))) {
  if (!nombre.toLowerCase().endsWith(".ps1")) continue;
  const ruta = join(dir, "instalador", nombre);
  const texto = readFileSync(ruta, "utf8").replace(/^﻿/, "");
  writeFileSync(ruta, "﻿" + texto, "utf8");
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

// PostgreSQL 16 para Windows DENTRO del instalador (así el cliente no descarga nada de EnterpriseDB).
// Los binarios salen del registro de npm (paquete @embedded-postgres/windows-x64: postgres, initdb, pg_ctl).
// psql y pg_dump no hacen falta: instalador/bd.cjs hace esas tareas con la librería pg de FactPOS.
const LICENCIA_POSTGRESQL = `PostgreSQL Database Management System
(also known as Postgres, formerly known as Postgres95)

Portions Copyright (c) 1996-2025, The PostgreSQL Global Development Group
Portions Copyright (c) 1994, The Regents of the University of California

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose, without fee, and without a written agreement
is hereby granted, provided that the above copyright notice and this
paragraph and the following two paragraphs appear in all copies.

IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING
LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS
DOCUMENTATION, EVEN IF THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS FOR A PARTICULAR PURPOSE.  THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE UNIVERSITY OF CALIFORNIA HAS NO OBLIGATIONS TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
`;
const VERSION_PG = process.env.FACTPOS_PG_VERSION || "16.15.0-beta.19";
{
  const tmp = join(salida, "pg-tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  console.log(`PostgreSQL ${VERSION_PG} para Windows…`);
  const tgz = execSync(`npm pack @embedded-postgres/windows-x64@${VERSION_PG} --silent`, { cwd: tmp, encoding: "utf8" }).trim().split("\n").pop();
  execSync(`tar -xzf "${tgz}"`, { cwd: tmp });
  const nativo = join(tmp, "package", "native");
  if (!existsSync(join(nativo, "bin", "postgres.exe")) || !existsSync(join(nativo, "bin", "initdb.exe")) || !existsSync(join(nativo, "bin", "pg_ctl.exe"))) {
    throw new Error("El paquete de PostgreSQL no trae postgres.exe, initdb.exe y pg_ctl.exe");
  }
  const destino = join(dir, "postgresql");
  cpSync(nativo, destino, { recursive: true });
  // Fuera lo que el servidor no usa (librerías de interfaz gráfica y de prueba)
  for (const n of readdirSync(join(destino, "bin"))) if (/^(wx.*\.dll|testplug\.dll)$/i.test(n)) rmSync(join(destino, "bin", n));
  rmSync(join(destino, "pg-symlinks.json"), { force: true });
  if (existsSync(join(tmp, "package", "LICENSE.md"))) cpSync(join(tmp, "package", "LICENSE.md"), join(destino, "LICENCIA-empaquetado.md"));
  writeFileSync(join(destino, "LICENCIA-PostgreSQL.txt"), LICENCIA_POSTGRESQL);
  rmSync(tmp, { recursive: true, force: true });
}

// Paquete de ACTUALIZACIÓN (FactPOS-Instalador-<versión>.zip): lo descarga el servidor desde
// Administración › Actualizaciones. Sin PostgreSQL ni el ejecutable de escritorio (no cambian
// con cada versión y harían el paquete enorme); instalador\actualizar.ps1 copia solo el código.
{
  const { zipSync } = await import("fflate");
  const archivos = {};
  const excluidos = new Set(["postgresql", "escritorio"]);
  const recorrer = (carpeta, prefijo) => {
    for (const nombre of readdirSync(carpeta)) {
      if (!prefijo && excluidos.has(nombre)) continue;
      const ruta = join(carpeta, nombre);
      const rel = prefijo ? `${prefijo}/${nombre}` : nombre;
      if (statSync(ruta).isDirectory()) recorrer(ruta, rel);
      else archivos[rel] = readFileSync(ruta);
    }
  };
  recorrer(dir, "");
  const zip = join(salida, `FactPOS-Instalador-${version}.zip`);
  writeFileSync(zip, zipSync(archivos, { level: 6 }));
  console.log(`Listo: ${relative(raiz, zip)} (${(statSync(zip).size / 1e6).toFixed(1)} MB, paquete de actualización)`);
}

// El instalador (EXE) es lo que se descarga para instalar; el ZIP de arriba, para actualizar. NSIS comprime el contenido directamente.
// Instalador gráfico de Windows (FactPOS-Setup-<versión>.exe) si está NSIS (makensis)
let makensis = null;
try { execSync("makensis -VERSION", { stdio: "ignore" }); makensis = "makensis"; } catch { /* sin NSIS */ }
if (makensis) {
  const setup = join(salida, `FactPOS-Setup-${version}.exe`);
  execSync(`${makensis} -V2 -DVERSION=${version} -DPAQUETE="${dir}" -DSALIDA="${setup}" FactPOS.nsi`, { cwd: join(raiz, "instalador/setup"), stdio: "inherit", env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" } });
  console.log(`Listo: ${relative(raiz, setup)} (${(statSync(setup).size / 1e6).toFixed(1)} MB)`);
  // Instalador solo de Caja (sin servidor ni base de datos: pesa mucho menos). Si fallara, no impide publicar el completo.
  try {
    const caja = join(salida, `FactPOS-Caja-Setup-${version}.exe`);
    execSync(`${makensis} -V2 -DVERSION=${version} -DPAQUETE="${dir}" -DSALIDA="${caja}" -DTIPO_FIJO=caja FactPOS.nsi`, { cwd: join(raiz, "instalador/setup"), stdio: "inherit", env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" } });
    console.log(`Listo: ${relative(raiz, caja)} (${(statSync(caja).size / 1e6).toFixed(1)} MB, solo Caja)`);
  } catch (e) {
    console.warn(`(No se armó el instalador de Caja: ${e instanceof Error ? e.message : e})`);
  }
} else {
  console.log("(No se armó FactPOS-Setup.exe: instale NSIS → apt install nsis / choco install nsis)");
}
