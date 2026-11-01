import { execFile } from "node:child_process";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { registrarIncidente } from "../incidentes.js";
import { evaluarLicencia } from "../licencia/nucleo.js";
import { filaLicencia, llamarPortal } from "../licencia/cliente.js";
import { cifrarArchivo, descifrarArchivo, formatearClave, nuevaClave } from "./cripto.js";

const exec = promisify(execFile);
const raiz = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const carpetaRespaldos = () => path.join(raiz(), "respaldos");
const bdCjs = () => path.join(raiz(), "instalador", "bd.cjs");
const sello = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

interface Config { activo: boolean; hora: string; carpeta_extra: string | null; dias_local: number; nube_activa: boolean; clave_nube: string | null; incidente_id: string | null }
interface Fila {
  id: string; archivo: string; tipo: "AUTO" | "MANUAL" | "SEGURIDAD"; tamano: string; filas: number | null; creado_en: string;
  extra_estado: string; extra_error: string | null; nube_estado: string; nube_objeto: string | null; nube_error: string | null; nube_intento: string | null; borrado: boolean;
}
const configuracion = async () => (await pool.query<Config>("SELECT activo, hora, carpeta_extra, dias_local, nube_activa, clave_nube, incidente_id FROM respaldo_config WHERE id = 1")).rows[0]!;

// ------------------------------------------------------------------ hacer un respaldo
export async function hacerRespaldo(tipo: Fila["tipo"]): Promise<Fila> {
  const url = process.env.DATABASE_URL;
  if (!url || !existsSync(bdCjs())) throw new ErrorNegocio("Esta instalación no puede hacer respaldos desde la administración (falta el instalador o la conexión a la base de datos)", 501);
  mkdirSync(carpetaRespaldos(), { recursive: true });
  const prefijo = tipo === "AUTO" ? "auto" : tipo === "MANUAL" ? "manual" : "antes-restaurar";
  const archivo = `factpos-${prefijo}-${sello()}.fpbak`;
  let salida = "";
  try {
    salida = (await exec(process.execPath, [bdCjs(), "respaldar", url, path.join(carpetaRespaldos(), archivo)], { timeout: 60 * 60_000 })).stdout;
  } catch (e) {
    throw new ErrorNegocio(`No se pudo hacer el respaldo: ${String((e as { stderr?: string }).stderr || (e as Error).message).slice(0, 300)}`, 500);
  }
  const filas = Number(/\((\d+) filas/.exec(salida)?.[1] ?? NaN);
  const c = await configuracion();
  const r = await pool.query<Fila>(
    `INSERT INTO respaldos (id, archivo, tipo, tamano, filas, extra_estado, nube_estado) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (archivo) DO UPDATE SET tamano = EXCLUDED.tamano RETURNING *`,
    [uuidv7(), archivo, tipo, statSync(path.join(carpetaRespaldos(), archivo)).size, Number.isFinite(filas) ? filas : null,
      c.carpeta_extra && tipo !== "SEGURIDAD" ? "PENDIENTE" : "NO", c.nube_activa && c.clave_nube && tipo !== "SEGURIDAD" ? "PENDIENTE" : "NO"]);
  return r.rows[0]!;
}

/** Respaldos que hizo la tarea de Windows (o a mano) y todavía no están en el historial */
async function registrarArchivosNuevos(c: Config) {
  if (!existsSync(carpetaRespaldos())) return;
  const conocidos = new Set((await pool.query<{ archivo: string }>("SELECT archivo FROM respaldos")).rows.map((r) => r.archivo));
  for (const n of readdirSync(carpetaRespaldos())) {
    const m = /^factpos-(auto|manual|antes)[a-z-]*-\d{8}-\d{4,6}\.fpbak$/.exec(n);
    if (!m || conocidos.has(n)) continue;
    const st = statSync(path.join(carpetaRespaldos(), n));
    const tipo = m[1] === "auto" ? "AUTO" : m[1] === "manual" ? "MANUAL" : "SEGURIDAD";
    await pool.query(
      `INSERT INTO respaldos (id, archivo, tipo, tamano, creado_en, extra_estado, nube_estado) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (archivo) DO NOTHING`,
      [uuidv7(), n, tipo, st.size, st.mtime, c.carpeta_extra && tipo !== "SEGURIDAD" ? "PENDIENTE" : "NO", c.nube_activa && c.clave_nube && tipo !== "SEGURIDAD" ? "PENDIENTE" : "NO"]);
  }
}

// ------------------------------------------------------------------ copia extra (USB / OneDrive / Google Drive)
export function probarCarpeta(dir: string) {
  if (!path.isAbsolute(dir)) throw new ErrorNegocio("Escriba la ruta completa de la carpeta (por ejemplo D:\\Respaldos)", 400);
  try {
    mkdirSync(dir, { recursive: true });
    const prueba = path.join(dir, ".factpos-prueba");
    writeFileSync(prueba, "ok"); rmSync(prueba);
  } catch (e) { throw new ErrorNegocio(`No se puede guardar en esa carpeta: ${(e as Error).message}`, 400); }
}
async function copiarExtra(c: Config, f: Fila) {
  try {
    if (!c.carpeta_extra) throw new Error("No hay carpeta extra configurada");
    mkdirSync(c.carpeta_extra, { recursive: true });
    copyFileSync(path.join(carpetaRespaldos(), f.archivo), path.join(c.carpeta_extra, f.archivo));
    await pool.query("UPDATE respaldos SET extra_estado = 'COPIADO', extra_error = NULL WHERE id = $1", [f.id]);
    // La carpeta extra guarda lo mismo que la local: se borra lo viejo para no llenar la USB
    const limite = Date.now() - c.dias_local * 86400_000;
    for (const n of readdirSync(c.carpeta_extra)) {
      if (!/^factpos-(auto|manual)[a-z-]*-\d{8}-\d{4,6}\.fpbak$/.test(n)) continue;
      const p = path.join(c.carpeta_extra, n);
      if (statSync(p).mtimeMs < limite) rmSync(p, { force: true });
    }
  } catch (e) {
    await pool.query("UPDATE respaldos SET extra_estado = 'ERROR', extra_error = $2 WHERE id = $1", [f.id, (e as Error).message.slice(0, 300)]);
  }
}

// ------------------------------------------------------------------ nube de FactPOS (cifrada)
function subirArchivo(url: string, archivo: string, tamano: number) {
  return new Promise<void>((ok, mal) => {
    const u = new URL(url);
    const req = (u.protocol === "https:" ? https : http).request(u, { method: "PUT", headers: { "Content-Length": tamano } }, (res) => {
      res.resume();
      res.on("end", () => (res.statusCode && res.statusCode < 300 ? ok() : mal(new Error(`El almacenamiento respondió ${res.statusCode}`))));
    });
    req.on("error", mal);
    createReadStream(archivo).on("error", mal).pipe(req);
  });
}
async function credencialesPortal() {
  const f = await filaLicencia();
  const e = f.token ? evaluarLicencia(f.token, { instalacion: f.instalacion_id }) : null;
  if (!e?.datos || !f.secreto) throw new ErrorNegocio("La copia en la nube necesita la licencia activada", 409);
  return { licenciaId: e.datos.id, instalacionId: f.instalacion_id, secreto: f.secreto };
}
async function subirNube(c: Config, f: Fila) {
  const origen = path.join(carpetaRespaldos(), f.archivo);
  const tmp = origen + ".cif";
  await pool.query("UPDATE respaldos SET nube_intento = now() WHERE id = $1", [f.id]);
  try {
    if (!c.clave_nube) throw new Error("Falta la clave de cifrado");
    if (!existsSync(origen)) throw new Error("El archivo local ya no existe");
    const cred = await credencialesPortal();
    const cif = await cifrarArchivo(origen, tmp, c.clave_nube);
    const r = await llamarPortal<{ url: string; objeto: string }>("/licencias/respaldo/url", { ...cred, tamano: cif.tamano, nombre: f.archivo });
    await subirArchivo(r.url, tmp, cif.tamano);
    await llamarPortal("/licencias/respaldo/confirmar", { ...cred, objeto: r.objeto, tamano: cif.tamano });
    await pool.query("UPDATE respaldos SET nube_estado = 'SUBIDO', nube_objeto = $2, nube_error = NULL WHERE id = $1", [f.id, r.objeto]);
  } catch (e) {
    await pool.query("UPDATE respaldos SET nube_estado = 'ERROR', nube_error = $2 WHERE id = $1", [f.id, (e as Error).message.slice(0, 300)]);
  } finally { rmSync(tmp, { force: true }); }
}

// ------------------------------------------------------------------ ciclo automático
let ocupado = false;
const hoyA = (hora: string) => { const [h, m] = hora.split(":").map(Number); const d = new Date(); d.setHours(h!, m!, 0, 0); return d; };

export async function cicloRespaldos(log: (m: string) => void) {
  if (ocupado) return;
  ocupado = true;
  try {
    const c = await configuracion();
    await registrarArchivosNuevos(c);
    // 1) ¿toca hacer el respaldo? (si la tarea de Windows ya lo hizo, no se repite)
    if (c.activo) {
      const ultimo = (await pool.query<{ t: string | null }>("SELECT max(creado_en) AS t FROM respaldos WHERE tipo = 'AUTO'")).rows[0]!.t;
      const u = ultimo ? new Date(ultimo).getTime() : 0, ahora = Date.now(), programada = hoyA(c.hora).getTime();
      if ((ahora >= programada && u < programada - 6 * 3600_000) || ahora - u > 26 * 3600_000) {
        try { await hacerRespaldo("AUTO"); log("Respaldo automático hecho"); } catch (e) { log(`Respaldo automático: ${(e as Error).message}`); }
      }
    }
    // 2) copia extra y nube
    for (const f of (await pool.query<Fila>("SELECT * FROM respaldos WHERE extra_estado IN ('PENDIENTE','ERROR') AND NOT borrado ORDER BY creado_en LIMIT 5")).rows) await copiarExtra(c, f);
    if (c.nube_activa && c.clave_nube) {
      const f = (await pool.query<Fila>(
        `SELECT * FROM respaldos WHERE nube_estado IN ('PENDIENTE','ERROR') AND NOT borrado AND tipo <> 'SEGURIDAD'
            AND (nube_intento IS NULL OR nube_intento < now() - interval '30 minutes') ORDER BY creado_en LIMIT 1`)).rows[0];
      if (f) await subirNube(c, f);
    }
    // 3) se borran los respaldos locales viejos (los de seguridad duran 30 días)
    for (const f of (await pool.query<Fila>(
      `SELECT * FROM respaldos WHERE NOT borrado AND ((tipo = 'SEGURIDAD' AND creado_en < now() - interval '30 days') OR (tipo <> 'SEGURIDAD' AND creado_en < now() - make_interval(days => $1)))`, [c.dias_local])).rows) {
      rmSync(path.join(carpetaRespaldos(), f.archivo), { force: true });
      await pool.query("UPDATE respaldos SET borrado = TRUE WHERE id = $1", [f.id]);
    }
    // 4) aviso si pasan más de 24 horas sin respaldo
    if (c.activo) await vigilarAtraso(c);
  } catch (e) { log(`Respaldos: ${(e as Error).message}`); }
  finally { ocupado = false; }
}

async function vigilarAtraso(c: Config) {
  const ult = (await pool.query<{ t: string | null }>("SELECT max(creado_en) AS t FROM respaldos WHERE tipo IN ('AUTO','MANUAL')")).rows[0]!.t;
  const atrasado = !ult || Date.now() - new Date(ult).getTime() > 24 * 3600_000;
  const empresa = (await pool.query<{ id: string }>("SELECT id FROM empresas ORDER BY actualizado_en LIMIT 1").catch(() => ({ rows: [] }))).rows[0]?.id ?? null;
  if (atrasado && !c.incidente_id) {
    const id = uuidv7();
    await registrarIncidente(pool, { id, empresa_id: empresa, sucursal_id: process.env.SUCURSAL_ID || null, caja_id: null, tipo: "RESPALDO_ATRASADO", gravedad: "MEDIA",
      titulo: "Hace más de 24 horas que no se hace un respaldo", detalle: { ultimo: ult }, desde: new Date().toISOString(), hasta: null });
    await pool.query("UPDATE respaldo_config SET incidente_id = $1 WHERE id = 1", [id]);
  } else if (!atrasado && c.incidente_id) {
    await pool.query("UPDATE incidentes SET hasta = now(), actualizado_en = now() WHERE id = $1", [c.incidente_id]);
    await pool.query("UPDATE respaldo_config SET incidente_id = NULL WHERE id = 1");
  }
}

export function iniciarRespaldos(log: (m: string) => void) {
  setTimeout(() => { void cicloRespaldos(log); }, 60_000).unref();
  setInterval(() => { void cicloRespaldos(log); }, 5 * 60_000).unref();
}

// ------------------------------------------------------------------ OneDrive y carpetas candidatas
function carpetasOneDrive(): { nombre: string; ruta: string }[] {
  const r: { nombre: string; ruta: string }[] = [];
  try {
    for (const u of readdirSync("C:\\Users")) {
      if (["Default", "Default User", "Public", "All Users"].includes(u) || u.startsWith("desktop")) continue;
      for (const d of readdirSync(path.join("C:\\Users", u))) {
        if (!d.startsWith("OneDrive")) continue;
        const ruta = path.join("C:\\Users", u, d);
        try { if (statSync(ruta).isDirectory()) r.push({ nombre: `${d} (${u})`, ruta: path.join(ruta, "FactPOS-Respaldos") }); } catch { /* sin acceso */ }
      }
    }
  } catch { /* no es Windows */ }
  return r;
}

// ------------------------------------------------------------------ rutas
const vista = (f: Fila) => ({
  id: f.id, archivo: f.archivo, tipo: f.tipo, tamano: Number(f.tamano), filas: f.filas, creado: f.creado_en, borrado: f.borrado,
  extra: f.extra_estado, extraError: f.extra_error, nube: f.nube_estado, nubeError: f.nube_error,
});
async function estado() {
  const c = await configuracion();
  const lista = (await pool.query<Fila>("SELECT * FROM respaldos ORDER BY creado_en DESC LIMIT 60")).rows;
  const ultimo = (await pool.query<{ t: string | null }>("SELECT max(creado_en) AS t FROM respaldos WHERE tipo IN ('AUTO','MANUAL')")).rows[0]!.t;
  return {
    config: { activo: c.activo, hora: c.hora, carpetaExtra: c.carpeta_extra, diasLocal: c.dias_local, nubeActiva: c.nube_activa, nubeConClave: !!c.clave_nube },
    ultimo, atrasado: !ultimo || Date.now() - new Date(ultimo).getTime() > 24 * 3600_000,
    carpeta: carpetaRespaldos(), onedrive: carpetasOneDrive(), lista: lista.map(vista),
  };
}

export async function rutasRespaldos(app: FastifyInstance) {
  app.get("/central/respaldos", async () => estado());

  app.put("/central/respaldos/config", async (req) => {
    const b = z.object({
      activo: z.boolean(), hora: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/), carpetaExtra: z.string().trim().max(300).nullable(),
      diasLocal: z.number().int().min(1).max(365), nubeActiva: z.boolean(),
    }).parse(req.body);
    const antes = await configuracion();
    if (b.carpetaExtra) probarCarpeta(b.carpetaExtra);
    let clave = antes.clave_nube;
    let claveNueva: string | null = null;
    if (b.nubeActiva && !clave) {
      await credencialesPortal();   // exige licencia activada
      clave = nuevaClave(); claveNueva = formatearClave(clave);
    }
    await pool.query(
      `UPDATE respaldo_config SET activo = $1, hora = $2, carpeta_extra = $3, dias_local = $4, nube_activa = $5, clave_nube = $6, actualizado_en = now() WHERE id = 1`,
      [b.activo, b.hora, b.carpetaExtra || null, b.diasLocal, b.nubeActiva, clave]);
    // Al encender la copia extra o la nube, se mandan también los 3 respaldos más recientes
    if (b.carpetaExtra && b.carpetaExtra !== antes.carpeta_extra)
      await pool.query("UPDATE respaldos SET extra_estado = 'PENDIENTE' WHERE id IN (SELECT id FROM respaldos WHERE NOT borrado AND tipo <> 'SEGURIDAD' ORDER BY creado_en DESC LIMIT 3)");
    if (b.nubeActiva && !antes.nube_activa)
      await pool.query("UPDATE respaldos SET nube_estado = 'PENDIENTE' WHERE id IN (SELECT id FROM respaldos WHERE NOT borrado AND tipo <> 'SEGURIDAD' ORDER BY creado_en DESC LIMIT 3)");
    return { ...(await estado()), claveRecuperacion: claveNueva };
  });

  app.post("/central/respaldos/ahora", async () => {
    const f = await hacerRespaldo("MANUAL");
    void cicloRespaldos(() => undefined);
    return vista(f);
  });

  /** Lo que hay guardado en la nube de FactPOS para esta licencia */
  app.get("/central/respaldos/nube", async () => {
    const cred = await credencialesPortal();
    return llamarPortal<{ respaldos: { objeto: string; nombre: string; tamano: number; creado: string }[]; usadoMb: number; maxGb: number }>("/licencias/respaldo/lista", cred);
  });
}

/** Restaurar es destructivo: solo el administrador principal (ruta sin permiso específico = acceso total) */
export async function rutasRestaurarRespaldo(app: FastifyInstance) {
  app.get("/central/restaurar-respaldo/clave", async () => {
    const c = await configuracion();
    if (!c.clave_nube) throw new ErrorNegocio("La copia en la nube no está activada", 404);
    return { clave: formatearClave(c.clave_nube) };
  });

  app.post("/central/restaurar-respaldo", async (req) => {
    const b = z.object({ confirmar: z.literal("RESTAURAR"), id: z.string().uuid().optional(), objeto: z.string().max(300).optional(), clave: z.string().max(100).optional() })
      .refine((x) => !!x.id !== !!x.objeto, "Elija un respaldo").parse(req.body);
    if (process.platform !== "win32") throw new ErrorNegocio("Restaurar desde la pantalla solo funciona en el servidor Windows de FactPOS", 501);
    const script = path.join(raiz(), "instalador", "restaurar-respaldo.ps1");
    if (!existsSync(script)) throw new ErrorNegocio("Falta instalador\\restaurar-respaldo.ps1: actualice FactPOS", 501);
    let archivo: string;
    if (b.id) {
      const f = (await pool.query<Fila>("SELECT * FROM respaldos WHERE id = $1", [b.id])).rows[0];
      if (!f || f.borrado || !existsSync(path.join(carpetaRespaldos(), f.archivo))) throw new ErrorNegocio("Ese respaldo ya no está en este equipo. Use el de la nube.", 404);
      archivo = path.join(carpetaRespaldos(), f.archivo);
    } else {
      const c = await configuracion();
      const claveHex = b.clave ?? c.clave_nube;
      if (!claveHex) throw new ErrorNegocio("Escriba la clave de recuperación de la copia en la nube", 400);
      const cred = await credencialesPortal();
      const d = await llamarPortal<{ url: string }>("/licencias/respaldo/bajar", { ...cred, objeto: b.objeto });
      const tmp = path.join(carpetaRespaldos(), `restaurar-temp-${sello()}`);
      mkdirSync(carpetaRespaldos(), { recursive: true });
      const r = await fetch(d.url);
      if (!r.ok || !r.body) throw new ErrorNegocio(`No se pudo bajar el respaldo de la nube (${r.status})`, 502);
      await pipeline(Readable.fromWeb(r.body as never), createWriteStream(tmp + ".cif"));
      try { await descifrarArchivo(tmp + ".cif", tmp + ".fpbak", claveHex); }
      catch (e) { throw new ErrorNegocio((e as Error).message, 400); }
      finally { rmSync(tmp + ".cif", { force: true }); }
      archivo = tmp + ".fpbak";
    }
    // Copia de seguridad del estado actual, por si se arrepiente
    await hacerRespaldo("SEGURIDAD");
    // La restauración corre fuera del servidor (una tarea de Windows de una sola vez): el servidor se detiene y se vuelve a arrancar
    setTimeout(() => {
      const tr = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}" -Archivo "${archivo}" -Carpeta "${raiz()}"`;
      execFile("schtasks", ["/Create", "/TN", "FactPOS Restaurar", "/TR", tr, "/SC", "ONCE", "/ST", "00:00", "/RU", "SYSTEM", "/RL", "HIGHEST", "/F"],
        (e1) => { if (!e1) execFile("schtasks", ["/Run", "/TN", "FactPOS Restaurar"], () => undefined); });
    }, 1500).unref();
    return { mensaje: "Restaurando… el servidor se reinicia solo en unos minutos. Vuelva a entrar cuando termine." };
  });
}
