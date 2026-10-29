import { hostname } from "node:os";
import { uuidv7 } from "@factpos/compartido";
import { pool } from "./db.js";
import { encolarFilas } from "./sync/outbox.js";

/**
 * Incidentes y avisos al servicio técnico.
 *
 * Canales (se usan los que estén configurados; pueden ser varios):
 *   SOPORTE_TELEGRAM_TOKEN + SOPORTE_TELEGRAM_CHAT   bot de Telegram (grupo de soporte)
 *   SOPORTE_WEBHOOK_URL                              POST JSON { text, incidente } — Slack, Teams,
 *                                                    Make/Zapier (para WhatsApp), etc.
 *   SOPORTE_CORREO + RESEND_API_KEY [+ CORREO_DESDE] correo por Resend
 *
 * Los avisos los manda la CENTRAL (tiene internet estable): así llega el aviso aunque
 * el servidor de la sucursal esté apagado.
 */
export type TipoIncidente = "CAJA_SIN_SERVIDOR" | "SERVIDOR_APAGADO" | "SUCURSAL_SIN_COMUNICACION" | "PRUEBA";

export interface Incidente {
  id: string; empresa_id: string | null; sucursal_id: string | null; caja_id: string | null; tipo: TipoIncidente;
  gravedad: string; titulo: string; detalle: Record<string, unknown> | null; desde: string; hasta: string | null;
}

type Q = { query: typeof pool.query };

/** Registra un incidente en esta base. En una sucursal, además lo sube a la central. */
export async function registrarIncidente(c: Q, i: Omit<Incidente, "id" | "gravedad"> & { gravedad?: string; id?: string }) {
  const id = i.id ?? uuidv7();
  await c.query(
    `INSERT INTO incidentes (id, empresa_id, sucursal_id, caja_id, tipo, gravedad, titulo, detalle, desde, hasta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET hasta = EXCLUDED.hasta, detalle = EXCLUDED.detalle, titulo = EXCLUDED.titulo, actualizado_en = now()`,
    [id, i.empresa_id, i.sucursal_id, i.caja_id, i.tipo, i.gravedad ?? "ALTA", i.titulo, i.detalle ? JSON.stringify(i.detalle) : null, i.desde, i.hasta],
  );
  await encolarFilas(c, "incidentes", [id]);
  return id;
}

// --------------------------------------------------------------- Avisos
export const canalesConfigurados = () => [
  process.env.SOPORTE_TELEGRAM_TOKEN && process.env.SOPORTE_TELEGRAM_CHAT ? "Telegram" : null,
  process.env.SOPORTE_WEBHOOK_URL ? "Webhook" : null,
  process.env.SOPORTE_CORREO && process.env.RESEND_API_KEY ? "Correo" : null,
].filter(Boolean) as string[];

const duracion = (desde: string, hasta: string | null) => {
  const min = Math.round(((hasta ? new Date(hasta) : new Date()).getTime() - new Date(desde).getTime()) / 60000);
  return min < 1 ? "menos de 1 min" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};
const hora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", hour12: false, dateStyle: "short", timeStyle: "short" });

/** Texto del aviso, corto y claro para leer en el teléfono. */
export function textoAviso(i: Incidente & { sucursal?: string | null; caja?: string | null; empresa?: string | null }, fin = false) {
  const lugar = [i.empresa, i.sucursal, i.caja].filter(Boolean).join(" · ");
  const d = i.detalle ?? {};
  const lineas = [
    `${fin ? "✅ RESUELTO" : i.gravedad === "ALTA" ? "🔴 ALERTA" : "🟡 AVISO"} FactPOS — ${fin ? i.titulo.replace("no se comunica con la nube", "volvió a comunicarse con la nube") : i.titulo}`,
    lugar && `📍 ${lugar}`,
    `🕒 Desde ${hora(i.desde)}${i.hasta ? ` hasta ${hora(i.hasta)} (${duracion(i.desde, i.hasta)})` : ` · lleva ${duracion(i.desde, null)}`}`,
    typeof d.ventas === "number" && `🧾 Ventas hechas sin servidor: ${d.ventas}${d.monto ? ` (RD$${Number(d.monto).toLocaleString("es-DO", { minimumFractionDigits: 2 })})` : ""}`,
    typeof d.pendientes === "number" && d.pendientes > 0 && `⏳ Ventas pendientes de subir a la nube: ${d.pendientes}`,
    typeof d.equipo === "string" && `💻 Equipo: ${d.equipo}`,
    !fin && i.tipo === "SUCURSAL_SIN_COMUNICACION" && "Revise: luz e internet de la tienda, que la PC del servidor esté encendida y el servicio «FactPOS Servidor» corriendo.",
    !fin && i.tipo === "CAJA_SIN_SERVIDOR" && "La caja siguió vendiendo y ya envió sus ventas. Revise por qué se cayó el servidor (registro: C:\\FactPOS\\logs\\servidor.log).",
    !fin && i.tipo === "SERVIDOR_APAGADO" && "El servidor de la tienda estuvo apagado o reiniciándose. Revise la luz, el UPS y Windows Update.",
  ];
  return lineas.filter(Boolean).join("\n");
}

async function enviar(texto: string, i: unknown) {
  const errores: string[] = [];
  const tareas: Promise<void>[] = [];
  const tg = process.env.SOPORTE_TELEGRAM_TOKEN, chat = process.env.SOPORTE_TELEGRAM_CHAT;
  if (tg && chat) {
    tareas.push(fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }), signal: AbortSignal.timeout(15000),
    }).then((r) => { if (!r.ok) errores.push(`Telegram ${r.status}`); }).catch((e) => { errores.push(`Telegram: ${e.message}`); }));
  }
  const wh = process.env.SOPORTE_WEBHOOK_URL;
  if (wh) {
    tareas.push(fetch(wh, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: texto, incidente: i }), signal: AbortSignal.timeout(15000),
    }).then((r) => { if (!r.ok) errores.push(`Webhook ${r.status}`); }).catch((e) => { errores.push(`Webhook: ${e.message}`); }));
  }
  const correo = process.env.SOPORTE_CORREO, resend = process.env.RESEND_API_KEY;
  if (correo && resend) {
    tareas.push(fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${resend}` },
      body: JSON.stringify({
        from: process.env.CORREO_DESDE ?? "FactPOS <onboarding@resend.dev>",
        to: correo.split(",").map((x) => x.trim()),
        subject: texto.split("\n")[0], text: texto,
      }), signal: AbortSignal.timeout(15000),
    }).then((r) => { if (!r.ok) errores.push(`Correo ${r.status}`); }).catch((e) => { errores.push(`Correo: ${e.message}`); }));
  }
  await Promise.all(tareas);
  return { enviados: tareas.length - errores.length, errores };
}

/**
 * Envía los avisos pendientes (inicio y fin de cada incidente). Se llama al recibir
 * incidentes de una sucursal y desde la vigilancia periódica. Si no hay canales
 * configurados, el incidente queda igual a la vista en la administración.
 */
export async function avisarPendientes(log: (m: string) => void = () => {}) {
  if (!canalesConfigurados().length) return 0;
  const r = await pool.query<Incidente & { sucursal: string | null; caja: string | null; empresa: string | null; aviso: "inicio" | "fin" }>(
    `SELECT i.*, s.nombre AS sucursal, ca.nombre AS caja, e.nombre_comercial AS empresa,
            CASE WHEN i.notificado_en IS NULL THEN 'inicio' ELSE 'fin' END AS aviso
       FROM incidentes i
       LEFT JOIN sucursales s ON s.id = i.sucursal_id LEFT JOIN cajas ca ON ca.id = i.caja_id
       LEFT JOIN empresas e ON e.id = i.empresa_id
      WHERE (i.notificado_en IS NULL AND i.creado_en > now() - interval '2 days')
         OR (i.notificado_en IS NOT NULL AND i.hasta IS NOT NULL AND i.notificado_fin IS NULL
             AND i.tipo = 'SUCURSAL_SIN_COMUNICACION')
      ORDER BY i.desde LIMIT 20`,
  );
  let n = 0;
  for (const i of r.rows) {
    // Un incidente que ya terminó cuando se avisa por primera vez va en un solo mensaje
    const fin = i.aviso === "fin";
    const res = await enviar(textoAviso(i, fin), i);
    if (res.enviados > 0) {
      await pool.query(
        fin ? "UPDATE incidentes SET notificado_fin = now() WHERE id = $1"
            : "UPDATE incidentes SET notificado_en = now(), notificado_fin = CASE WHEN hasta IS NOT NULL THEN now() END WHERE id = $1",
        [i.id],
      );
      n++;
    } else if (res.errores.length) log(`Avisos a soporte: no se pudo enviar (${res.errores.join("; ")})`);
  }
  return n;
}

export async function avisoDePrueba(empresaId: string, usuario: string) {
  const i = {
    id: uuidv7(), empresa_id: empresaId, sucursal_id: null, caja_id: null, tipo: "PRUEBA" as const, gravedad: "BAJA",
    titulo: `Aviso de prueba enviado por ${usuario}`, detalle: null, desde: new Date().toISOString(), hasta: new Date().toISOString(),
  };
  const r = await enviar(textoAviso(i), i);
  return { canales: canalesConfigurados(), ...r };
}

// --------------------------------------------------------------- Vigilancia (central)
/** Minutos sin noticias de un servidor de sucursal para dar la alarma. */
const MINUTOS_SIN_COMUNICACION = Number(process.env.ALERTA_MINUTOS ?? 5);

/**
 * Revisa qué servidores de sucursal dejaron de comunicarse y abre (o cierra) el
 * incidente. Solo vigila sucursales que alguna vez se conectaron.
 */
export async function vigilar(log: (m: string) => void = () => {}) {
  const abiertos = await pool.query<{ id: string; nombre: string }>(
    `INSERT INTO incidentes (id, empresa_id, sucursal_id, tipo, gravedad, titulo, detalle, desde)
     SELECT gen_random_uuid(), s.empresa_id, s.id, 'SUCURSAL_SIN_COMUNICACION', 'ALTA',
            'El servidor de ' || s.nombre || ' no se comunica con la nube',
            jsonb_build_object('pendientes', y.pendientes, 'equipo', y.equipo),
            GREATEST(y.ultima_subida, y.ultima_bajada)
       FROM sync_sucursales y JOIN sucursales s ON s.id = y.sucursal_id AND s.activo
      WHERE GREATEST(y.ultima_subida, y.ultima_bajada) < now() - make_interval(secs => $1::numeric * 60)
        AND NOT EXISTS (SELECT 1 FROM incidentes i WHERE i.sucursal_id = s.id AND i.tipo = 'SUCURSAL_SIN_COMUNICACION' AND i.hasta IS NULL)
     RETURNING id, titulo AS nombre`,
    [MINUTOS_SIN_COMUNICACION],
  );
  for (const a of abiertos.rows) log(`Incidente: ${a.nombre}`);
  await cerrarSinComunicacion();
  return { abiertos: abiertos.rowCount, avisos: await avisarPendientes(log) };
}

/** Cierra el incidente de comunicación de las sucursales que volvieron a hablar. */
export async function cerrarSinComunicacion(sucursalId?: string) {
  await pool.query(
    `UPDATE incidentes i SET hasta = GREATEST(y.ultima_subida, y.ultima_bajada), actualizado_en = now()
       FROM sync_sucursales y
      WHERE i.sucursal_id = y.sucursal_id AND i.tipo = 'SUCURSAL_SIN_COMUNICACION' AND i.hasta IS NULL
        AND GREATEST(y.ultima_subida, y.ultima_bajada) > i.desde
        AND GREATEST(y.ultima_subida, y.ultima_bajada) > now() - interval '2 minutes'
        AND ($1::uuid IS NULL OR i.sucursal_id = $1)`,
    [sucursalId ?? null],
  );
}

export function iniciarVigilancia(log: (m: string) => void) {
  const t = setInterval(() => { vigilar(log).catch((e) => log(`Vigilancia: ${e.message}`)); }, 60_000);
  t.unref();
  log(`Vigilancia de sucursales activa. Avisos a soporte por: ${canalesConfigurados().join(", ") || "ningún canal configurado (solo en la administración)"}`);
}

// --------------------------------------------------------------- Latido (sucursal)
/**
 * El servidor de la sucursal anota un latido cada minuto. Al arrancar, si el último
 * latido es de hace más de 3 minutos, el servidor estuvo apagado: se registra.
 */
export async function iniciarLatido(log: (m: string) => void) {
  try {
    const previo = (await pool.query<{ ultimo: string }>("SELECT ultimo FROM servidor_latido WHERE id = 1")).rows[0];
    if (previo && Date.now() - new Date(previo.ultimo).getTime() > 3 * 60_000) {
      const s = (await pool.query<{ id: string; empresa_id: string; nombre: string }>(
        "SELECT id, empresa_id, nombre FROM sucursales WHERE id = $1",
        [process.env.SUCURSAL_ID ?? null],
      )).rows[0];
      await registrarIncidente(pool, {
        empresa_id: s?.empresa_id ?? null, sucursal_id: s?.id ?? null, caja_id: null, tipo: "SERVIDOR_APAGADO", gravedad: "MEDIA",
        titulo: `El servidor${s ? ` de ${s.nombre}` : ""} estuvo apagado`,
        detalle: { equipo: hostname() }, desde: previo.ultimo, hasta: new Date().toISOString(),
      });
      log(`El servidor estuvo apagado desde ${previo.ultimo}: incidente registrado`);
    }
    const latir = () => pool.query(
      `INSERT INTO servidor_latido (id, ultimo, iniciado) VALUES (1, now(), now())
       ON CONFLICT (id) DO UPDATE SET ultimo = now()`,
    ).catch(() => {});
    await pool.query(`INSERT INTO servidor_latido (id, ultimo, iniciado) VALUES (1, now(), now())
                      ON CONFLICT (id) DO UPDATE SET ultimo = now(), iniciado = now()`);
    setInterval(latir, 60_000).unref();
  } catch (e) {
    log(`Latido: ${(e as Error).message}`);
  }
}
