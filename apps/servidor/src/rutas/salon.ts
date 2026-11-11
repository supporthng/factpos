import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";

/**
 * Salón de restaurante: mapa de mesas y modificadores de los platos.
 * Solo para empresas que no son «TIENDA». Configurarlos pide un supervisor (igual que las estaciones de la barra).
 */
const uuid = z.string().uuid();

export async function rutasSalon(app: FastifyInstance) {
  const preparar = async (req: { params: unknown }) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const e = (await pool.query<{ t: string }>("SELECT tipo_negocio AS t FROM empresas WHERE id = $1", [ctx.empresaId])).rows[0];
    if (!e || e.t === "TIENDA") throw new ErrorNegocio("El salón no está activado para esta empresa", 409);
    return ctx;
  };
  const exigirSupervisor = (req: unknown, que: string) => {
    const p = ((req as { sesionCaja?: { p?: string[] } }).sesionCaja?.p) ?? [];
    if (!(p.includes("*") || p.includes("venta.anular"))) throw new ErrorNegocio(`${que} requiere un supervisor`, 403);
  };

  /** Mesas de la sucursal, cada una con su cuenta abierta (si la hay): mesero, desde cuándo y cuánto lleva. */
  app.get("/cajas/:cajaId/mesas", async (req) => {
    const ctx = await preparar(req);
    return (await pool.query(
      `SELECT m.id, m.nombre, m.zona, m.capacidad, m.pos_x::float8 AS "posX", m.pos_y::float8 AS "posY", m.forma,
              c.id AS "cuentaId", c.abierta_en AS "abiertaEn", u.nombre AS mesero,
              floor(EXTRACT(EPOCH FROM (now() - c.abierta_en)) / 60)::int AS minutos,
              c.productos, c.total, c.esperando
         FROM mesas m
         LEFT JOIN LATERAL (
           SELECT c.id, c.abierta_en, c.abierta_por,
                  (SELECT count(*)::int FROM cuenta_lineas l WHERE l.cuenta_id = c.id AND NOT l.anulada AND l.venta_id IS NULL) AS productos,
                  -- pedidos que todavía no salieron (esperan su tiempo o falta enviarlos)
                  (SELECT count(*)::int FROM cuenta_lineas l WHERE l.cuenta_id = c.id AND NOT l.anulada AND l.venta_id IS NULL AND l.enviada_en IS NULL) AS esperando,
                  (SELECT COALESCE(sum(l.cantidad * l.precio_unitario * CASE WHEN p.precio_incluye_impuesto THEN 1 ELSE 1 + l.tasa_itbis END), 0)::numeric(14,2)::text
                     FROM cuenta_lineas l JOIN presentaciones pr ON pr.id = l.presentacion_id JOIN productos p ON p.id = pr.producto_id
                    WHERE l.cuenta_id = c.id AND NOT l.anulada AND l.venta_id IS NULL) AS total
             FROM cuentas c WHERE c.sucursal_id = m.sucursal_id AND c.estado = 'ABIERTA' AND c.mesa = m.nombre ORDER BY c.abierta_en LIMIT 1
         ) c ON TRUE
         LEFT JOIN usuarios u ON u.id = c.abierta_por
        WHERE m.sucursal_id = $1 AND m.activa ORDER BY m.zona, m.orden, m.nombre`, [ctx.sucursalId])).rows;
  });

  /** Guarda las mesas (solo supervisor). Las que ya no están se desactivan: conservan su historial. */
  app.put("/cajas/:cajaId/mesas", async (req) => {
    const ctx = await preparar(req);
    exigirSupervisor(req, "Configurar las mesas");
    const b = z.object({
      mesas: z.array(z.object({ id: uuid.optional(), nombre: z.string().trim().min(1).max(30), zona: z.string().trim().max(30).default(""), capacidad: z.number().int().min(1).max(60).default(4),
        posX: z.number().min(0).max(100).nullable().default(null), posY: z.number().min(0).max(100).nullable().default(null), forma: z.enum(["CUADRADA", "REDONDA", "LARGA"]).default("CUADRADA"),
      })).max(300),
    }).parse(req.body);
    const nombres = b.mesas.map((m) => m.nombre.toLowerCase());
    if (new Set(nombres).size !== nombres.length) throw new ErrorNegocio("Hay dos mesas con el mismo nombre", 400);
    await enTransaccion(async (c) => {
      const ids: string[] = [];
      // Primero se apartan los nombres para poder intercambiarlos sin chocar con la restricción de nombre único
      await c.query("UPDATE mesas SET nombre = nombre || '~' || id::text WHERE sucursal_id = $1", [ctx.sucursalId]);
      for (const [i, m] of b.mesas.entries()) {
        const id = m.id ?? uuidv7();
        ids.push(id);
        await c.query(
          `INSERT INTO mesas (id, sucursal_id, nombre, zona, capacidad, orden, activa, pos_x, pos_y, forma) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET nombre = $3, zona = $4, capacidad = $5, orden = $6, activa = TRUE, pos_x = $7, pos_y = $8, forma = $9 WHERE mesas.sucursal_id = $2`,
          [id, ctx.sucursalId, m.nombre, m.zona, m.capacidad, i, m.posX, m.posY, m.forma]);
      }
      await c.query("UPDATE mesas SET activa = FALSE WHERE sucursal_id = $1 AND NOT (id = ANY($2::uuid[]))", [ctx.sucursalId, ids]);
    }).catch((e: { code?: string }) => {
      if (e.code === "23505") throw new ErrorNegocio("Hay dos mesas con el mismo nombre", 400);
      throw e;
    });
    return { ok: true };
  });

  /** Modificadores disponibles (los de nota y los extras con cargo), con el precio del extra. */
  app.get("/cajas/:cajaId/modificadores", async (req) => {
    const ctx = await preparar(req);
    return (await pool.query(
      `SELECT m.id, m.grupo, m.nombre, m.presentacion_id AS "presentacionId", m.categoria_id AS "categoriaId",
              CASE WHEN m.presentacion_id IS NULL THEN NULL ELSE p.nombre END AS "producto"
         FROM modificadores m
         LEFT JOIN presentaciones pr ON pr.id = m.presentacion_id LEFT JOIN productos p ON p.id = pr.producto_id
        WHERE m.empresa_id = $1 AND m.activo ORDER BY m.grupo, m.orden, m.nombre`, [ctx.empresaId])).rows;
  });

  /** Guarda los modificadores (solo supervisor). */
  app.put("/cajas/:cajaId/modificadores", async (req) => {
    const ctx = await preparar(req);
    exigirSupervisor(req, "Configurar los modificadores");
    const b = z.object({
      modificadores: z.array(z.object({
        id: uuid.optional(), grupo: z.string().trim().max(30).default(""), nombre: z.string().trim().min(1).max(40),
        presentacionId: uuid.nullable().default(null), categoriaId: uuid.nullable().default(null),
      })).max(300),
    }).parse(req.body);
    await enTransaccion(async (c) => {
      const ids: string[] = [];
      for (const [i, m] of b.modificadores.entries()) {
        if (m.presentacionId && !(await c.query(
          "SELECT 1 FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id WHERE pr.id = $1 AND p.empresa_id = $2", [m.presentacionId, ctx.empresaId])).rowCount) {
          throw new ErrorNegocio(`El producto del extra «${m.nombre}» no existe`, 400);
        }
        if (m.categoriaId && !(await c.query("SELECT 1 FROM categorias WHERE id = $1 AND empresa_id = $2", [m.categoriaId, ctx.empresaId])).rowCount) {
          throw new ErrorNegocio(`La categoría de «${m.nombre}» no existe`, 400);
        }
        const id = m.id ?? uuidv7();
        ids.push(id);
        await c.query(
          `INSERT INTO modificadores (id, empresa_id, grupo, nombre, presentacion_id, categoria_id, orden, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
           ON CONFLICT (id) DO UPDATE SET grupo = $3, nombre = $4, presentacion_id = $5, categoria_id = $6, orden = $7, activo = TRUE WHERE modificadores.empresa_id = $2`,
          [id, ctx.empresaId, m.grupo, m.nombre, m.presentacionId, m.categoriaId, i]);
      }
      await c.query("UPDATE modificadores SET activo = FALSE WHERE empresa_id = $1 AND NOT (id = ANY($2::uuid[]))", [ctx.empresaId, ids]);
    });
    return { ok: true };
  });
}
