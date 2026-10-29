import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { config } from "./config.js";

/**
 * TÚNEL del servidor MASTER (Cloudflare, túnel rápido sin cuenta ni dominio).
 *
 * El master de cada negocio está en su oficina o tienda principal, detrás del
 * router. Este módulo arranca `cloudflared` y obtiene una dirección pública
 * https://<algo>.trycloudflare.com por la que entran la administración web y
 * las sucursales. Esa dirección cambia cada vez que se reinicia el túnel, así
 * que se le informa al portal de FactPOS: la web (portal/<empresa>/) y las
 * sucursales la buscan ahí por el nombre corto de la empresa.
 *
 * Por el túnel solo pasa la administración (/central, /admin) y /salud; las
 * rutas de las cajas responden únicamente en la red local.
 */
export interface EstadoTunel { activo: boolean; url: string | null; desde: string | null; error: string | null; reportado: string | null }
let estado: EstadoTunel = { activo: false, url: null, desde: null, error: null, reportado: null };
export const estadoTunel = () => estado;
export const tunelActivo = () => config.modo === "central" && !process.env.VERCEL && (process.env.TUNEL ?? "") === "cloudflare";

/** Rutas que se pueden usar desde internet (por el túnel). */
export function permitidoPorTunel(ruta: string) {
  return ruta === "/salud" || ruta.startsWith("/central/") || ruta === "/admin" || ruta.startsWith("/admin/");
}
/** ¿La petición llegó por el túnel (desde internet)? Cloudflare agrega esta cabecera. */
export const vieneDelTunel = (headers: Record<string, unknown>) => typeof headers["cf-connecting-ip"] === "string";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
function binario() {
  if (process.env.CLOUDFLARED_RUTA) return process.env.CLOUDFLARED_RUTA;
  for (const p of [path.join(raiz, "bin", "cloudflared.exe"), path.join(raiz, "bin", "cloudflared"),
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"]) {
    if (existsSync(p)) return p;
  }
  return "cloudflared"; // en el PATH
}

let proceso: ChildProcess | null = null;
let espera = 5_000;

export function iniciarTunel(log: (m: string) => void, alCambiar: (url: string) => void) {
  if (!tunelActivo() || proceso) return;
  const arrancar = () => {
    const bin = binario();
    const p = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${config.puerto}`], { windowsHide: true });
    proceso = p;
    const leer = (b: Buffer) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(b.toString());
      if (m && m[0] !== estado.url) {
        estado = { ...estado, activo: true, url: m[0], desde: new Date().toISOString(), error: null };
        espera = 5_000;
        log(`Túnel: la administración y las sucursales entran por ${m[0]}`);
        alCambiar(m[0]);
      }
    };
    p.stdout?.on("data", leer);
    p.stderr?.on("data", leer);
    p.on("error", (e) => {
      estado = { ...estado, activo: false, error: `No se pudo abrir cloudflared (${(e as Error).message}). Reinstale el servidor master.` };
      log(`Túnel: ${estado.error}`);
    });
    p.on("exit", (codigo) => {
      proceso = null;
      estado = { ...estado, activo: false, url: null, error: estado.error ?? `El túnel se cerró (código ${codigo}); se vuelve a abrir solo.` };
      setTimeout(arrancar, espera).unref();
      espera = Math.min(espera * 2, 5 * 60_000);
    });
  };
  arrancar();
  const cerrar = () => { try { proceso?.kill(); } catch { /* ya cerrado */ } };
  process.once("exit", cerrar);
  process.once("SIGINT", () => { cerrar(); process.exit(0); });
  process.once("SIGTERM", () => { cerrar(); process.exit(0); });
}

/** Le dice al portal la dirección actual del túnel (con las credenciales de la licencia). */
export async function reportarTunel(portal: string, log?: (m: string) => void) {
  if (!estado.url) return false;
  const f = (await pool.query("SELECT instalacion_id, token, secreto FROM licencia WHERE id = 1")).rows[0];
  if (!f?.token || !f.secreto) return false; // todavía sin licencia activada: se reporta al activarla
  const licenciaId = JSON.parse(Buffer.from(String(f.token).split(".")[0], "base64url").toString("utf8")).id;
  try {
    const r = await fetch(`${portal}/licencias/tunel`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ licenciaId, instalacionId: f.instalacion_id, secreto: f.secreto, url: estado.url }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
    estado = { ...estado, reportado: new Date().toISOString() };
    return true;
  } catch (e) {
    log?.(`Túnel: no se pudo avisar al portal (${(e as Error).message}); se reintenta`);
    return false;
  }
}
