/**
 * Prueba de restauración de respaldos (corre en CI y a mano):
 *   DATABASE_URL=postgres://... node scripts/prueba-restauracion.cjs
 * 1. Toma la base migrada de DATABASE_URL y le agrega filas de prueba.
 * 2. Hace un respaldo real con instalador/bd.cjs.
 * 3. Crea una base nueva, le aplica las migraciones y restaura ahí.
 * 4. Compara tabla por tabla (conteo y huella) y comprueba que un respaldo cortado o alterado NO se restaura.
 * Necesita un usuario de PostgreSQL que pueda crear bases (en CI lo es).
 */
const { Client } = require("pg");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const raiz = path.resolve(__dirname, "..");
const origen = process.env.DATABASE_URL;
if (!origen) { console.error("Falta DATABASE_URL"); process.exit(2); }
const nombreDestino = "factpos_prueba_restauracion";
const aUrl = (base) => { const u = new URL(origen); u.pathname = "/" + base; return u.toString(); };
const destino = aUrl(nombreDestino);
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "restauracion-"));
const env = { ...process.env, FACTPOS_CLAVE_RESPALDO: crypto.randomBytes(32).toString("hex") };
const bd = (...a) => execFileSync(process.execPath, [path.join(raiz, "instalador", "bd.cjs"), ...a], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
const fallos = [];
const verificar = (ok, texto) => { console.log(`${ok ? "OK   " : "FALLA"} ${texto}`); if (!ok) fallos.push(texto); };

async function huella(url) {
  const c = new Client({ connectionString: url }); await c.connect();
  try {
    const t = (await c.query(`SELECT c.relname AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
      WHERE s.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition AND c.relname <> 'schema_migraciones' ORDER BY 1`)).rows.map((r) => r.n);
    const r = {};
    for (const n of t) {
      const x = (await c.query(`SELECT count(*)::int AS filas, md5(COALESCE(string_agg(f, '|' ORDER BY f), '')) AS h FROM (SELECT to_jsonb(x)::text AS f FROM "${n}" x) q`)).rows[0];
      r[n] = `${x.filas}:${x.h}`;
    }
    return r;
  } finally { await c.end(); }
}

(async () => {
  const admin = new Client({ connectionString: aUrl("postgres") }); await admin.connect();
  const c = new Client({ connectionString: origen }); await c.connect();
  try {
    // Datos de prueba sin depender de otras tablas (tamano con valor grande, texto con comillas y acentos)
    await c.query("DELETE FROM respaldos WHERE archivo LIKE 'prueba-%'");
    await c.query(`INSERT INTO respaldos (id, archivo, tipo, tamano, filas) VALUES
      ($1, 'prueba-1.fpbak', 'MANUAL', 9007199254740993, 12), ($2, 'prueba-"ñ''.fpbak', 'AUTO', 0, NULL)`,
      [crypto.randomUUID(), crypto.randomUUID()]);

    const archivo = path.join(carpeta, "prueba.fpbak");
    console.log("> respaldando");
    bd("respaldar", origen, archivo);
    verificar(fs.existsSync(archivo) && fs.statSync(archivo).size > 0, "el respaldo se crea");
    verificar(!fs.readFileSync(archivo).includes("prueba-1.fpbak"), "el respaldo va cifrado (no se lee el texto)");

    console.log("> creando base nueva y migrando");
    await admin.query(`DROP DATABASE IF EXISTS ${nombreDestino}`);
    await admin.query(`CREATE DATABASE ${nombreDestino} TEMPLATE template0 ENCODING 'UTF8'`);
    execFileSync("npm", ["run", "migrar", "-w", "@factpos/servidor"], { cwd: raiz, env: { ...process.env, DATABASE_URL: destino }, stdio: "inherit", timeout: 180000 });

    console.log("> restaurando");
    bd("restaurar", destino, archivo);
    console.log("> comparando");
    const a = await huella(origen), b = await huella(destino);
    const tablas = Object.keys(a);
    const distintas = tablas.filter((t) => a[t] !== b[t]);
    verificar(tablas.length > 20, `se comparan ${tablas.length} tablas`);
    verificar(distintas.length === 0, `todas las tablas quedan idénticas${distintas.length ? " (difieren: " + distintas.join(", ") + ")" : ""}`);
    const d = new Client({ connectionString: destino }); await d.connect();
    const g = await d.query("SELECT tamano::text FROM respaldos WHERE archivo = 'prueba-1.fpbak'");
    verificar(g.rows[0]?.tamano === "9007199254740993", "un número más grande que los de JavaScript se restaura exacto");

    // Un respaldo cortado no se restaura y no toca los datos de la base destino
    const buf = fs.readFileSync(archivo);
    const cortado = path.join(carpeta, "cortado.fpbak"); fs.writeFileSync(cortado, buf.subarray(0, buf.length - 40));
    let rechazo = false; try { bd("restaurar", destino, cortado); } catch { rechazo = true; }
    verificar(rechazo, "un respaldo cortado se rechaza");
    const alterado = path.join(carpeta, "alterado.fpbak"); const x = Buffer.from(buf); x[Math.floor(x.length / 2)] ^= 1; fs.writeFileSync(alterado, x);
    rechazo = false; try { bd("restaurar", destino, alterado); } catch { rechazo = true; }
    verificar(rechazo, "un respaldo alterado se rechaza");
    const despues = await huella(destino);
    verificar(tablas.every((t) => despues[t] === a[t]), "tras los rechazos la base restaurada sigue intacta");
    await d.end();
  } finally {
    await c.query("DELETE FROM respaldos WHERE archivo LIKE 'prueba-%'").catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${nombreDestino}`).catch(() => {});
    await c.end().catch(() => {}); await admin.end().catch(() => {});
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
  if (fallos.length) { console.error(`\n${fallos.length} comprobación(es) fallaron`); process.exit(1); }
  console.log("\nRestauración verificada");
})().catch((e) => { console.error(e); process.exit(1); });
