import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { config } from "./config.js";

/**
 * TÚNEL del servidor MASTER (Cloudflare).
 *
 * El master de cada negocio está en su oficina o tienda principal, detrás del
 * router. Este módulo arranca `cloudflared` para que la administración web y
 * las sucursales lleguen a él desde internet sin abrir puertos:
 *
 *  - TÚNEL FIJO (lo normal): el portal de FactPOS crea para la empresa un túnel
 *    con nombre y su dirección <empresa>.factpos.app, y le entrega al master un
 *    token (TUNEL_TOKEN). La dirección no cambia nunca.
 *  - TÚNEL RÁPIDO (respaldo): si el portal todavía no puede crear el fijo (sin
 *    licencia activada, o sin Cloudflare configurado), se abre uno temporal
 *    https://<algo>.trycloudflare.com, que cambia al reiniciar.
 *
 * En ambos casos la dirección se informa al portal: la web (portal/<empresa>/)
 * y las sucursales la buscan ahí por el nombre corto de la empresa.
 * Por el túnel solo pasa la administración (/central, /admin) y /salud; las
 * rutas de las cajas responden únicamente en la red local.
 */
export interface EstadoTunel {
  activo: boolean; tipo: "fijo" | "rapido" | null; url: string | null; desde: string | null; error: string | null; reportado: string | null;
}
let estado: EstadoTunel = { activo: false, tipo: null, url: null, desde: null, error: null, reportado: null };
export const estadoTunel = () => estado;
export const tunelActivo = () => config.modo === "central" && !process.env.VERCEL && (process.env.TUNEL ?? "") === "cloudflare";

/** Rutas que se pueden usar desde internet (por el túnel). */
export function permitidoPorTunel(ruta: string) {
  return ruta === "/salud" || ruta === "/actualizacion/estado" || ruta.startsWith("/central/") || ruta === "/admin" || ruta.startsWith("/admin/");
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
let cambiando = false; // al pasar de rápido a fijo no se reabre el rápido
let avisar: (url: string) => void = () => {};
let anotar: (m: string) => void = () => {};

function abrir() {
  const fijo = process.env.TUNEL_TOKEN && process.env.TUNEL_URL;
  const args = fijo
    ? ["tunnel", "--no-autoupdate", "run", "--token", process.env.TUNEL_TOKEN!]
    : ["tunnel", "--no-autoupdate", "--url", `http://localhost:${config.puerto}`];
  const p = spawn(binario(), args, { windowsHide: true });
  proceso = p;
  const listo = (url: string, tipo: "fijo" | "rapido") => {
    if (estado.url === url && estado.activo) return;
    estado = { ...estado, activo: true, tipo, url, desde: new Date().toISOString(), error: null };
    espera = 5_000;
    anotar(`Túnel ${tipo}: la administración y las sucursales entran por ${url}`);
    avisar(url);
  };
  const leer = (b: Buffer) => {
    const t = b.toString();
    if (fijo) {
      // cloudflared avisa cada conexión registrada con el borde de Cloudflare
      if (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(t)) listo(process.env.TUNEL_URL!, "fijo");
      if (/Unauthorized|invalid token|tunnel not found/i.test(t)) estado = { ...estado, error: "El túnel fijo fue rechazado por Cloudflare; se pide uno nuevo al portal." };
    } else {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(t);
      if (m) listo(m[0], "rapido");
    }
  };
  p.stdout?.on("data", leer);
  p.stderr?.on("data", leer);
  p.on("error", (e) => {
    estado = { ...estado, activo: false, error: `No se pudo abrir cloudflared (${(e as Error).message}). Reinstale el servidor master.` };
    anotar(`Túnel: ${estado.error}`);
  });
  p.on("exit", (codigo) => {
    proceso = null;
    if (cambiando) { cambiando = false; abrir(); return; }
    estado = { ...estado, activo: false, error: estado.error ?? `El túnel se cerró (código ${codigo}); se vuelve a abrir solo.` };
    setTimeout(abrir, espera).unref();
    espera = Math.min(espera * 2, 5 * 60_000);
  });
}

export function iniciarTunel(log: (m: string) => void, alCambiar: (url: string) => void) {
  if (!tunelActivo() || proceso) return;
  anotar = log;
  avisar = alCambiar;
  abrir();
  const cerrar = () => { try { proceso?.kill(); } catch { /* ya cerrado */ } };
  process.once("exit", cerrar);
  process.once("SIGINT", () => { cerrar(); process.exit(0); });
  process.once("SIGTERM", () => { cerrar(); process.exit(0); });
}

/** Pasa al túnel fijo (o cambia de token): cierra el actual y abre el nuevo. */
export function reiniciarTunel() {
  if (!proceso) { abrir(); return; }
  cambiando = true;
  try { proceso.kill(); } catch { cambiando = false; }
}

/** Credenciales de la licencia para hablar con el portal. */
async function credenciales() {
  const f = (await pool.query("SELECT instalacion_id, token, secreto FROM licencia WHERE id = 1")).rows[0];
  if (!f?.token || !f.secreto) return null; // todavía sin licencia activada
  const licenciaId = JSON.parse(Buffer.from(String(f.token).split(".")[0], "base64url").toString("utf8")).id as string;
  return { licenciaId, instalacionId: f.instalacion_id as string, secreto: f.secreto as string };
}

/**
 * Le pide al portal el túnel FIJO de la empresa (<empresa>.factpos.app). Si el
 * portal lo entrega, se guarda en el .env (TUNEL_TOKEN, TUNEL_URL) y se cambia.
 * Devuelve false si todavía no se puede (sigue el rápido).
 */
export async function pedirTunelFijo(portal: string, guardar: (v: Record<string, string>) => void, log?: (m: string) => void) {
  if (!tunelActivo() || process.env.TUNEL_TOKEN) return false;
  const c = await credenciales();
  if (!c) return false;
  try {
    const r = await fetch(`${portal}/licencias/tunel/fijo`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ ...c, puerto: config.puerto }),
    });
    const d = (await r.json().catch(() => ({}))) as { token?: string; url?: string; error?: string };
    if (!r.ok || !d.token || !d.url) throw new Error(d.error ?? `HTTP ${r.status}`);
    guardar({ TUNEL_TOKEN: d.token, TUNEL_URL: d.url });
    log?.(`Túnel: el portal asignó la dirección fija ${d.url}`);
    reiniciarTunel();
    return true;
  } catch (e) {
    log?.(`Túnel fijo todavía no disponible (${(e as Error).message}); se sigue con el túnel rápido`);
    return false;
  }
}

/** Le dice al portal la dirección actual del túnel (con las credenciales de la licencia). */
export async function reportarTunel(portal: string, log?: (m: string) => void) {
  if (!estado.url) return false;
  const c = await credenciales();
  if (!c) return false; // se reporta al activar la licencia
  try {
    const r = await fetch(`${portal}/licencias/tunel`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ ...c, url: estado.url }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
    estado = { ...estado, reportado: new Date().toISOString() };
    return true;
  } catch (e) {
    log?.(`Túnel: no se pudo avisar al portal (${(e as Error).message}); se reintenta`);
    return false;
  }
}
