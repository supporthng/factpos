import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";
import { verificarAutorizacion } from "../autorizacion.js";

/**
 * Aforo (discotecas y bares): cuántas personas hay dentro. Las entradas son ventas normales de la categoría elegida
 * (cada unidad = una persona; las devoluciones restan); además se anotan salidas, entradas sin cobro y el reinicio de la noche.
 * Solo si la empresa lo activó (Datos de la empresa › Entradas y aforo).
 */
const uuid = z.string().uuid();

export async function calcularAforo(sucursalId: string, empresaId: string) {
  const r = await pool.query<{ maximo: number | null; pagadas: string; sinCobro: string; salidas: string; desde: string }>(
    `WITH e AS (SELECT aforo_categoria_id AS cat, aforo_maximo AS maximo FROM empresas WHERE id = $1),
          d AS (SELECT COALESCE(max(creado_en), now() - interval '24 hours') AS desde FROM aforo_eventos WHERE sucursal_id = $2 AND tipo = 'REINICIO')
     SELECT (SELECT maximo FROM e) AS maximo, (SELECT desde FROM d) AS desde,
            COALESCE((SELECT sum(CASE WHEN v.tipo_documento = 'E34' THEN -i.cantidad ELSE i.cantidad END)
                        FROM venta_items i JOIN ventas v ON v.id = i.venta_id
                        JOIN presentaciones pr ON pr.id = i.presentacion_id JOIN productos p ON p.id = pr.producto_id
                       WHERE v.sucursal_id = $2 AND v.creado_en > (SELECT desde FROM d) AND p.categoria_id = (SELECT cat FROM e)), 0)::text AS pagadas,
            COALESCE((SELECT sum(cantidad) FROM aforo_eventos WHERE sucursal_id = $2 AND tipo = 'ENTRADA_SIN_COBRO' AND creado_en > (SELECT desde FROM d)), 0)::text AS "sinCobro",
            COALESCE((SELECT sum(cantidad) FROM aforo_eventos WHERE sucursal_id = $2 AND tipo = 'SALIDA' AND creado_en > (SELECT desde FROM d)), 0)::text AS salidas`,
    [empresaId, sucursalId]);
  const f = r.rows[0];
  const entradas = Math.round(Number(f.pagadas)) + Number(f.sinCobro);
  const salidas = Number(f.salidas);
  return { maximo: f.maximo, desde: f.desde, pagadas: Math.round(Number(f.pagadas)), sinCobro: Number(f.sinCobro), entradas, salidas, dentro: Math.max(0, entradas - salidas) };
}

export async function rutasAforo(app: FastifyInstance) {
  const preparar = async (req: { params: unknown }) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const e = (await pool.query<{ a: boolean; c: string | null }>("SELECT aforo_activo AS a, aforo_categoria_id AS c FROM empresas WHERE id = $1", [ctx.empresaId])).rows[0];
    if (!e?.a) throw new ErrorNegocio("El control de aforo no está activado para esta empresa", 409);
    return { ...ctx, sinCategoria: !e.c };
  };

  app.get("/cajas/:cajaId/aforo", async (req) => {
    const ctx = await preparar(req);
    return { ...(await calcularAforo(ctx.sucursalId, ctx.empresaId)), sinCategoria: ctx.sinCategoria };
  });

  /** Anota una salida, una entrada sin cobro (lista, invitados) o el reinicio de la noche (este pide supervisor). */
  app.post("/cajas/:cajaId/aforo/evento", async (req) => {
    const ctx = await preparar(req);
    const b = z.object({
      tipo: z.enum(["SALIDA", "ENTRADA_SIN_COBRO", "REINICIO"]), cantidad: z.number().int().min(1).max(500).default(1),
      motivo: z.string().trim().max(200).optional(), autorizacion: z.string().max(2000).optional(),
    }).parse(req.body);
    const usuarioId = (req as { sesionCaja?: { u?: string } }).sesionCaja?.u ?? null;
    let autorizado: string | null = null;
    if (b.tipo === "REINICIO") autorizado = verificarAutorizacion(b.autorizacion, "venta.anular", ctx.cajaId).supervisorId;
    if (b.tipo === "SALIDA") {
      const a = await calcularAforo(ctx.sucursalId, ctx.empresaId);
      if (b.cantidad > a.dentro) throw new ErrorNegocio(`Solo hay ${a.dentro} persona(s) registradas dentro`, 409);
    }
    await pool.query(
      `INSERT INTO aforo_eventos (id, sucursal_id, tipo, cantidad, motivo, usuario_id, autorizado_por) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuidv7(), ctx.sucursalId, b.tipo, b.tipo === "REINICIO" ? 0 : b.cantidad, b.motivo || null, usuarioId, autorizado]);
    return { ...(await calcularAforo(ctx.sucursalId, ctx.empresaId)), sinCategoria: ctx.sinCategoria };
  });
}
