#!/usr/bin/env node
/*
 * Herramientas de base de datos del instalador de FactPOS (reemplazan a psql y pg_dump,
 * que no vienen con el PostgreSQL incluido en el instalador).
 * Usa la librería "pg" de FactPOS: se ejecuta desde C:\FactPOS\instalador\bd.cjs.
 *
 *   node bd.cjs probar     <url>                         → código 0 si conecta
 *   node bd.cjs sql        <url> "<sentencia>"           → imprime la primera columna de la primera fila
 *   node bd.cjs preparar   <url-postgres> <clave-factpos> → crea/actualiza el usuario y la base factpos
 *   node bd.cjs respaldar  <url> <archivo.fpbak>          → copia de los datos (comprimida)
 *   node bd.cjs restaurar  <url-postgres> <archivo.fpbak> → carga la copia en una base con las mismas migraciones
 *   node bd.cjs limpiar    <carpeta> <dias>               → borra respaldos automáticos más viejos que N días
 *
 * Formato del respaldo: el esquema sale de las migraciones (db/migrations); el archivo guarda
 * qué migraciones tenía la base, los valores de las secuencias y todas las filas de cada tabla.
 */
"use strict";
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const readline = require("node:readline");

const FORMATO = "factpos-respaldo-1";
const LOTE = 2000;

async function conectar(url) {
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await c.connect();
  return c;
}
const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const literal = (s) => "'" + String(s).replace(/'/g, "''") + "'";

async function probar(url) {
  const c = await conectar(url);
  await c.query("SELECT 1");
  await c.end();
  console.log("ok");
}

async function sql(url, sentencia) {
  const c = await conectar(url);
  try {
    const r = await c.query(sentencia);
    const fila = r.rows?.[0];
    if (fila) console.log(String(Object.values(fila)[0] ?? ""));
  } finally { await c.end(); }
}

/** Usuario factpos con la clave dada y base factpos de su propiedad; comprueba que entra. */
async function preparar(urlAdmin, clave) {
  if (!/^[A-Za-z0-9]{8,}$/.test(clave)) throw new Error("La clave de factpos debe ser alfanumérica (8 o más caracteres)");
  const c = await conectar(urlAdmin);
  try {
    const rol = await c.query("SELECT 1 FROM pg_roles WHERE rolname = 'factpos'");
    await c.query(`${rol.rowCount ? "ALTER" : "CREATE"} ROLE factpos WITH LOGIN PASSWORD ${literal(clave)}`);
    const base = await c.query("SELECT 1 FROM pg_database WHERE datname = 'factpos'");
    if (!base.rowCount) await c.query("CREATE DATABASE factpos OWNER factpos ENCODING 'UTF8' TEMPLATE template0");
  } finally { await c.end(); }
  const u = new URL(urlAdmin);
  u.username = "factpos"; u.password = clave; u.pathname = "/factpos";
  await probar(u.toString());
}

async function tablas(c) {
  return (await c.query(
    `SELECT c.relname AS nombre FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname`)).rows.map((r) => r.nombre);
}

async function respaldar(url, archivo) {
  const c = await conectar(url);
  const temporal = archivo + ".parcial";
  const salida = zlib.createGzip({ level: 6 });
  const destino = fs.createWriteStream(temporal);
  salida.pipe(destino);
  const escribirTexto = (t) => new Promise((ok) => { if (salida.write(t + "\n")) ok(); else salida.once("drain", ok); });
  const escribir = (o) => escribirTexto(JSON.stringify(o));
  let filas = 0;
  try {
    // Una sola foto consistente de toda la base
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migraciones = (await c.query("SELECT nombre FROM schema_migraciones ORDER BY nombre")).rows.map((r) => r.nombre);
    const secuencias = (await c.query(
      `SELECT sequencename AS nombre, last_value::text AS valor FROM pg_sequences WHERE schemaname = 'public'`)).rows;
    const lista = (await tablas(c)).filter((t) => t !== "schema_migraciones");
    await escribir({ formato: FORMATO, creado: new Date().toISOString(), migraciones, secuencias, tablas: lista });
    for (const t of lista) {
      await escribir({ tabla: t });
      // El JSON sale como texto de PostgreSQL y se guarda tal cual: los decimales no pasan por JavaScript
      await c.query(`DECLARE cur NO SCROLL CURSOR FOR SELECT to_jsonb(x)::text AS f FROM ${ident(t)} x`);
      for (;;) {
        const r = await c.query(`FETCH ${LOTE} FROM cur`);
        if (!r.rowCount) break;
        await escribirTexto('{"filas":[' + r.rows.map((x) => x.f).join(",") + "]}");
        filas += r.rowCount;
      }
      await c.query("CLOSE cur");
    }
    await escribir({ fin: true, filas });
    await c.query("COMMIT");
  } catch (e) {
    salida.destroy(); destino.destroy();
    fs.rmSync(temporal, { force: true });
    throw e;
  } finally { await c.end().catch(() => {}); }
  await new Promise((ok, mal) => { destino.on("finish", ok); destino.on("error", mal); salida.end(); });
  fs.renameSync(temporal, archivo);
  console.log(`Respaldo listo: ${archivo} (${filas} filas, ${(fs.statSync(archivo).size / 1048576).toFixed(1)} MB)`);
}

async function restaurar(urlAdmin, archivo) {
  if (!fs.existsSync(archivo)) throw new Error(`No existe ${archivo}`);
  const c = await conectar(urlAdmin);
  let cab = null, tabla = null, filas = 0, terminado = false;
  try {
    await c.query("BEGIN");
    // El lector se crea justo antes de recorrerlo (si no, las líneas se pierden mientras se conecta)
    const lector = readline.createInterface({ input: fs.createReadStream(archivo).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const linea of lector) {
      if (!linea) continue;
      if (linea.startsWith('{"filas":[')) {   // filas: se pasan como texto, sin convertir los números
        if (!cab || !tabla) throw new Error("Respaldo dañado: filas fuera de una tabla");
        const texto = linea.slice(9, -1);
        const r = await c.query(`INSERT INTO ${ident(tabla)} SELECT * FROM jsonb_populate_recordset(NULL::${ident(tabla)}, $1::jsonb)`, [texto]);
        filas += r.rowCount;
        continue;
      }
      const o = JSON.parse(linea);
      if (!cab) {
        if (o.formato !== FORMATO) throw new Error("El archivo no es un respaldo de FactPOS");
        cab = o;
        const tiene = (await c.query("SELECT nombre FROM schema_migraciones ORDER BY nombre")).rows.map((r) => r.nombre);
        const faltan = cab.migraciones.filter((m) => !tiene.includes(m));
        if (faltan.length) throw new Error(`Primero aplique las migraciones (faltan ${faltan.length}, desde ${faltan[0]})`);
        // Sin triggers ni llaves foráneas mientras se carga (el kardex ya trae sus saldos calculados)
        await c.query("SET LOCAL session_replication_role = replica");
        await c.query(`TRUNCATE ${cab.tablas.map(ident).join(", ")} CASCADE`);
        continue;
      }
      if (o.tabla) { tabla = o.tabla; continue; }
      if (o.fin) {
        if (o.filas !== filas) throw new Error(`El respaldo está incompleto (${filas} de ${o.filas} filas)`);
        terminado = true;
      }
    }
    if (!terminado) throw new Error("El respaldo está cortado (no tiene el final)");
    for (const s of cab.secuencias) {
      if (s.valor !== null) await c.query(`SELECT setval(${literal(s.nombre)}, $1::bigint, true)`, [s.valor]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { await c.end().catch(() => {}); }
  console.log(`Restaurado: ${filas} filas de ${cab.tablas.length} tablas (respaldo del ${cab.creado})`);
}

function limpiar(carpeta, dias) {
  const limite = Date.now() - Number(dias) * 86400e3;
  let borrados = 0;
  for (const n of fs.existsSync(carpeta) ? fs.readdirSync(carpeta) : []) {
    if (!/^factpos-auto-.*\.(fpbak|dump)$/.test(n)) continue;   // solo los automáticos
    const f = path.join(carpeta, n);
    if (fs.statSync(f).mtimeMs < limite) { fs.rmSync(f); borrados++; }
  }
  console.log(`${borrados} respaldo(s) viejo(s) borrado(s)`);
}

const [orden, ...args] = process.argv.slice(2);
const acciones = { probar, sql, preparar, respaldar, restaurar, limpiar };
if (!acciones[orden]) {
  console.error("Uso: node bd.cjs probar|sql|preparar|respaldar|restaurar|limpiar ...");
  process.exit(2);
}
Promise.resolve(acciones[orden](...args)).catch((e) => { console.error("ERROR: " + (e && e.message ? e.message : e)); process.exit(1); });
