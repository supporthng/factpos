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

export async function migrar(log = console.log) {
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
