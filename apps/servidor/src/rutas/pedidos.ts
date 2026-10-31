import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";
import { contextoCaja } from "../contexto.js";

/**
 * Pedidos de clientes (venta al por mayor).
 *   Administración: el vendedor anota el pedido y lo envía a una caja (o a cualquiera de la sucursal) como comanda.
 *   Caja: ve el pedido, lo va alistando y, cuando está completo, lo factura como una venta normal.
 *   PENDIENTE → LISTO (todo alistado) → FACTURADO      (CANCELADO solo antes de facturar)
 * Los precios no se guardan en el pedido: se cobran al facturar, con los precios y el nivel del cliente de ese momento.
 */
const uuid = z.string().uuid();
const cantidad = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida").refine((v) => Number(v) > 0, "La cantidad debe ser mayor que cero");

const SQL_PEDIDO = `
  SELECT p.id, 'PM-' || lpad(p.numero::text, 5, '0') AS numero, p.sucursal_id AS "sucursalId", s.nombre AS sucursal,
         p.caja_id AS "cajaId", c.nombre AS caja, p.cliente_id AS "clienteId", p.cliente_nombre AS "clienteNombre", p.telefono,
         p.nota, p.preparado_por AS "preparadoPor", p.estado, p.creado_en AS "creadoEn", p.listo_en AS "listoEn",
         p.facturado_en AS "facturadoEn", p.venta_id AS "ventaId", u.nombre AS "creadoPor",
         (SELECT count(*)::int FROM pedidos_clientes_items i WHERE i.pedido_id = p.id) AS lineas,
         (SELECT count(*)::int FROM pedidos_clientes_items i WHERE i.pedido_id = p.id AND i.alistado) AS alistadas
    FROM pedidos_clientes p
    JOIN sucursales s ON s.id = p.sucursal_id
    LEFT JOIN cajas c ON c.id = p.caja_id
    LEFT JOIN usuarios u ON u.id = p.creado_por`;

const SQL_ITEMS = `
  SELECT i.id, i.presentacion_id AS "presentacionId", pr.nombre AS presentacion, pr.factor, pd.nombre AS producto, pd.sku,
         i.cantidad, i.nota, i.alistado
    FROM pedidos_clientes_items i
    JOIN presentaciones pr ON pr.id = i.presentacion_id
    JOIN productos pd ON pd.id = pr.producto_id
   WHERE i.pedido_id = $1 ORDER BY i.orden, i.id`;

export async function rutasPedidos(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);
  const sucursalPermitida = (req: { headers: Record<string, unknown> }, sucursalId: string) => {
    const s = sucursalesDe(req);
    if (s && !s.includes(sucursalId)) throw new ErrorNegocio("No tiene acceso a esa sucursal", 403);
  };

  const cuerpoPedido = z.object({
    sucursalId: uuid,
    cajaId: uuid.nullable().optional(),
    clienteId: uuid.nullable().optional(),
    clienteNombre: z.string().trim().min(2).max(120),
    telefono: z.string().trim().max(30).optional(),
    nota: z.string().trim().max(500).optional(),
    preparadoPor: z.string().trim().max(80).optional(),
    items: z.array(z.object({ presentacionId: uuid, cantidad, nota: z.string().trim().max(200).optional() })).min(1).max(300),
  });

  /** Valida sucursal, caja, cliente y presentaciones del pedido (todo debe ser de esta empresa). */
  const validar = async (empresaId: string, b: z.infer<typeof cuerpoPedido>) => {
    const s = await pool.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2 AND activo", [b.sucursalId, empresaId]);
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    if (b.cajaId) {
      const c = await pool.query("SELECT 1 FROM cajas WHERE id = $1 AND sucursal_id = $2 AND activo", [b.cajaId, b.sucursalId]);
      if (!c.rowCount) throw new ErrorNegocio("Esa caja no es de la sucursal elegida", 400);
    }
    if (b.clienteId) {
      const c = await pool.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2", [b.clienteId, empresaId]);
      if (!c.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
    }
    const ids = [...new Set(b.items.map((i) => i.presentacionId))];
    if (ids.length !== b.items.length) throw new ErrorNegocio("Un producto está repetido en el pedido; sume las cantidades en una sola línea", 400);
    const p = await pool.query(
      "SELECT pr.id FROM presentaciones pr JOIN productos pd ON pd.id = pr.producto_id WHERE pr.id = ANY($1) AND pd.empresa_id = $2 AND pd.activo",
      [ids, empresaId]);
    if (p.rowCount !== ids.length) throw new ErrorNegocio("Hay productos del pedido que ya no existen o están inactivos", 400);
  };

  // ------------------------------------------------------------------ Administración
  app.get("/central/pedidos", async (req) => {
    const f = z.object({ estado: z.enum(["PENDIENTE", "LISTO", "FACTURADO", "CANCELADO", "ABIERTOS"]).optional(), sucursalId: uuid.optional() }).parse(req.query);
    const r = await pool.query(
      `${SQL_PEDIDO}
        WHERE p.empresa_id = $1 AND ($2::uuid[] IS NULL OR p.sucursal_id = ANY($2)) AND ($3::uuid IS NULL OR p.sucursal_id = $3)
          AND (CASE WHEN $4::text IS NULL THEN TRUE WHEN $4 = 'ABIERTOS' THEN p.estado IN ('PENDIENTE','LISTO') ELSE p.estado = $4 END)
        ORDER BY p.creado_en DESC LIMIT 300`,
      [empresaDe(req), sucursalesDe(req), f.sucursalId ?? null, f.estado ?? null]);
    return r.rows;
  });

  /** Cajas de una sucursal, para elegir a cuál se envía el pedido. */
  app.get("/central/pedidos/cajas", async (req) => {
    const { sucursalId } = z.object({ sucursalId: uuid }).parse(req.query);
    sucursalPermitida(req, sucursalId);
    const r = await pool.query(
      `SELECT c.id, c.nombre FROM cajas c JOIN sucursales s ON s.id = c.sucursal_id
        WHERE c.sucursal_id = $1 AND s.empresa_id = $2 AND c.activo ORDER BY c.numero`, [sucursalId, empresaDe(req)]);
    return r.rows;
  });

  app.get("/central/pedidos/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(`${SQL_PEDIDO} WHERE p.id = $1 AND p.empresa_id = $2`, [id, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Pedido no encontrado", 404);
    sucursalPermitida(req, r.rows[0].sucursalId);
    return { ...r.rows[0], items: (await pool.query(SQL_ITEMS, [id])).rows };
  });

  app.post("/central/pedidos", async (req, rep) => {
    const b = cuerpoPedido.parse(req.body);
    const empresaId = empresaDe(req);
    sucursalPermitida(req, b.sucursalId);
    await validar(empresaId, b);
    const id = uuidv7();
    await enTransaccion(async (c) => {
      await c.query(
        `INSERT INTO pedidos_clientes (id, empresa_id, sucursal_id, caja_id, cliente_id, cliente_nombre, telefono, nota, preparado_por, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, empresaId, b.sucursalId, b.cajaId ?? null, b.clienteId ?? null, b.clienteNombre, b.telefono || null, b.nota || null, b.preparadoPor || null, usuarioDe(req)]);
      for (const [orden, i] of b.items.entries()) {
        await c.query("INSERT INTO pedidos_clientes_items (id, pedido_id, presentacion_id, cantidad, nota, orden) VALUES ($1,$2,$3,$4,$5,$6)",
          [uuidv7(), id, i.presentacionId, i.cantidad, i.nota || null, orden]);
      }
    });
    rep.code(201);
    return { id };
  });

  /** Cambiar un pedido que todavía no se facturó (se vuelve a alistar desde cero). */
  app.put("/central/pedidos/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = cuerpoPedido.parse(req.body);
    const empresaId = empresaDe(req);
    sucursalPermitida(req, b.sucursalId);
    await validar(empresaId, b);
    await enTransaccion(async (c) => {
      const p = await c.query("SELECT estado, sucursal_id FROM pedidos_clientes WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [id, empresaId]);
      if (!p.rowCount) throw new ErrorNegocio("Pedido no encontrado", 404);
      sucursalPermitida(req, p.rows[0].sucursal_id);
      if (!["PENDIENTE", "LISTO"].includes(p.rows[0].estado)) throw new ErrorNegocio("Este pedido ya se facturó o se canceló y no se puede cambiar", 409);
      await c.query(
        `UPDATE pedidos_clientes SET sucursal_id=$2, caja_id=$3, cliente_id=$4, cliente_nombre=$5, telefono=$6, nota=$7, preparado_por=$8,
                estado='PENDIENTE', listo_en=NULL, actualizado_en=now() WHERE id=$1`,
        [id, b.sucursalId, b.cajaId ?? null, b.clienteId ?? null, b.clienteNombre, b.telefono || null, b.nota || null, b.preparadoPor || null]);
      await c.query("DELETE FROM pedidos_clientes_items WHERE pedido_id = $1", [id]);
      for (const [orden, i] of b.items.entries()) {
        await c.query("INSERT INTO pedidos_clientes_items (id, pedido_id, presentacion_id, cantidad, nota, orden) VALUES ($1,$2,$3,$4,$5,$6)",
          [uuidv7(), id, i.presentacionId, i.cantidad, i.nota || null, orden]);
      }
    });
    return { ok: true };
  });

  app.post("/central/pedidos/:id/cancelar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      `UPDATE pedidos_clientes SET estado = 'CANCELADO', actualizado_en = now()
        WHERE id = $1 AND empresa_id = $2 AND estado IN ('PENDIENTE','LISTO') AND ($3::uuid[] IS NULL OR sucursal_id = ANY($3)) RETURNING id`,
      [id, empresaDe(req), sucursalesDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("El pedido no existe, ya se facturó o ya estaba cancelado", 409);
    return { ok: true };
  });

  // ------------------------------------------------------------------ Caja
  /** Pedidos abiertos que esta caja debe atender (los suyos y los de cualquier caja de la sucursal). */
  app.get("/cajas/:cajaId/pedidos", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query(
      `${SQL_PEDIDO} WHERE p.sucursal_id = $1 AND p.estado IN ('PENDIENTE','LISTO') AND (p.caja_id IS NULL OR p.caja_id = $2)
        ORDER BY p.creado_en`, [ctx.sucursalId, cajaId]);
    return r.rows;
  });

  const delPedido = async (cajaId: string, id: string) => {
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query(`${SQL_PEDIDO} WHERE p.id = $1 AND p.sucursal_id = $2 AND (p.caja_id IS NULL OR p.caja_id = $3)`, [id, ctx.sucursalId, cajaId]);
    if (!r.rowCount) throw new ErrorNegocio("Pedido no encontrado en esta caja", 404);
    return r.rows[0];
  };

  app.get("/cajas/:cajaId/pedidos/:id", async (req) => {
    const { cajaId, id } = z.object({ cajaId: uuid, id: uuid }).parse(req.params);
    const p = await delPedido(cajaId, id);
    return { ...p, items: (await pool.query(SQL_ITEMS, [id])).rows };
  });

  /** Marca líneas como alistadas (o ya no). Cuando todas lo están, el pedido queda LISTO. */
  app.post("/cajas/:cajaId/pedidos/:id/alistar", async (req) => {
    const { cajaId, id } = z.object({ cajaId: uuid, id: uuid }).parse(req.params);
    const b = z.object({ itemId: uuid.optional(), todos: z.boolean().optional(), alistado: z.boolean().default(true), preparadoPor: z.string().trim().max(80).optional() }).parse(req.body);
    const p = await delPedido(cajaId, id);
    if (!["PENDIENTE", "LISTO"].includes(p.estado)) throw new ErrorNegocio("Este pedido ya no se puede cambiar", 409);
    await enTransaccion(async (c) => {
      if (b.todos) await c.query("UPDATE pedidos_clientes_items SET alistado = $2 WHERE pedido_id = $1", [id, b.alistado]);
      else if (b.itemId) await c.query("UPDATE pedidos_clientes_items SET alistado = $3 WHERE id = $2 AND pedido_id = $1", [id, b.itemId, b.alistado]);
      if (b.preparadoPor !== undefined) await c.query("UPDATE pedidos_clientes SET preparado_por = $2 WHERE id = $1", [id, b.preparadoPor || null]);
      await c.query(
        `UPDATE pedidos_clientes p SET
            estado = CASE WHEN NOT EXISTS (SELECT 1 FROM pedidos_clientes_items i WHERE i.pedido_id = p.id AND NOT i.alistado) THEN 'LISTO' ELSE 'PENDIENTE' END,
            listo_en = CASE WHEN NOT EXISTS (SELECT 1 FROM pedidos_clientes_items i WHERE i.pedido_id = p.id AND NOT i.alistado) THEN COALESCE(p.listo_en, now()) ELSE NULL END,
            actualizado_en = now()
          WHERE p.id = $1`, [id]);
    });
    return { ...(await delPedido(cajaId, id)), items: (await pool.query(SQL_ITEMS, [id])).rows };
  });

  /** La caja avisa que facturó el pedido: queda cerrado y enlazado a la factura. Repetirlo con la misma factura no hace daño. */
  app.post("/cajas/:cajaId/pedidos/:id/facturado", async (req) => {
    const { cajaId, id } = z.object({ cajaId: uuid, id: uuid }).parse(req.params);
    const { ventaId } = z.object({ ventaId: uuid }).parse(req.body);
    const p = await delPedido(cajaId, id);
    if (p.estado === "FACTURADO") return { ok: true, yaEstaba: p.ventaId === ventaId };
    if (p.estado !== "LISTO") throw new ErrorNegocio("Para facturar, el pedido debe estar completo (todo alistado)", 409);
    const v = await pool.query("SELECT 1 FROM ventas WHERE id = $1 AND caja_id = $2", [ventaId, cajaId]);
    if (!v.rowCount) throw new ErrorNegocio("Esa factura no es de esta caja", 400);
    await pool.query("UPDATE pedidos_clientes SET estado = 'FACTURADO', venta_id = $2, facturado_en = now(), actualizado_en = now() WHERE id = $1", [id, ventaId]);
    return { ok: true };
  });
}
