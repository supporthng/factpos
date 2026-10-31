/**
 * Aplica en orden los archivos de db/migrations que aún no se han aplicado.
 * Cada migración corre en su propia transacción: o entra completa o no entra.
 * El mismo comando se usa en cada sucursal y contra la nube.
 */
import "./entorno.js";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db.js";

const carpeta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");

/** Clave del candado de PostgreSQL: dos procesos (dos instaladores, o el servidor y un instalador) no migran a la vez. */
const CANDADO_MIGRACIONES = 7240301;

export async function migrar(log = console.log) {
  // Candado de sesión: el segundo proceso espera a que el primero termine y luego ya ve todo aplicado.
  const candado = await pool.connect();
  try {
    await candado.query("SELECT pg_advisory_lock($1)", [CANDADO_MIGRACIONES]);
    await migrarConCandado(log);
  } finally {
    try { await candado.query("SELECT pg_advisory_unlock($1)", [CANDADO_MIGRACIONES]); } catch { /* la conexión se cierra y libera sola */ }
    candado.release();
  }
}

async function migrarConCandado(log: (m: string) => void) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migraciones (
    nombre TEXT PRIMARY KEY,
    aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const aplicadas = new Set(
    (await pool.query<{ nombre: string }>("SELECT nombre FROM schema_migraciones")).rows.map((r) => r.nombre),
  );
  const archivos = (await readdir(carpeta)).filter((f) => f.endsWith(".sql")).sort();

  let nuevas = 0;
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    const sql = await readFile(path.join(carpeta, archivo), "utf8");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(sql);
      await c.query("INSERT INTO schema_migraciones (nombre) VALUES ($1)", [archivo]);
      await c.query("COMMIT");
      log(`✔ ${archivo}`);
      nuevas++;
    } catch (e) {
      await c.query("ROLLBACK");
      throw new Error(`Falló la migración ${archivo}: ${(e as Error).message}`);
    } finally {
      c.release();
    }
  }
  log(nuevas ? `${nuevas} migración(es) aplicada(s).` : "La base de datos ya está al día.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrar()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
