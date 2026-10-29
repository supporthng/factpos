import { hostname } from "node:os";
import { seguirAlPrincipal } from "../actualizacion.js";
import { guardarLicenciaDeCentral } from "../licencia/cliente.js";
import { pool } from "../db.js";
import { TABLAS_BAJADA } from "../rutas/central-sync.js";
import { aplicarFilas, aplicarKardex, modoSincronizacion, type Modo } from "./aplicar.js";
import { guardarCertificado, huellaEnUso, type FilaCertificado } from "../fiscal/certificado-guardado.js";
import { quitarCertificado, usarCertificado } from "../fiscal/firma.js";

/**
 * Sincronización del servidor de una sucursal con la central en la nube.
 *
 * Cada SYNC_SEGUNDOS (15 por defecto):
 *   1. SUBE lo pendiente de sync_outbox (ventas, turnos, clientes nuevos,
 *      estado de los e-CF...) en lotes. Lo que la central confirma se marca
 *      como enviado; lo que falla se reintenta en la próxima vuelta.
 *   2. BAJA de la central todo lo que cambió (precios, productos, ofertas,
 *      clientes, usuarios, secuencias e-CF) y los movimientos de inventario
 *      que la central registró para esta sucursal (traspasos, compras,
 *      ajustes). Se aplica todo en una sola transacción.
 *
 * Sin internet, la sucursal sigue vendiendo: las ventas se acumulan en la
 * cola y suben solas cuando vuelve la conexión.
 *
 * Variables: CENTRAL_URL, SUCURSAL_ID, CENTRAL_CLAVE (la CLAVE_ACCESO de la nube).
 */
export const configSync = () => ({
  url: (process.env.CENTRAL_URL ?? "").replace(/\/+$/, ""),
  sucursalId: process.env.SUCURSAL_ID ?? "",
  clave: process.env.CENTRAL_CLAVE ?? "",
  segundos: Math.max(5, Number(process.env.SYNC_SEGUNDOS ?? 15)),
});
export const syncActiva = () => !!configSync().url;

/** Al volver a pedir, se repiten los cambios de los últimos 2 minutos: así no se pierde
 *  un cambio de la central que tomó su número de versión pero tardó en confirmarse. */
const VENTANA_MS = 120_000;
const LOTE = 200;
const MAX_BYTES = 3_000_000; // Vercel acepta hasta ~4.5 MB por petición

const modos: Record<string, Modo> = { clientes: "ultimo" };
const opciones: Record<string, Parameters<typeof aplicarFilas>[4]> = {
  // La sucursal es dueña del contador: nunca retrocede aunque la central tenga un número viejo
  ecf_rangos: { extraSet: { siguiente: "GREATEST(ecf_rangos.siguiente, EXCLUDED.siguiente)" } },
  categorias: { orden: "ORDER BY (r.padre_id IS NOT NULL)" },
};

/**
 * El MASTER del negocio está detrás de un túnel cuya dirección cambia. Si no
 * responde, se le pregunta al portal de FactPOS la dirección actual por el
 * nombre corto de la empresa (FACTPOS_EMPRESA) y se guarda en el .env.
 */
let ultimaResolucion = 0;
export async function resolverCentral(log?: (m: string) => void): Promise<boolean> {
  const empresa = (process.env.FACTPOS_EMPRESA ?? "").trim().toLowerCase();
  if (!empresa || Date.now() - ultimaResolucion < 60_000) return false;
  ultimaResolucion = Date.now();
  const portal = (process.env.FACTPOS_PORTAL_URL || "https://factpos.vercel.app").replace(/\/+$/, "");
  try {
    const r = await fetch(`${portal}/licencias/cliente/${encodeURIComponent(empresa)}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return false;
    const d = (await r.json()) as { apiUrl?: string | null };
    const nueva = (d.apiUrl ?? "").replace(/\/+$/, "");
    if (!nueva || nueva === configSync().url) return false;
    const { guardarEnEnv } = await import("./alta.js");
    guardarEnEnv({ CENTRAL_URL: nueva });
    log?.(`Sincronización: el servidor principal ahora está en ${nueva}`);
    return true;
  } catch { return false; }
}

async function pedir(ruta: string, init: RequestInit = {}, reintento = true): Promise<any> {
  try {
    return await pedirUnaVez(ruta, init);
  } catch (e) {
    // Sin respuesta del master (o el túnel ya no existe: Cloudflare responde 530/404): ¿cambió de dirección?
    const err = e as Error & { estado?: number };
    if (reintento && (!err.estado || [404, 502, 503, 530].includes(err.estado)) && (await resolverCentral(console.log))) return pedir(ruta, init, false);
    throw e;
  }
}

async function pedirUnaVez(ruta: string, init: RequestInit = {}) {
  const { url, clave } = configSync();
  const r = await fetch(`${url}${ruta}`, {
    ...init,
    // Clave propia de la sucursal (empieza con fps_) o, en instalaciones viejas, la general de la nube
    headers: {
      "content-type": "application/json",
      ...(clave ? { [clave.startsWith("fps_") ? "x-sucursal-clave" : "x-clave-acceso"]: clave } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await r.text();
  if (!r.ok) {
    let msg = texto;
    try { msg = JSON.parse(texto).error ?? texto; } catch { /* texto */ }
    throw Object.assign(new Error(`La central respondió ${r.status}: ${msg.slice(0, 200)}`), { estado: r.status });
  }
  return JSON.parse(texto);
}

// ---------------------------------------------------------------- SUBIDA
export async function subir(): Promise<{ enviados: number; errores: number }> {
  const { sucursalId } = configSync();
  let enviados = 0, errores = 0;
  for (let vuelta = 0; vuelta < 25; vuelta++) {
    const r = await pool.query(
      `SELECT id, tabla, registro_id, payload, length(payload::text) AS bytes
         FROM sync_outbox WHERE enviado_en IS NULL ORDER BY id LIMIT ${LOTE}`,
    );
    if (!r.rowCount) break;
    // Se corta el lote por tamaño (una venta grande pesa más)
    const lote: typeof r.rows = [];
    let bytes = 0;
    for (const f of r.rows) {
      if (lote.length && bytes + Number(f.bytes) > MAX_BYTES) break;
      lote.push(f);
      bytes += Number(f.bytes);
    }
    const pendientes = Number((await pool.query("SELECT COUNT(*) AS n FROM sync_outbox WHERE enviado_en IS NULL")).rows[0].n);
    const res = await pedir("/central/sync/subir", {
      method: "POST",
      body: JSON.stringify({
        sucursalId,
        equipo: hostname().slice(0, 80),
        pendientes,
        items: lote.map((f) => ({ id: String(f.id), tabla: f.tabla, registroId: f.registro_id, payload: f.payload })),
      }),
    });
    const ok: string[] = res.aplicados ?? [];
    if (ok.length) await pool.query("UPDATE sync_outbox SET enviado_en = now(), ultimo_error = NULL WHERE id = ANY($1::bigint[])", [ok]);
    for (const e of res.errores ?? []) {
      await pool.query("UPDATE sync_outbox SET intentos = LEAST(intentos + 1, 32000), ultimo_error = $2 WHERE id = $1", [e.id, e.error]);
    }
    enviados += ok.length;
    errores += res.errores?.length ?? 0;
    // Si todo el lote falló no tiene sentido seguir en esta vuelta
    if (!ok.length || r.rowCount < LOTE) break;
  }
  return { enviados, errores };
}

// ---------------------------------------------------------------- BAJADA
const historial: { t: number; v: number; k: number }[] = [];

async function leerCursor(tabla: string) {
  const r = await pool.query<{ ultima_version: string }>("SELECT ultima_version FROM sync_cursor WHERE tabla = $1", [tabla]);
  return Number(r.rows[0]?.ultima_version ?? 0);
}
async function guardarCursor(c: { query: typeof pool.query } | typeof pool, tabla: string, v: number) {
  await c.query(
    `INSERT INTO sync_cursor (tabla, ultima_version, actualizado_en) VALUES ($1, $2, now())
     ON CONFLICT (tabla) DO UPDATE SET ultima_version = $2, actualizado_en = now()`,
    [tabla, v],
  );
}

export interface Cambios {
  version: number;
  versionKardex?: number;
  completo: boolean;
  cambios: Record<string, unknown[]>;
  componentes?: Record<string, { componente_id: string; cantidad: string | number }[]>;
  /** Huella del certificado digital vigente en la central */
  certificado?: string | null;
  /** Licencia de la empresa (firmada por el proveedor) */
  licencia?: { token: string | null; instalacionId: string; pruebaDesde: string };
  /** Versión de FactPOS del servidor principal (las sucursales lo siguen) */
  versionPrincipal?: string;
}

/** Aplica en esta base un paquete de cambios de la central (todo o nada). */
export async function aplicarCambios(d: Cambios) {
  const c = await pool.connect();
  let filas = 0;
  try {
    await c.query("BEGIN");
    await c.query("SET CONSTRAINTS ALL DEFERRED");
    await modoSincronizacion(c);
    for (const [t] of TABLAS_BAJADA) {
      filas += await aplicarFilas(c, t, d.cambios[t], modos[t] ?? "reemplazar", opciones[t]);
    }
    filas += await aplicarKardex(c, d.cambios.kardex_movimientos);
    // Cuentas por cobrar de toda la empresa (un solo saldo por cliente en todas las tiendas)
    filas += await aplicarFilas(c, "cxc_movimientos", d.cambios.cxc_movimientos, "insertar", { orden: "ORDER BY r.creado_en, r.id" });

    // Combos: se reemplaza la lista de componentes solo si cambió
    for (const [comboId, lista] of Object.entries(d.componentes ?? {})) {
      const firma = (xs: { componente_id: string; cantidad: string | number }[]) =>
        xs.map((x) => `${x.componente_id}:${Number(x.cantidad)}`).sort().join("|");
      const actual = await c.query("SELECT componente_id, cantidad FROM producto_componentes WHERE combo_id = $1", [comboId]);
      if (firma(actual.rows) === firma(lista)) continue;
      await c.query("DELETE FROM producto_componentes WHERE combo_id = $1", [comboId]);
      filas += await aplicarFilas(c, "producto_componentes", lista, "insertar");
    }
    await c.query("COMMIT");
    return filas;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export async function bajar(): Promise<{ filas: number; version: number; certificadoCentral?: string | null }> {
  const { sucursalId } = configSync();
  let desde = await leerCursor("central_seguro");
  let desdeKardex = await leerCursor("kardex_seguro");
  let filas = 0, version = desde, versionKardex = desdeKardex;
  let certificadoCentral: string | null | undefined;
  for (let pagina = 0; pagina < 200; pagina++) {
    const d: Cambios = await pedir(`/central/sync/cambios?sucursalId=${sucursalId}&desde=${desde}&desdeKardex=${desdeKardex}`);
    filas += await aplicarCambios(d);
    certificadoCentral = d.certificado;
    if (d.licencia) await guardarLicenciaDeCentral(d.licencia).catch(() => {});
    if (!process.env.VERCEL) seguirAlPrincipal(d.versionPrincipal, console.log);
    version = Number(d.version);
    versionKardex = Number(d.versionKardex ?? desdeKardex);
    if (d.completo || (version <= desde && versionKardex <= desdeKardex)) break;
    desde = version;
    desdeKardex = versionKardex;
    // Descarga inicial grande: se avanza por páginas
    await guardarCursor(pool, "central_seguro", desde);
    await guardarCursor(pool, "kardex_seguro", desdeKardex);
  }
  await guardarCursor(pool, "central", version);
  await guardarCursor(pool, "kardex", versionKardex);
  // Ventana: el próximo pedido empieza en lo que se tenía hace 2 minutos
  const ahora = Date.now();
  historial.push({ t: ahora, v: version, k: versionKardex });
  let seguro: { v: number; k: number } | null = null;
  while (historial.length && historial[0].t <= ahora - VENTANA_MS) seguro = historial.shift()!;
  if (seguro) {
    await guardarCursor(pool, "central_seguro", seguro.v);
    await guardarCursor(pool, "kardex_seguro", seguro.k);
  }
  return { filas, version, certificadoCentral };
}

// ---------------------------------------------------------------- CICLO
// ----------------------------------------------------------- CERTIFICADO
/** Cada cuánto se pregunta por el certificado digital (y al arrancar). */
const CERT_CADA_MS = 10 * 60_000;
let certRevisado = 0;
let certError: string | null = null;
let certFallida: string | null = null; // huella que no se pudo cargar (no se reintenta en cada vuelta)

/**
 * Baja el certificado digital que se subió en la Administración, si es distinto
 * del que este servidor tiene en uso, y lo pone a firmar. Nunca detiene la
 * sincronización: si falla, se informa a la central y se reintenta luego.
 */
export async function revisarCertificado(forzar = false) {
  if (!forzar && Date.now() - certRevisado < CERT_CADA_MS) return null;
  certRevisado = Date.now();
  const { sucursalId } = configSync();
  const q = new URLSearchParams({ sucursalId });
  const h = huellaEnUso();
  if (h) q.set("huella", h);
  if (certError) q.set("error", certError.slice(0, 300));
  const r = (await pedir(`/central/sync/certificado?${q}`)) as { igual?: boolean; habilitado?: boolean; certificado?: FilaCertificado | null };
  if (r.igual) { certError = null; return "igual"; }
  if (!r.certificado) {
    certError = null;
    if (r.habilitado === false || !r.certificado) {
      // Desactivada (o ya no hay certificado): se deja de usar el que había bajado
      const habia = await pool.query("UPDATE certificados_digitales SET activo = FALSE WHERE activo RETURNING id");
      quitarCertificado();
      if (habia.rowCount) { certRevisado = 0; return "desactivado"; }
    }
    return r.habilitado === false ? "deshabilitado" : "sin_certificado";
  }
  if (process.env.CERT_P12_RUTA) { certError = "Este servidor usa el certificado del archivo .env (CERT_P12_RUTA), no el de la Administración"; return "archivo"; }
  try {
    const cert = await guardarCertificado(pool, r.certificado.empresa_id, r.certificado, null);
    usarCertificado(cert);
    certError = null;
    certRevisado = 0; // se informa enseguida a la central que ya lo tiene
    return "nuevo";
  } catch (e) {
    certError = (e as Error).message;
    certFallida = r.certificado.huella;
    certRevisado = 0;
    throw e;
  }
}

let enCurso: Promise<unknown> | null = null;
/** Una vuelta completa. Si ya hay una corriendo, espera a que termine y hace otra. */
export async function sincronizarAhora(): Promise<{ enviados: number; errores: number; filas: number; version: number; certificado?: string | null }> {
  while (enCurso) await enCurso.catch(() => {});
  const p = vueltaCompleta();
  enCurso = p;
  try {
    return await p;
  } finally {
    if (enCurso === p) enCurso = null;
  }
}

async function vueltaCompleta() {
  const marca = async (campos: string, valores: unknown[]) =>
    pool.query(
      `INSERT INTO sync_estado (id, central_url) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET central_url = $1, ${campos}`,
      [configSync().url, ...valores],
    );
  try {
    await marca("ultimo_intento = now()", []);
    const s = await subir();
    await marca("ultima_subida = now()", []);
    const b = await bajar();
    await marca("ultima_bajada = now(), ultimo_error = $2", [s.errores ? `${s.errores} elemento(s) no se pudieron subir; se reintentan` : null]);
    // Si la central tiene otro certificado, se pide ya (sin esperar los 10 minutos)
    const enUso = huellaEnUso();
    const usaElDeLaAdministracion = !process.env.CERT_P12_RUTA && enUso !== null;
    const otro = !process.env.CERT_P12_RUTA && (
      (!!b.certificadoCentral && b.certificadoCentral !== enUso && b.certificadoCentral !== certFallida) ||
      (b.certificadoCentral === null && usaElDeLaAdministracion) // lo desactivaron: dejar de usarlo ya
    );
    const cert = await revisarCertificado(otro).catch((e: Error) => `error: ${e.message}`);
    return { ...s, ...b, certificado: cert };
  } catch (e) {
    await marca("ultimo_error = $2", [(e as Error).message.slice(0, 500)]).catch(() => {});
    throw e;
  }
}

export function iniciarSincronizacion(log: (m: string) => void) {
  const cfg = configSync();
  if (!cfg.url) {
    log("Sincronización: sin CENTRAL_URL, esta sucursal trabaja sola (no sube ni baja datos)");
    return;
  }
  if (!/^[0-9a-f-]{36}$/i.test(cfg.sucursalId)) {
    log("Sincronización: falta SUCURSAL_ID (el id de esta sucursal en la central). No se sincroniza.");
    return;
  }
  log(`Sincronización con ${cfg.url} cada ${cfg.segundos} s`);
  let fallando = false;
  const vuelta = async () => {
    try {
      const r = await sincronizarAhora();
      if (fallando) log("Sincronización: conexión con la central restablecida");
      fallando = false;
      if (r.enviados || r.filas) log(`Sincronización: subidos ${r.enviados}, aplicados ${r.filas} cambios (versión ${r.version})`);
      if (r.certificado === "nuevo") log("e-CF: se cargó el certificado digital subido en la Administración");
      else if (r.certificado === "desactivado") log("e-CF: la Administración desactivó el certificado en esta sucursal; solo se factura en ambiente Simulado");
      else if (r.certificado?.startsWith("error")) log(`e-CF: certificado de la Administración no cargado (${r.certificado.slice(7)})`);
    } catch (e) {
      if (!fallando) log(`Sincronización: ${(e as Error).message}. Se sigue vendiendo; se reintenta solo.`);
      fallando = true;
    } finally {
      setTimeout(vuelta, cfg.segundos * 1000).unref();
    }
  };
  setTimeout(vuelta, 2000).unref();
}

/** Para la pantalla de estado (en la caja y en el servidor). */
export async function estadoSincronizacion() {
  const cfg = configSync();
  const r = await pool.query(
    `SELECT e.ultima_subida AS "ultimaSubida", e.ultima_bajada AS "ultimaBajada", e.ultimo_intento AS "ultimoIntento",
            e.ultimo_error AS "ultimoError",
            (SELECT COUNT(*) FROM sync_outbox WHERE enviado_en IS NULL)::int AS pendientes,
            (SELECT MIN(creado_en) FROM sync_outbox WHERE enviado_en IS NULL) AS "pendienteDesde",
            (SELECT COUNT(*) FROM sync_outbox WHERE enviado_en IS NULL AND ultimo_error IS NOT NULL)::int AS "conError",
            (SELECT ultima_version FROM sync_cursor WHERE tabla = 'central') AS version
       FROM (SELECT 1) x LEFT JOIN sync_estado e ON e.id = 1`,
  );
  return { activa: !!cfg.url, central: cfg.url || null, sucursalId: cfg.sucursalId || null, cadaSegundos: cfg.segundos, ...r.rows[0] };
}
