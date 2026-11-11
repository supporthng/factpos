import { pool } from "../db.js";
import { correoListo, enviarCorreo } from "../correo/transporte.js";
import { correoVencimiento } from "../correo/plantillas.js";
import { marcaDe } from "../correo/envios.js";

const UMBRALES = [5, 15, 30];

/**
 * Avisa por correo a los clientes del portal cuya licencia vence en 30, 15 o 5 días (un aviso por umbral).
 * Sale desde la cuenta de correo configurada en este servidor (Correo y envíos). La llama la vigilancia periódica.
 */
export async function avisarVencimientos(log: (m: string) => void = () => {}) {
  const cuenta = (await pool.query<{ empresa_id: string }>("SELECT empresa_id FROM configuracion_correo WHERE clave_cifrada IS NOT NULL ORDER BY actualizado_en DESC LIMIT 1")).rows[0];
  if (!cuenta || !(await correoListo(cuenta.empresa_id))) return { enviados: 0, motivo: "sin cuenta de correo" };
  const marca = await marcaDe(cuenta.empresa_id);
  const l = await pool.query<{ id: string; nombre: string; correo: string; vence: string; dias: number }>(
    `SELECT l.id, c.nombre, c.correo, to_char(l.vence, 'YYYY-MM-DD') AS vence,
            (l.vence - (now() AT TIME ZONE 'America/Santo_Domingo')::date)::int AS dias
       FROM portal_licencias l JOIN portal_clientes c ON c.id = l.cliente_id
      WHERE c.activo AND l.estado = 'ACTIVA' AND c.correo IS NOT NULL AND c.correo <> ''
        AND l.vence BETWEEN (now() AT TIME ZONE 'America/Santo_Domingo')::date AND (now() AT TIME ZONE 'America/Santo_Domingo')::date + 30`);
  let enviados = 0;
  for (const f of l.rows) {
    const umbral = UMBRALES.find((u) => f.dias <= u);
    if (umbral === undefined) continue;
    const nuevo = await pool.query("INSERT INTO portal_avisos_vencimiento (licencia_id, vence, umbral) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1", [f.id, f.vence, umbral]);
    if (!nuevo.rowCount) continue;
    try {
      const c = correoVencimiento(marca, f.nombre, f.vence, f.dias);
      await enviarCorreo(cuenta.empresa_id, { para: [f.correo], asunto: c.asunto, html: c.html, texto: c.texto });
      enviados++;
    } catch (e) {
      // Si no salió, se borra la marca para reintentar en la próxima vigilancia
      await pool.query("DELETE FROM portal_avisos_vencimiento WHERE licencia_id = $1 AND vence = $2 AND umbral = $3", [f.id, f.vence, umbral]);
      log(`Aviso de vencimiento a ${f.nombre}: ${(e as Error).message}`);
    }
  }
  return { enviados };
}
