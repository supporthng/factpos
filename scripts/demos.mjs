#!/usr/bin/env node
/**
 * Pruebas: levanta VARIAS ediciones de FactPOS a la vez en la misma computadora, cada una con su puerto y su base de datos
 * (en el mismo PostgreSQL). Solo para probar y hacer demostraciones: un cliente instala una sola edición por negocio.
 *
 *   npm run build        (una vez, o después de cada cambio)
 *   npm run demos        (todas)   ·   npm run demos -- farmacia muebleria   (solo esas)   ·   --reiniciar (borra y recrea los datos)
 *
 * Requiere PostgreSQL con el usuario factpos (docker compose up -d db). Ctrl+C detiene todo.
 * Variables: DEMOS_PG (conexión de administración, por defecto postgres://factpos:factpos@localhost:5432/postgres).
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const servidor = path.join(raiz, "apps", "servidor");
const { Client } = createRequire(path.join(servidor, "package.json"))("pg");

const EDICIONES = [
  { slug: "abarrotes", puerto: 3001, tipo: "TIENDA", nombre: "FactPOS (abarrotes, supermercados y licorerías)" },
  { slug: "muebleria", puerto: 3002, tipo: "MUEBLERIA", nombre: "FactPOS Mueblería" },
  { slug: "farmacia", puerto: 3003, tipo: "FARMACIA", nombre: "FactPOS Farmacia" },
  { slug: "bar-restaurante", puerto: 3004, tipo: "RESTAURANTE", nombre: "FactPOS Bar y Restaurante, Comida Rápida" },
  { slug: "auto-detailing", puerto: 3005, tipo: "TIENDA", nombre: "FactPOS Auto Detailing", extras: ["LAVADO"] },
  { slug: "peluqueria", puerto: 3006, tipo: "TIENDA", nombre: "FactPOS Peluquería", extras: ["SALON"] },
  { slug: "barberia", puerto: 3007, tipo: "TIENDA", nombre: "FactPOS Barbería", extras: ["SALON"] },
];
const args = process.argv.slice(2);
const reiniciar = args.includes("--reiniciar");
const pedidas = args.filter((a) => !a.startsWith("--"));
const lista = pedidas.length ? EDICIONES.filter((e) => pedidas.includes(e.slug)) : EDICIONES;
if (!lista.length) { console.error(`Ediciones válidas: ${EDICIONES.map((e) => e.slug).join(", ")}`); process.exit(1); }

const admin = process.env.DEMOS_PG ?? "postgres://factpos:factpos@localhost:5432/postgres";
const urlDe = (slug) => { const u = new URL(admin); u.pathname = `/factpos_${slug.replace(/-/g, "_")}`; return u.toString(); };
const entorno = (e) => ({ ...process.env, DATABASE_URL: urlDe(e.slug), PUERTO: String(e.puerto), ANUNCIO_RED: "no", ASEGURAR_FIREWALL: "no", PERMITIR_CAMBIO_TIPO_NEGOCIO: "1" });

const a = new Client({ connectionString: admin });
try { await a.connect(); } catch (err) { console.error(`No pude conectar a PostgreSQL (${err.message}).\nInícielo con: docker compose up -d db`); process.exit(1); }
for (const e of lista) {
  const base = `factpos_${e.slug.replace(/-/g, "_")}`;
  if (reiniciar) { await a.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`); }
  if (!(await a.query("SELECT 1 FROM pg_database WHERE datname = $1", [base])).rowCount) await a.query(`CREATE DATABASE ${base}`);
  console.log(`[${e.slug}] preparando datos…`);
  const r = spawnSync("npm", ["run", "semilla", "-w", "@factpos/servidor"], { cwd: raiz, env: entorno(e), stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`[${e.slug}] no se pudo preparar la base`); process.exit(1); }
  const c = new Client({ connectionString: urlDe(e.slug) });
  await c.connect();
  await c.query("UPDATE empresas SET tipo_negocio = $1, nombre_comercial = $2, modulos_extra = $3", [e.tipo, e.nombre, e.extras ?? []]);
  await c.end();
}
await a.end();

const hijos = lista.map((e) => {
  const h = spawn(process.execPath, ["dist/index.js"], { cwd: servidor, env: entorno(e), stdio: ["ignore", "pipe", "pipe"] });
  const prefijo = (d) => String(d).split("\n").filter(Boolean).forEach((l) => console.log(`[${e.slug}] ${l.slice(0, 160)}`));
  h.stdout.on("data", prefijo); h.stderr.on("data", prefijo);
  h.on("exit", (cod) => console.log(`[${e.slug}] se detuvo (${cod})`));
  return h;
});
const salir = () => { hijos.forEach((h) => h.kill()); setTimeout(() => process.exit(0), 500); };
process.on("SIGINT", salir); process.on("SIGTERM", salir);

console.log("\nFactPOS · ediciones de prueba (PIN del administrador 1234, supervisor Carlos 4321, cajera María 1111; contraseña de la administración: admin / admin1234)\n");
for (const e of lista) console.log(`  ${e.nombre.padEnd(34)} Caja: http://localhost:${e.puerto}/terminal/   Administración: http://localhost:${e.puerto}/admin/`);
console.log("\nCtrl+C detiene todas.");
