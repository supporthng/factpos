import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";

/**
 * BORRADORES DE COMPRA: lo que se lleva escrito en «Registrar compra» se guarda en el servidor, de modo que se
 * pueda empezar en el celular (foto de la factura) y seguir en la PC. No toca inventario ni costos.
 */
const uuid = z.string().uuid();

export async function rutasComprasBorradores(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => {
    const u = uuid.safeParse(req.headers["x-usuario-id"]);
    return u.success ? u.data : null;
  };

  app.get("/central/compras/borradores", async (req) => {
    const r = await pool.query(
      `SELECT b.id, b.titulo, b.actualizado_en AS "actualizadoEn", COALESCE(u.nombre, '') AS usuario,
              COALESCE(jsonb_array_length(b.datos->'lineas'), 0) + COALESCE(jsonb_array_length(b.datos->'pend'), 0) AS lineas
         FROM compras_borradores b LEFT JOIN usuarios u ON u.id = b.usuario_id
        WHERE b.empresa_id = $1 ORDER BY b.actualizado_en DESC LIMIT 50`, [empresaDe(req)]);
    return r.rows;
  });

  app.get("/central/compras/borradores/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query("SELECT id, titulo, datos FROM compras_borradores WHERE id = $1 AND empresa_id = $2", [id, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Ese borrador ya no existe (se registró o lo eliminaron).", 404);
    return r.rows[0];
  });

  /** Crea o actualiza (el id lo genera la pantalla) */
  app.put("/central/compras/borradores/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ titulo: z.string().max(200).default(""), datos: z.record(z.unknown()) }).parse(req.body);
    const e = empresaDe(req);
    const r = await pool.query(
      `INSERT INTO compras_borradores (id, empresa_id, usuario_id, titulo, datos) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, datos = EXCLUDED.datos, actualizado_en = now()
         WHERE compras_borradores.empresa_id = EXCLUDED.empresa_id`,
      [id, e, usuarioDe(req), b.titulo, JSON.stringify(b.datos)]);
    return { ok: !!r.rowCount };
  });

  app.delete("/central/compras/borradores/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await pool.query("DELETE FROM compras_borradores WHERE id = $1 AND empresa_id = $2", [id, empresaDe(req)]);
    return { ok: true };
  });
}
