import { pool } from "../db.js";
import { simulado, dgii, pse, SinConexion, type Transmisor } from "./transmisor.js";
import { encolarFilas } from "../sync/outbox.js";

/**
 * Cola de envío de e-CF. Corre dentro del servidor local:
 *  - Toma los documentos pendientes, los envía y guarda la respuesta.
 *  - Sin internet: los marca en CONTINGENCIA y reintenta con espera creciente
 *    (10 s, 20 s, 40 s… hasta 30 min). Nada se pierde ni se duplica.
 *  - Los e-CF "en proceso" se consultan hasta tener respuesta final.
 */
const LOTE = 25;

async function transmisorDe(empresaId: string): Promise<Transmisor> {
  const r = await pool.query("SELECT transmisor, ambiente, pse_url FROM configuracion_fiscal WHERE empresa_id = $1", [empresaId]);
  const cfg = r.rows[0] ?? { transmisor: "SIMULADO", ambiente: "SIMULADO" };
  if (cfg.transmisor === "DGII" && cfg.ambiente !== "SIMULADO") return dgii(cfg.ambiente);
  if (cfg.transmisor === "PSE" && cfg.pse_url) return pse(cfg.pse_url);
  return simulado;
}

export async function procesarCola(log: (m: string) => void = () => {}) {
  const c = await pool.connect();
  let procesados = 0;
  try {
    await c.query("BEGIN");
    const docs = await c.query(
      `SELECT d.id, d.encf, d.tipo_ecf, d.modo_envio, d.xml_envio, d.estado, d.track_id, d.intentos,
              s.empresa_id, e.rnc
         FROM ecf_documentos d
         JOIN sucursales s ON s.id = d.sucursal_id JOIN empresas e ON e.id = s.empresa_id
        WHERE d.estado IN ('PENDIENTE','CONTINGENCIA','EN_PROCESO','ENVIADO')
          AND d.proximo_intento <= now() AND d.xml_envio IS NOT NULL
        ORDER BY d.proximo_intento LIMIT ${LOTE}
        FOR UPDATE OF d SKIP LOCKED`,
    );
    const transmisores = new Map<string, Transmisor>();
    for (const d of docs.rows) {
      if (!transmisores.has(d.empresa_id)) transmisores.set(d.empresa_id, await transmisorDe(d.empresa_id));
      const t = transmisores.get(d.empresa_id)!;
      const doc = { encf: d.encf, tipo: d.tipo_ecf, modo: d.modo_envio, xml: d.xml_envio, rncEmisor: d.rnc };
      try {
        const r = d.track_id && ["EN_PROCESO", "ENVIADO"].includes(d.estado) ? await t.consultar(d.track_id, doc) : await t.enviar(doc);
        await c.query(
          `UPDATE ecf_documentos SET estado = $2, track_id = COALESCE($3, track_id), mensajes = $4,
                  enviado_en = COALESCE(enviado_en, now()), intentos = intentos + 1, actualizado_en = now(),
                  proximo_intento = now() + interval '15 seconds'
            WHERE id = $1`,
          [d.id, r.estado, r.trackId ?? null, JSON.stringify(r.mensajes ?? null)],
        );
        await encolarFilas(c, "ecf_estado", [d.id]);
        log(`e-CF ${d.encf}: ${r.estado}`);
      } catch (e) {
        const espera = Math.min(10 * 2 ** Math.min(d.intentos, 8), 1800);
        await c.query(
          `UPDATE ecf_documentos SET estado = CASE WHEN estado = 'PENDIENTE' THEN 'CONTINGENCIA' ELSE estado END,
                  intentos = intentos + 1, mensajes = $2, actualizado_en = now(),
                  proximo_intento = now() + make_interval(secs => $3)
            WHERE id = $1`,
          [d.id, JSON.stringify({ error: (e as Error).message, contingencia: e instanceof SinConexion }), espera],
        );
        await encolarFilas(c, "ecf_estado", [d.id]);
        log(`e-CF ${d.encf}: sin enviar (${(e as Error).message}); reintento en ${espera}s`);
      }
      procesados++;
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  return procesados;
}

export function iniciarCola(log: (m: string) => void) {
  if (process.env.ECF_COLA === "off") return;
  let ocupado = false;
  setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      await procesarCola(log);
    } catch (e) {
      log(`Cola e-CF: ${(e as Error).message}`);
    } finally {
      ocupado = false;
    }
  }, Number(process.env.ECF_COLA_MS ?? 5000)).unref();
}
