import { procesarEnvios } from "../correo/envios.js";
import { sucursalesDe } from "../sesion.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { pool, ErrorNegocio } from "../db.js";
import { avisoDePrueba, canales, vigilar } from "../incidentes.js";

/** Incidentes en la administración y la vigilancia periódica (cron). */
const uuid = z.string().uuid();

export async function rutasCentralIncidentes(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  app.get("/central/incidentes", async (req) => {
    const f = z.object({ abiertos: z.enum(["1"]).optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT i.id, i.tipo, i.gravedad, i.titulo, i.detalle, i.desde, i.hasta, i.resuelto_en AS "resueltoEn", i.nota,
              i.notificado_en AS "notificadoEn", s.nombre AS sucursal, ca.nombre AS caja, u.nombre AS "resueltoPor",
              EXTRACT(EPOCH FROM COALESCE(i.hasta, now()) - i.desde)::int AS segundos
         FROM incidentes i LEFT JOIN sucursales s ON s.id = i.sucursal_id LEFT JOIN cajas ca ON ca.id = i.caja_id
         LEFT JOIN usuarios u ON u.id = i.resuelto_por
        WHERE i.empresa_id = $1 AND i.tipo <> 'PRUEBA' AND ($2::boolean IS NOT TRUE OR i.resuelto_en IS NULL)
          AND ($3::uuid[] IS NULL OR i.sucursal_id IS NULL OR i.sucursal_id = ANY($3))
        ORDER BY (i.hasta IS NULL) DESC, i.desde DESC LIMIT 300`,
      [empresaDe(req), f.abiertos === "1", sucursalesDe(req)],
    );
    return { canales: await canales(empresaDe(req)), incidentes: r.rows };
  });

  /** Soporte anota qué pasó y lo da por revisado. */
  app.post("/central/incidentes/:id/resolver", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { nota } = z.object({ nota: z.string().trim().min(3, "Escriba qué pasó o qué se hizo").max(500) }).parse(req.body);
    const r = await pool.query(
      `UPDATE incidentes SET resuelto_en = now(), resuelto_por = $3, nota = $4, hasta = COALESCE(hasta, now()), actualizado_en = now()
        WHERE id = $1 AND empresa_id = $2 RETURNING id`,
      [id, empresaDe(req), req.headers["x-usuario-id"], nota],
    );
    if (!r.rowCount) throw new ErrorNegocio("Incidente no encontrado", 404);
    return { ok: true };
  });

  app.post("/central/incidentes/prueba", async (req) => {
    const r = await avisoDePrueba(empresaDe(req), (req as { sesion?: { n: string } }).sesion?.n ?? "la administración");
    if (!r.canales.length) throw new ErrorNegocio("No hay canales de aviso configurados (Telegram, webhook o correo): vea el README", 409);
    return r;
  });

  /**
   * Vigilancia para la nube (Vercel no tiene procesos de fondo): la llama el cron
   * de Vercel o la tarea programada de GitHub cada pocos minutos.
   * Protegida con CRON_SECRET (encabezado Authorization: Bearer <CRON_SECRET>).
   */
  app.get("/central/vigilancia", async (req, rep) => {
    const secreto = process.env.CRON_SECRET;
    const dado = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const h = (t: string) => createHash("sha256").update(t).digest();
    if (!secreto || !timingSafeEqual(h(dado), h(secreto))) return rep.code(401).send({ error: "No autorizado" });
    const v = await vigilar((m) => req.log.info(m));
    const correos = await procesarEnvios((m) => req.log.warn(m)).catch((e: Error) => ({ error: e.message }));
    return { ...v, correos };
  });
}
