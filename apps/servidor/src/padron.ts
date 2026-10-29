import { unzipSync } from "fflate";
import { pool } from "./db.js";

/**
 * Padrón de contribuyentes de la DGII.
 *
 * Archivo oficial: DGII_RNC.zip → un TXT en latin1, una línea por
 * contribuyente, 11 columnas separadas por "|":
 *   0 RNC/cédula · 1 nombre o razón social · 2 nombre comercial · 3 actividad
 *   … 8 fecha · 9 estado · 10 régimen de pagos
 *
 * Se carga en una tabla temporal y se reemplaza en una sola transacción:
 * mientras se actualiza, las consultas siguen respondiendo con el padrón anterior.
 */
export const URL_PADRON_DGII = "https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip";
const LOTE = 5000;
const limpiar = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export interface Contribuyente { rnc: string; nombre: string; nombreComercial: string | null; actividad: string | null; estado: string | null; regimen: string | null }

/** Lee el TXT de la DGII (o el ZIP que lo contiene). */
export function leerArchivoPadron(datos: Uint8Array): Contribuyente[] {
  let txt = datos;
  // ZIP: empieza con "PK"
  if (datos[0] === 0x50 && datos[1] === 0x4b) {
    const archivos = unzipSync(datos);
    const nombre = Object.keys(archivos).find((n) => /\.txt$/i.test(n)) ?? Object.keys(archivos)[0];
    if (!nombre) throw new Error("El ZIP no trae el listado de RNC");
    txt = archivos[nombre];
  }
  const texto = new TextDecoder("latin1").decode(txt).replace(/^\uFEFF|^\u00EF\u00BB\u00BF/, "");
  const lista: Contribuyente[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const c = linea.split("|");
    if (c.length !== 11) continue;
    const rnc = c[0].replace(/\D/g, "");
    if (rnc.length !== 9 && rnc.length !== 11) continue;
    lista.push({
      rnc, nombre: limpiar(c[1]), nombreComercial: limpiar(c[2]) || null, actividad: limpiar(c[3]) || null,
      estado: limpiar(c[9]).toUpperCase() || null, regimen: limpiar(c[10]) || null,
    });
  }
  // Control de formato: si casi nada se pudo leer, el archivo cambió o no es el correcto
  if (lista.length < 100 && texto.length > 100_000) throw new Error("El archivo no tiene el formato del padrón de la DGII (11 columnas separadas por |)");
  if (!lista.length) throw new Error("El archivo no trae contribuyentes");
  return lista;
}

/** Reemplaza el padrón completo con estos contribuyentes. */
export async function cargarPadron(lista: Contribuyente[], fuente: string) {
  const c = await pool.connect();
  try {
    await c.query("UPDATE padron_rnc_info SET estado = 'CARGANDO', mensaje = NULL WHERE id = 1");
    await c.query("BEGIN");
    await c.query("CREATE TEMP TABLE padron_nuevo (LIKE padron_rnc) ON COMMIT DROP");
    for (let i = 0; i < lista.length; i += LOTE) {
      const l = lista.slice(i, i + LOTE);
      await c.query(
        `INSERT INTO padron_nuevo SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])`,
        [l.map((x) => x.rnc), l.map((x) => x.nombre), l.map((x) => x.nombreComercial), l.map((x) => x.actividad), l.map((x) => x.estado), l.map((x) => x.regimen)],
      );
    }
    await c.query("DELETE FROM padron_rnc");
    // DISTINCT ON por si el archivo trae un RNC repetido
    await c.query("INSERT INTO padron_rnc SELECT DISTINCT ON (rnc) * FROM padron_nuevo ORDER BY rnc");
    const n = (await c.query("SELECT COUNT(*)::int AS n FROM padron_rnc")).rows[0].n;
    await c.query("UPDATE padron_rnc_info SET actualizado_en = now(), registros = $1, fuente = $2, estado = 'LISTO', mensaje = NULL WHERE id = 1", [n, fuente]);
    await c.query("COMMIT");
    return n as number;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    await pool.query("UPDATE padron_rnc_info SET estado = 'ERROR', mensaje = $1 WHERE id = 1", [(e as Error).message.slice(0, 300)]);
    throw e;
  } finally {
    c.release();
  }
}

/** Descarga el padrón de la DGII y lo carga. Necesita internet. */
export async function actualizarPadronDesdeDgii(url = process.env.DGII_URL_PADRON ?? URL_PADRON_DGII) {
  await pool.query("UPDATE padron_rnc_info SET estado = 'CARGANDO', mensaje = 'Descargando de la DGII' WHERE id = 1");
  let datos: Uint8Array;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3 * 60_000), headers: { "user-agent": "FactPOS/1.0" } });
    if (!r.ok) throw new Error(`la DGII respondió ${r.status}`);
    datos = new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    // Sin internet o la DGII caída: queda el aviso y se sigue usando el padrón que había
    const m = `No se pudo descargar de la DGII (${(e as Error).cause ? ((e as Error).cause as Error).message ?? (e as Error).message : (e as Error).message}). Se sigue usando la copia anterior.`;
    await pool.query("UPDATE padron_rnc_info SET estado = 'ERROR', mensaje = $1 WHERE id = 1", [m.slice(0, 300)]);
    throw new Error(m);
  }
  return cargarPadron(leerArchivoPadron(datos), "Descarga de la DGII");
}

export async function infoPadron() {
  return (await pool.query(
    `SELECT actualizado_en AS "actualizadoEn", registros, fuente, estado, mensaje FROM padron_rnc_info WHERE id = 1`,
  )).rows[0];
}

export async function buscarEnPadron(numero: string) {
  const rnc = numero.replace(/\D/g, "");
  const r = await pool.query(
    `SELECT rnc, nombre, nombre_comercial AS "nombreComercial", actividad, estado, regimen FROM padron_rnc WHERE rnc = $1`,
    [rnc],
  );
  return r.rows[0] ?? null;
}

/**
 * Actualización automática en el servidor de la sucursal: al arrancar y una
 * vez al día revisa si el padrón tiene más de 7 días; si es así, lo descarga.
 * Sin internet no pasa nada: se sigue usando la copia que hay.
 */
export function iniciarActualizacionPadron(log: (m: string) => void) {
  // Una carga que quedó a medias (el servidor se apagó) no debe bloquear las siguientes
  pool.query("UPDATE padron_rnc_info SET estado = 'ERROR', mensaje = 'La última carga se interrumpió' WHERE id = 1 AND estado = 'CARGANDO'").catch(() => {});
  if (process.env.PADRON_AUTOMATICO === "no") return;
  const revisar = async () => {
    try {
      const i = await infoPadron();
      const viejo = !i?.actualizadoEn || Date.now() - new Date(i.actualizadoEn).getTime() > 7 * 864e5;
      if (!viejo || i?.estado === "CARGANDO") return;
      log("Padrón DGII: descargando la versión más reciente…");
      const n = await actualizarPadronDesdeDgii();
      log(`Padrón DGII: ${n.toLocaleString("es-DO")} contribuyentes cargados`);
    } catch (e) {
      log(`Padrón DGII: no se pudo actualizar (${(e as Error).message}); se sigue usando la copia actual`);
    }
  };
  setTimeout(revisar, 60_000).unref();
  setInterval(revisar, 24 * 3600_000).unref();
}
