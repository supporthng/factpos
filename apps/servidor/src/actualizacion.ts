import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { unzipSync } from "fflate";
import { pool, ErrorNegocio } from "./db.js";
import { config } from "./config.js";
import { PORTAL_URL } from "./licencia/cliente.js";

/**
 * ACTUALIZACIONES de los servidores de los clientes («avisar y un clic»).
 *
 *  - El portal dice cuál es la última versión publicada (GitHub Releases v*).
 *  - El servidor MASTER la consulta cada 6 h y la administración muestra
 *    «Hay una versión nueva» con el botón Instalar.
 *  - Al instalar: se descarga (el portal solo la entrega a licencias válidas),
 *    se descomprime y una tarea de Windows corre instalador\actualizar.ps1, que
 *    detiene el servidor, copia lo nuevo, aplica las migraciones y lo arranca.
 *  - Las SUCURSALES siguen al master: cuando ven que el principal tiene una
 *    versión más nueva, se actualizan solas en un momento sin ventas.
 */
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export function versionActual(): string {
  try { return JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8")).version; } catch { return process.env.npm_package_version ?? "0.0.0"; }
}
/** -1, 0, 1 comparando "1.2.3" */
export function compararVersion(a: string, b: string) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; }
  return 0;
}

interface Disponible { version: string; notas: string | null; publicada: string | null }
let disponible: Disponible | null = null;
let revisado = 0;
let proceso: { estado: "DESCARGANDO" | "INSTALANDO" | "ERROR"; version: string; mensaje: string | null; desde: string } | null = null;

export async function revisarVersion(forzar = false): Promise<Disponible | null> {
  if (!forzar && Date.now() - revisado < 6 * 3600_000) return disponible;
  revisado = Date.now();
  try {
    const r = await fetch(`${PORTAL_URL()}/licencias/version`, { signal: AbortSignal.timeout(15_000) });
    if (r.ok) disponible = (await r.json()) as Disponible;
  } catch { /* sin internet: se revisa luego */ }
  return disponible;
}

async function tokenLicencia() {
  return (await pool.query<{ token: string | null }>("SELECT token FROM licencia WHERE id = 1").catch(() => ({ rows: [] as { token: string | null }[] }))).rows[0]?.token ?? null;
}

/** Descarga, descomprime y deja corriendo la actualización (Windows). */
export async function instalarVersion(version: string, log: (m: string) => void = () => {}) {
  if (process.platform !== "win32") throw new ErrorNegocio("La instalación automática es para servidores Windows", 409);
  if (proceso && proceso.estado !== "ERROR") throw new ErrorNegocio("Ya se está instalando una actualización", 409);
  const token = await tokenLicencia();
  if (!token) throw new ErrorNegocio("Active la licencia para recibir actualizaciones", 402);
  proceso = { estado: "DESCARGANDO", version, mensaje: null, desde: new Date().toISOString() };
  try {
    const r = await fetch(`${PORTAL_URL()}/licencias/descargar?version=${encodeURIComponent(version)}`, { headers: { "x-licencia": token }, signal: AbortSignal.timeout(20_000) });
    const d = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!r.ok || !d.url) throw new Error(d.error ?? `El portal respondió ${r.status}`);
    log(`Actualización ${version}: descargando…`);
    const z = await fetch(d.url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!z.ok) throw new Error(`No se pudo descargar (${z.status})`);
    const archivos = unzipSync(new Uint8Array(await z.arrayBuffer()));
    const destino = path.join(tmpdir(), `factpos-${version}-${Date.now()}`);
    for (const [nombre, datos] of Object.entries(archivos)) {
      if (nombre.endsWith("/")) continue;
      const p = path.join(destino, nombre);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, datos);
    }
    const origen = existsSync(path.join(destino, "FactPOS")) ? path.join(destino, "FactPOS") : destino;
    const script = path.join(origen, "instalador", "actualizar.ps1");
    if (!existsSync(script)) throw new Error("El paquete descargado no trae instalador\\actualizar.ps1");
    proceso = { ...proceso, estado: "INSTALANDO" };
    log(`Actualización ${version}: instalando (el servidor se reinicia en un momento)…`);
    // Tarea de Windows de una sola vez: sobrevive a que se detenga este servidor
    const ps = `$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "${script}" -Desde "${origen}" -Carpeta "${raiz}"';` +
      `$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest;` +
      `Register-ScheduledTask -TaskName 'FactPOS Actualizar' -Action $a -Principal $p -Force | Out-Null; Start-ScheduledTask -TaskName 'FactPOS Actualizar'`;
    spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return { ok: true, version };
  } catch (e) {
    proceso = { estado: "ERROR", version, mensaje: (e as Error).message, desde: new Date().toISOString() };
    throw new ErrorNegocio(`No se pudo actualizar: ${(e as Error).message}`, 502);
  }
}

/** Sucursal: si el principal ya tiene una versión más nueva, se actualiza en un momento sin ventas. */
let pendienteSeguir: string | null = null;
export function seguirAlPrincipal(versionPrincipal: string | undefined, log: (m: string) => void) {
  if (!versionPrincipal || compararVersion(versionPrincipal, versionActual()) <= 0 || pendienteSeguir === versionPrincipal) return;
  pendienteSeguir = versionPrincipal;
  log(`Actualización: el servidor principal ya tiene la versión ${versionPrincipal}; esta sucursal se actualiza en el próximo momento sin ventas`);
  const intentar = async () => {
    const r = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM ventas WHERE creado_en > now() - interval '5 minutes'").catch(() => ({ rows: [{ n: 1 }] }));
    if (r.rows[0].n > 0) { setTimeout(intentar, 60_000).unref(); return; }
    instalarVersion(versionPrincipal, log).catch((e) => { log(`Actualización: ${(e as Error).message}; se reintenta en 30 min`); pendienteSeguir = null; });
  };
  setTimeout(intentar, 30_000).unref();
}

export async function rutasActualizacion(app: FastifyInstance) {
  app.get("/central/actualizacion", async (req) => {
    const forzar = (req.query as { revisar?: string }).revisar === "1";
    const d = await revisarVersion(forzar);
    const actual = versionActual();
    return {
      actual, disponible: d?.version ?? null, notas: d?.notas ?? null, publicada: d?.publicada ?? null,
      hayNueva: !!d && compararVersion(d.version, actual) > 0, proceso, puedeInstalar: process.platform === "win32" && !process.env.VERCEL,
      modo: config.modo,
    };
  });
  app.post("/central/actualizacion/instalar", async (req) => {
    const d = await revisarVersion(true);
    if (!d || compararVersion(d.version, versionActual()) <= 0) throw new ErrorNegocio("Ya tiene la versión más reciente", 409);
    return instalarVersion(d.version, (m) => req.log.info(m));
  });
}
