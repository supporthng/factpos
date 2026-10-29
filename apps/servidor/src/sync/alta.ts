import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { configSync, iniciarSincronizacion } from "./sucursal.js";

/**
 * Alta del servidor de una tienda con un código (lado de la tienda).
 *
 * Si el .env tiene CENTRAL_URL pero todavía no SUCURSAL_ID / CENTRAL_CLAVE:
 *   0. si el instalador dejó ALTA_CODIGO (código de instalación generado en la
 *      Administración para una sucursal), lo canjea y queda dado de alta solo;
 *   1. si no, se anuncia: aparece en Administración › Sucursales › «Servidores
 *      esperando alta» con un código (ej. K7PD-4QX9) que también muestra en el
 *      registro y en http://<este servidor>:3000/alta;
 *   2. pregunta cada 5 s si ya lo confirmaron;
 *   3. al aprobarse, guarda SUCURSAL_ID, CENTRAL_CLAVE y PIN_SECRETO en el .env
 *      y empieza a sincronizar (sin reiniciar).
 * Mientras tanto el servidor funciona normal; sin internet, sigue esperando.
 */
type Estado =
  | { estado: "SIN_NUBE" }
  | { estado: "ENLAZADO"; sucursalId: string; sucursal?: string | null; empresa?: string | null }
  | { estado: "ESPERANDO"; codigo: string; expiraEn: string; central: string }
  | { estado: "SIN_CONEXION"; central: string; error: string; codigo?: string };

let estado: Estado = { estado: "SIN_NUBE" };
let iniciada = false;
export const estadoAlta = () => estado;

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const versionApp = () => {
  try { return JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8")).version as string; } catch { return undefined; }
};
const archivoEnv = () => process.env.FACTPOS_ENV ?? path.join(raiz, ".env");

/** Cambia (o agrega) variables del .env sin tocar las demás líneas. */
export function guardarEnEnv(valores: Record<string, string>) {
  const archivo = archivoEnv();
  const lineas = existsSync(archivo) ? readFileSync(archivo, "utf8").replace(/^﻿/, "").split(/\r?\n/) : [];
  const pendientes = new Map(Object.entries(valores));
  const nuevas = lineas.map((l) => {
    const m = /^([A-Z0-9_]+)=/.exec(l);
    if (m && pendientes.has(m[1])) {
      const v = pendientes.get(m[1])!;
      pendientes.delete(m[1]);
      return `${m[1]}=${v}`;
    }
    return l;
  });
  while (nuevas.length && nuevas[nuevas.length - 1] === "") nuevas.pop();
  for (const [k, v] of pendientes) nuevas.push(`${k}=${v}`);
  writeFileSync(archivo, nuevas.join("\r\n") + "\r\n", "utf8");
  for (const [k, v] of Object.entries(valores)) process.env[k] = v;
}

async function llamar<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const r = await fetch(`${configSync().url}${ruta}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20_000),
  });
  const t = await r.text();
  let d: Record<string, unknown> = {};
  try { d = JSON.parse(t); } catch { /* texto */ }
  if (!r.ok) throw Object.assign(new Error(String(d.error ?? t).slice(0, 200)), { status: r.status });
  return d as T;
}

export function iniciarAlta(log: (m: string) => void) {
  const cfg = configSync();
  if (!cfg.url) { estado = { estado: "SIN_NUBE" }; return false; }
  if (cfg.sucursalId && cfg.clave) { estado = { estado: "ENLAZADO", sucursalId: cfg.sucursalId }; return false; }
  if (iniciada) return true;
  iniciada = true;

  type Entrega = { estado: string; sucursalId?: string; clave?: string; pinSecreto?: string; sucursal?: string; empresa?: string };
  const listo = (r: Entrega) => {
    if (r.estado !== "APROBADO" || !r.sucursalId || !r.clave || !r.pinSecreto) return false;
    guardarEnEnv({ SUCURSAL_ID: r.sucursalId, CENTRAL_CLAVE: r.clave, PIN_SECRETO: r.pinSecreto, ALTA_CODIGO: "" });
    estado = { estado: "ENLAZADO", sucursalId: r.sucursalId, sucursal: r.sucursal, empresa: r.empresa };
    log(`ALTA LISTA · Este servidor quedó como la sucursal «${r.sucursal}» de ${r.empresa}. Empieza a sincronizar.`);
    iniciarSincronizacion(log);
    return true;
  };

  let pedido: { codigo: string; sondeo: string; expiraEn: string } | null = null;
  let avisado = "";
  let codigoInstalacion = (process.env.ALTA_CODIGO ?? "").trim();
  const vuelta = async () => {
    let espera = 5_000;
    // Camino B: código de instalación generado en la Administración
    if (codigoInstalacion) {
      try {
        if (listo(await llamar<Entrega>("/central/alta/canjear", { codigo: codigoInstalacion, equipo: hostname(), version: versionApp() }))) return;
      } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status && err.status < 500 && err.status !== 429) {
          log(`ALTA · El código de instalación ${codigoInstalacion} no sirvió (${err.message}). Se pide el alta por solicitud.`);
          codigoInstalacion = "";
          guardarEnEnv({ ALTA_CODIGO: "" });
        } else {
          estado = { estado: "SIN_CONEXION", central: cfg.url, error: err.message };
          setTimeout(vuelta, 15_000).unref();
          return;
        }
      }
    }
    try {
      if (!pedido || new Date(pedido.expiraEn).getTime() < Date.now()) {
        pedido = await llamar("/central/alta/solicitar", { equipo: hostname(), version: versionApp(), rnc: process.env.ALTA_RNC || undefined });
      }
      const p = pedido!;
      estado = { estado: "ESPERANDO", codigo: p.codigo, expiraEn: p.expiraEn, central: cfg.url };
      if (avisado !== p.codigo) {
        avisado = p.codigo;
        log(`ALTA PENDIENTE · Este servidor (${hostname()}) espera que lo confirmen en Administración › Sucursales › «Servidores esperando alta». Su código: ${p.codigo} (también en http://localhost:${process.env.PUERTO ?? 3000}/alta)`);
      }
      if (listo(await llamar<Entrega>("/central/alta/estado", { codigo: p.codigo, sondeo: p.sondeo }))) return; // terminó
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 404 || err.status === 410) pedido = null; // venció o ya se usó: código nuevo
      estado = { estado: "SIN_CONEXION", central: cfg.url, error: err.message, codigo: pedido?.codigo };
      espera = err.status === 429 ? 60_000 : 15_000;
    }
    setTimeout(vuelta, espera).unref();
  };
  setTimeout(vuelta, 1_000).unref();
  return true;
}

const pagina = (e: Estado) => {
  const cuerpo = e.estado === "ESPERANDO" || (e.estado === "SIN_CONEXION" && e.codigo)
    ? `<p>Este servidor ya envió su solicitud de alta. Código:</p><div class="codigo">${"codigo" in e ? e.codigo : ""}</div>
       <ol><li>Entre a la <b>Administración</b> › <b>Sucursales y terminales</b>.</li>
       <li>En <b>Servidores esperando alta</b> aparece <b>${hostname()}</b> con este código.</li>
       <li>Elija la sucursal (o cree una nueva) y pulse <b>Confirmar</b>. Esta página cambia sola.</li></ol>
       ${e.estado === "SIN_CONEXION" ? `<p class="ojo">Sin conexión con la nube: ${e.error}. Se reintenta solo.</p>` : ""}`
    : e.estado === "ENLAZADO"
      ? `<div class="ok">Servidor dado de alta</div><p>${e.sucursal ? `Sucursal <b>${e.sucursal}</b>${e.empresa ? ` · ${e.empresa}` : ""}` : "Conectado a la Administración"}.</p><p>Las cajas ya pueden abrir <b>/terminal/</b>.</p>`
      : e.estado === "SIN_CONEXION"
        ? `<p class="ojo">No se pudo pedir el código a la nube (${e.error}). Revise el internet; se reintenta solo.</p>`
        : `<p>Este servidor trabaja solo (sin Administración en la nube).</p>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alta del servidor · FactPOS</title>${e.estado === "ENLAZADO" ? "" : '<meta http-equiv="refresh" content="5">'}
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f4f6f8;color:#1d2733;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border-radius:14px;padding:32px 36px;max-width:520px;box-shadow:0 2px 12px rgba(20,40,60,.08)}
h1{font-size:20px;margin:0 0 16px}.codigo{font:700 44px/1.1 ui-monospace,Consolas,monospace;letter-spacing:.08em;background:#eef4ff;color:#0b3d91;border-radius:10px;padding:16px;text-align:center;margin:8px 0 20px}
.ok{font-size:28px;font-weight:700;color:#147a3d;margin-bottom:8px}.ojo{color:#9a5b00}ol{padding-left:20px}</style></head>
<body><main><h1>FactPOS · Alta del servidor (${hostname()})</h1>${cuerpo}</main></body></html>`;
};

/** En el servidor de la tienda: http://<servidor>:3000/alta (página) y /alta.json (para el instalador). */
export async function rutasAltaLocal(app: FastifyInstance) {
  app.get("/alta.json", async () => estado);
  app.get("/alta", async (_req, rep) => rep.type("text/html; charset=utf-8").send(pagina(estado)));
}
