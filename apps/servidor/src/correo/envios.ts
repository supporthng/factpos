import { uuidv7 } from "@factpos/compartido";
import { pool } from "../db.js";
import { reporteTurno } from "../rutas/cierre.js";
import { correoListo, enviarCorreo } from "./transporte.js";
import { correoCierre, correoIncidente, correoResumen, type DatosResumen, type Marca } from "./plantillas.js";

/**
 * Envíos automáticos por correo (los procesa la central):
 *   CIERRE_CAJA     cada turno cerrado, apenas llega de la sucursal.
 *   RESUMEN_DIARIO  el día anterior de todas las sucursales, a la hora elegida (hora de RD).
 *   INCIDENTES      avisos al servicio técnico (además de Telegram / webhook).
 *
 * Cada correo se anota en correos_enviados (tipo + clave únicos): nunca sale
 * dos veces, y si falla se reintenta más tarde (5, 10, 20… minutos).
 *
 * Se ejecuta desde la vigilancia (cada 5 minutos en Vercel con GitHub Actions,
 * cada minuto en una central instalada en una PC) y justo después de que una
 * sucursal sube sus cierres.
 */
export type TipoEnvio = "CIERRE_CAJA" | "RESUMEN_DIARIO" | "INCIDENTES";

interface Envio {
  empresa_id: string; tipo: TipoEnvio; activo: boolean; destinatarios: string[]; sucursales: string[] | null;
  hora: number; solo_con_diferencia: boolean; activado_en: string | null;
}

const MAX_INTENTOS = 6;

export async function marcaDe(empresaId: string): Promise<Marca> {
  const r = await pool.query<{ empresa: string; color: string | null; logo: string | null }>(
    `SELECT COALESCE(e.nombre_comercial, e.razon_social) AS empresa, m.color_primario AS color, m.logo
       FROM empresas e LEFT JOIN configuracion_marca m ON m.empresa_id = e.id WHERE e.id = $1`,
    [empresaId],
  );
  const f = r.rows[0];
  return { empresa: f?.empresa ?? "FactPOS", color: f?.color ?? "#0f766e", logo: f?.logo ?? null };
}

/** Arma el correo de un envío a partir de su tipo y su clave (el id del turno, la fecha…). */
export async function construir(empresaId: string, tipo: TipoEnvio, clave: string, sucursales: string[] | null = null) {
  const marca = await marcaDe(empresaId);
  if (tipo === "CIERRE_CAJA") return correoCierre(marca, await reporteTurno(pool, clave));
  if (tipo === "RESUMEN_DIARIO") return correoResumen(marca, await datosResumen(empresaId, clave, sucursales));
  throw new Error(`Tipo de envío desconocido: ${tipo}`);
}

/** Datos del resumen de un día (fecha AAAA-MM-DD, hora de RD). */
export async function datosResumen(empresaId: string, fecha: string, sucursales: string[] | null): Promise<DatosResumen> {
  const p = [empresaId, fecha, sucursales];
  const filtro = "s.empresa_id = $1 AND ($3::uuid[] IS NULL OR s.id = ANY($3::uuid[]))";
  const [ventas, semana, cierres, anul, ecf, inc, bajo] = await Promise.all([
    pool.query(`SELECT v.* FROM rpt_ventas_sucursal v JOIN sucursales s ON s.id = v.sucursal_id WHERE ${filtro} AND v.fecha = $2::date ORDER BY v.venta_total DESC`, p),
    pool.query(`SELECT COALESCE(SUM(v.venta_total), 0) AS total FROM rpt_ventas_sucursal v JOIN sucursales s ON s.id = v.sucursal_id WHERE ${filtro} AND v.fecha = $2::date - 7`, p),
    pool.query(`SELECT c.sucursal, c.caja, c.cajero, c.diferencia FROM rpt_cierres_caja c JOIN sucursales s ON s.id = c.sucursal_id WHERE ${filtro} AND c.fecha = $2::date ORDER BY c.sucursal, c.cerrado_en`, p),
    pool.query(
      `SELECT COUNT(*)::int AS cantidad, COALESCE(SUM(v.total), 0) AS monto FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id
        WHERE ${filtro} AND v.tipo_documento = 'E34' AND (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date = $2::date`, p),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE d.estado = 'RECHAZADO')::int AS rechazados,
              COUNT(*) FILTER (WHERE d.estado IN ('PENDIENTE','CONTINGENCIA','EN_PROCESO','ENVIADO'))::int AS pendientes
         FROM ecf_documentos d JOIN sucursales s ON s.id = d.sucursal_id
        WHERE ${filtro} AND (d.estado <> 'RECHAZADO' OR (d.creado_en AT TIME ZONE 'America/Santo_Domingo')::date >= $2::date - 2)`, p),
    pool.query(
      `SELECT i.titulo, i.desde, i.hasta FROM incidentes i LEFT JOIN sucursales s ON s.id = i.sucursal_id
        WHERE i.empresa_id = $1 AND i.tipo <> 'PRUEBA' AND ($3::uuid[] IS NULL OR i.sucursal_id IS NULL OR i.sucursal_id = ANY($3::uuid[]))
          AND (i.desde AT TIME ZONE 'America/Santo_Domingo')::date = $2::date ORDER BY i.desde`, p),
    pool.query(`SELECT COUNT(*)::int AS n FROM rpt_bajo_minimo b JOIN sucursales s ON s.id = b.sucursal_id WHERE ${filtro.replaceAll("$3", "$2")}`,
      [empresaId, sucursales]),
  ]);
  return {
    fecha, sucursales: ventas.rows, semanaPasada: semana.rows[0].total, cierres: cierres.rows,
    anulaciones: anul.rows[0], ecf: ecf.rows[0], incidentes: inc.rows, bajoMinimo: bajo.rows[0].n,
  };
}

/** Envía (o reintenta) un correo de la bitácora. Devuelve true si salió. */
async function despachar(e: Envio, clave: string, reintento: boolean, log: (m: string) => void) {
  if (reintento) {
    const r = await pool.query(
      `UPDATE correos_enviados SET estado = 'ENVIANDO', intentos = intentos + 1
        WHERE empresa_id = $1 AND tipo = $2 AND clave = $3 AND estado <> 'ENVIADO' RETURNING id`,
      [e.empresa_id, e.tipo, clave],
    );
    if (!r.rowCount) return false;
  } else {
    // Se reserva antes de enviar: si dos procesos coinciden, solo uno lo envía
    const r = await pool.query(
      `INSERT INTO correos_enviados (id, empresa_id, tipo, clave, destinatarios, intentos)
       VALUES ($1,$2,$3,$4,$5,1) ON CONFLICT (empresa_id, tipo, clave) DO NOTHING RETURNING id`,
      [uuidv7(), e.empresa_id, e.tipo, clave, e.destinatarios],
    );
    if (!r.rowCount) return false;
  }
  let asunto: string | null = null;
  try {
    const c = await construir(e.empresa_id, e.tipo, clave, e.sucursales);
    asunto = c.asunto;
    await enviarCorreo(e.empresa_id, { para: e.destinatarios, ...c });
    await pool.query(
      `UPDATE correos_enviados SET estado = 'ENVIADO', enviado_en = now(), asunto = $4, destinatarios = $5, error = NULL
        WHERE empresa_id = $1 AND tipo = $2 AND clave = $3`,
      [e.empresa_id, e.tipo, clave, asunto, e.destinatarios],
    );
    return true;
  } catch (err) {
    const msg = (err as Error).message.slice(0, 500);
    await pool.query(
      `UPDATE correos_enviados SET estado = 'ERROR', error = $4, asunto = COALESCE($5, asunto),
              proximo_intento = now() + make_interval(mins => 5 * power(2, LEAST(intentos - 1, 5))::int)
        WHERE empresa_id = $1 AND tipo = $2 AND clave = $3`,
      [e.empresa_id, e.tipo, clave, msg, asunto],
    );
    log(`Correo ${e.tipo} no enviado: ${msg}`);
    return false;
  }
}

let corriendo: Promise<{ enviados: number }> | null = null;

/** Revisa todo lo que toca enviar. Si ya hay una vuelta corriendo, espera esa. */
export function procesarEnvios(log: (m: string) => void = () => {}) {
  if (!corriendo) corriendo = vuelta(log).finally(() => { corriendo = null; });
  return corriendo;
}

async function vuelta(log: (m: string) => void) {
  let enviados = 0;
  const envios = await pool.query<Envio>(
    "SELECT * FROM envios_correo WHERE activo AND cardinality(destinatarios) > 0 AND tipo <> 'INCIDENTES'",
  ).catch(() => null); // base sin la migración todavía
  for (const e of envios?.rows ?? []) {
    if (!(await correoListo(e.empresa_id))) continue;

    if (e.tipo === "CIERRE_CAJA") {
      const t = await pool.query<{ id: string }>(
        `SELECT t.id FROM turnos t JOIN sucursales s ON s.id = t.sucursal_id
          WHERE s.empresa_id = $1 AND t.estado = 'CERRADO'
            AND t.cerrado_en > GREATEST(COALESCE($2::timestamptz, now()), now() - interval '3 days') - interval '1 minute'
            AND ($3::uuid[] IS NULL OR t.sucursal_id = ANY($3::uuid[]))
            AND (NOT $4 OR abs(COALESCE(t.diferencia, 0)) >= 0.005)
            AND NOT EXISTS (SELECT 1 FROM correos_enviados c WHERE c.empresa_id = $1 AND c.tipo = 'CIERRE_CAJA' AND c.clave = t.id::text)
          ORDER BY t.cerrado_en LIMIT 25`,
        [e.empresa_id, e.activado_en, e.sucursales, e.solo_con_diferencia],
      );
      for (const x of t.rows) if (await despachar(e, x.id, false, log)) enviados++;
    }

    if (e.tipo === "RESUMEN_DIARIO") {
      const r = await pool.query<{ fecha: string; toca: boolean }>(
        `SELECT to_char((now() AT TIME ZONE 'America/Santo_Domingo')::date - 1, 'YYYY-MM-DD') AS fecha,
                extract(hour FROM now() AT TIME ZONE 'America/Santo_Domingo') >= $1 AS toca`,
        [e.hora],
      );
      if (r.rows[0].toca && await despachar(e, r.rows[0].fecha, false, log)) enviados++;
    }

    // Reintentos de lo que falló (o quedó a medias)
    const pend = await pool.query<{ clave: string }>(
      `SELECT clave FROM correos_enviados
        WHERE empresa_id = $1 AND tipo = $2 AND intentos < $3
          AND ((estado = 'ERROR' AND proximo_intento <= now()) OR (estado = 'ENVIANDO' AND creado_en < now() - interval '10 minutes'))
          AND creado_en > now() - interval '3 days'
        ORDER BY creado_en LIMIT 10`,
      [e.empresa_id, e.tipo, MAX_INTENTOS],
    );
    for (const x of pend.rows) if (await despachar(e, x.clave, true, log)) enviados++;
  }
  return { enviados };
}

/** Aviso de incidente por correo, si está configurado en el panel. null = no configurado. */
export async function avisoIncidentePorCorreo(empresaId: string | null, texto: string): Promise<boolean | null> {
  if (!empresaId) return null;
  const e = await pool.query<Envio>("SELECT * FROM envios_correo WHERE empresa_id = $1 AND tipo = 'INCIDENTES' AND activo", [empresaId]).catch(() => null);
  const envio = e?.rows[0];
  if (!envio?.destinatarios.length || !(await correoListo(empresaId))) return null;
  await enviarCorreo(empresaId, { para: envio.destinatarios, ...correoIncidente(await marcaDe(empresaId), texto) });
  return true;
}

/** ¿El panel tiene activado el correo para incidentes? (para mostrar los canales) */
export async function incidentesPorCorreo(empresaId?: string | null) {
  const r = await pool.query(
    `SELECT 1 FROM envios_correo e JOIN configuracion_correo c ON c.empresa_id = e.empresa_id
      WHERE e.tipo = 'INCIDENTES' AND e.activo AND cardinality(e.destinatarios) > 0 AND c.clave_cifrada IS NOT NULL
        AND ($1::uuid IS NULL OR e.empresa_id = $1) LIMIT 1`,
    [empresaId ?? null],
  ).catch(() => null);
  return !!r?.rowCount;
}
