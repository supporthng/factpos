import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { crearTraspaso, recibirTraspaso, esquemaRecepcion } from "./traspasos.js";

/**
 * Surtido de las tiendas desde el almacén (todo bajo el mismo RNC):
 *
 *   1. La tienda (o la oficina) arma un PEDIDO. El sistema sugiere cuánto
 *      pedir con los mínimos y máximos de cada producto en esa tienda.
 *   2. El almacén lo DESPACHA: ajusta cantidades a lo que tiene, imprime el
 *      CONDUCE y la mercancía sale de su inventario (queda "en tránsito").
 *   3. La tienda RECIBE contando: lo que llegó entra a su inventario al
 *      mismo costo. Si falta algo, el traspaso queda "con diferencia".
 *
 * No es una venta: no lleva comprobante fiscal ni genera ganancia.
 */
const uuid = z.string().uuid();
const cant = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida");

export async function rutasCentralTraspasos(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }, dado?: string) => {
    const u = dado ?? uuid.safeParse(req.headers["x-usuario-id"]).data;
    if (!u) throw new ErrorNegocio("Falta el usuario que registra");
    return u;
  };

  /** Almacén principal de una sucursal de la empresa. */
  const almacenDe = async (c: { query: typeof pool.query }, empresaId: string, sucursalId: string) => {
    const r = await c.query<{ id: string; nombre: string; tipo: string }>(
      `SELECT a.id, s.nombre, s.tipo FROM almacenes a JOIN sucursales s ON s.id = a.sucursal_id
        WHERE s.id = $1 AND s.empresa_id = $2 ORDER BY a.es_principal DESC, a.nombre LIMIT 1`,
      [sucursalId, empresaId],
    );
    if (!r.rowCount) throw new ErrorNegocio("Sucursal no encontrada o sin almacén", 404);
    return r.rows[0];
  };

  // ---------------------------------------------------------- Sucursal / almacén
  app.put("/central/sucursales/:id/tipo", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { tipo } = z.object({ tipo: z.enum(["TIENDA", "ALMACEN"]) }).parse(req.body);
    const r = await pool.query("UPDATE sucursales SET tipo = $2 WHERE id = $1 AND empresa_id = $3 RETURNING id, nombre, tipo",
      [id, tipo, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    return r.rows[0];
  });

  // ---------------------------------------------------------- Traspasos
  app.get("/central/traspasos", async (req) => {
    const f = z.object({
      estado: z.enum(["EN_TRANSITO", "RECIBIDA", "CON_DIFERENCIA"]).optional(),
      sucursalId: uuid.optional(),
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.query);
    const r = await pool.query(
      `SELECT t.id, t.numero, t.estado, t.enviado_en AS "enviadoEn", t.recibido_en AS "recibidoEn",
              so.id AS "origenId", so.nombre AS origen, sd.id AS "destinoId", sd.nombre AS destino,
              t.chofer, t.vehiculo, p.numero AS pedido,
              ue.nombre AS "enviadoPor", ur.nombre AS "recibidoPor",
              COUNT(ti.id)::int AS lineas,
              SUM(ti.cantidad_enviada) AS unidades,
              ROUND(SUM(ti.cantidad_enviada * ti.costo_unitario), 2) AS "valorEnviado",
              ROUND(SUM((ti.cantidad_enviada - COALESCE(ti.cantidad_recibida, 0)) * ti.costo_unitario)
                    FILTER (WHERE t.estado <> 'EN_TRANSITO'), 2) AS "valorDiferencia"
         FROM transferencias t
         JOIN sucursales so ON so.id = t.origen_sucursal_id
         JOIN sucursales sd ON sd.id = t.destino_sucursal_id
         JOIN transferencia_items ti ON ti.transferencia_id = t.id
         LEFT JOIN pedidos_sucursal p ON p.id = t.pedido_id
         LEFT JOIN usuarios ue ON ue.id = t.enviado_por
         LEFT JOIN usuarios ur ON ur.id = t.recibido_por
        WHERE so.empresa_id = $1
          AND ($2::text IS NULL OR t.estado = $2)
          AND ($3::uuid IS NULL OR t.origen_sucursal_id = $3 OR t.destino_sucursal_id = $3)
          AND ($4::date IS NULL OR (t.enviado_en AT TIME ZONE 'America/Santo_Domingo')::date >= $4)
          AND ($5::date IS NULL OR (t.enviado_en AT TIME ZONE 'America/Santo_Domingo')::date <= $5)
        GROUP BY t.id, so.id, sd.id, p.numero, ue.nombre, ur.nombre
        ORDER BY t.enviado_en DESC LIMIT 300`,
      [empresaDe(req), f.estado ?? null, f.sucursalId ?? null, f.desde ?? null, f.hasta ?? null],
    );
    return r.rows;
  });

  /** Detalle completo: sirve para el conduce y para la pantalla de recepción. */
  app.get("/central/traspasos/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const t = await pool.query(
      `SELECT t.id, t.numero, t.estado, t.enviado_en AS "enviadoEn", t.recibido_en AS "recibidoEn",
              t.notas, t.notas_recepcion AS "notasRecepcion", t.chofer, t.vehiculo,
              jsonb_build_object('id', so.id, 'codigo', so.codigo, 'nombre', so.nombre, 'direccion', so.direccion, 'telefono', so.telefono) AS origen,
              jsonb_build_object('id', sd.id, 'codigo', sd.codigo, 'nombre', sd.nombre, 'direccion', sd.direccion, 'telefono', sd.telefono) AS destino,
              ao.nombre AS "almacenOrigen", ad.nombre AS "almacenDestino",
              ue.nombre AS "enviadoPor", ur.nombre AS "recibidoPor", p.numero AS pedido,
              jsonb_build_object('nombre', e.nombre_comercial, 'razonSocial', e.razon_social, 'rnc', e.rnc) AS empresa
         FROM transferencias t
         JOIN sucursales so ON so.id = t.origen_sucursal_id
         JOIN sucursales sd ON sd.id = t.destino_sucursal_id
         JOIN empresas e ON e.id = so.empresa_id
         JOIN almacenes ao ON ao.id = t.origen_almacen_id
         JOIN almacenes ad ON ad.id = t.destino_almacen_id
         LEFT JOIN usuarios ue ON ue.id = t.enviado_por
         LEFT JOIN usuarios ur ON ur.id = t.recibido_por
         LEFT JOIN pedidos_sucursal p ON p.id = t.pedido_id
        WHERE t.id = $1 AND so.empresa_id = $2`,
      [id, empresaDe(req)],
    );
    if (!t.rowCount) throw new ErrorNegocio("Traspaso no encontrado", 404);
    const items = await pool.query(
      `SELECT ti.producto_id AS "productoId", p.sku, p.nombre, p.unidad_base AS unidad,
              (SELECT cb.codigo FROM codigos_barra cb JOIN presentaciones pr ON pr.id = cb.presentacion_id
                WHERE pr.producto_id = p.id AND cb.activo ORDER BY pr.factor LIMIT 1) AS codigo,
              ti.cantidad_pedida AS pedida, ti.cantidad_enviada AS enviada, ti.cantidad_recibida AS recibida,
              ti.costo_unitario AS costo, ROUND(ti.cantidad_enviada * ti.costo_unitario, 2) AS valor
         FROM transferencia_items ti JOIN productos p ON p.id = ti.producto_id
        WHERE ti.transferencia_id = $1 ORDER BY p.nombre`,
      [id],
    );
    const valor = items.rows.reduce((a, i) => a.plus(i.valor), new Decimal(0));
    return { ...t.rows[0], items: items.rows, valorAlCosto: valor.toFixed(2) };
  });

  /** Traspaso directo (sin pedido). */
  app.post("/central/traspasos", async (req, rep) => {
    const b = z.object({
      origenSucursalId: uuid, destinoSucursalId: uuid, usuarioId: uuid.optional(),
      notas: z.string().max(300).optional(), chofer: z.string().max(80).optional(), vehiculo: z.string().max(40).optional(),
      items: z.array(z.object({ productoId: uuid, cantidad: cant })).min(1).max(1000),
    }).parse(req.body);
    if (b.origenSucursalId === b.destinoSucursalId) throw new ErrorNegocio("El origen y el destino deben ser distintos");
    const empresaId = empresaDe(req);
    const r = await enTransaccion(async (c) => {
      const o = await almacenDe(c, empresaId, b.origenSucursalId);
      const d = await almacenDe(c, empresaId, b.destinoSucursalId);
      return crearTraspaso(c, {
        origenAlmacenId: o.id, destinoAlmacenId: d.id, usuarioId: usuarioDe(req, b.usuarioId),
        notas: b.notas, chofer: b.chofer, vehiculo: b.vehiculo, items: b.items,
      });
    });
    rep.code(201);
    return r;
  });

  /** Recepción contando: cada línea con lo que llegó de verdad. */
  app.post("/central/traspasos/:id/recibir", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const b = esquemaRecepcion.parse({ ...raw, usuarioId: usuarioDe(req, raw.usuarioId as string | undefined) });
    const empresaId = empresaDe(req);
    return enTransaccion(async (c) => {
      const ok = await c.query("SELECT 1 FROM transferencias t JOIN sucursales s ON s.id = t.destino_sucursal_id WHERE t.id = $1 AND s.empresa_id = $2", [id, empresaId]);
      if (!ok.rowCount) throw new ErrorNegocio("Traspaso no encontrado", 404);
      return recibirTraspaso(c, id, b);
    });
  });

  /** Resumen por mes: cuánto mandó el almacén a cada tienda (al costo). */
  app.get("/central/traspasos-resumen", async (req) => {
    const { meses } = z.object({ meses: z.coerce.number().int().min(1).max(24).default(6) }).parse(req.query);
    const r = await pool.query(
      `SELECT mes, origen, destino, traspasos::int, valor_enviado AS "valorEnviado", valor_recibido AS "valorRecibido",
              valor_diferencia AS "valorDiferencia", valor_en_transito AS "valorEnTransito"
         FROM rpt_traspasos_mes
        WHERE empresa_id = $1 AND mes >= date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')::date - make_interval(months => $2 - 1)
        ORDER BY mes DESC, valor_enviado DESC`,
      [empresaDe(req), meses],
    );
    return r.rows;
  });

  // ---------------------------------------------------------- Pedidos de las tiendas
  /**
   * Cantidades sugeridas para que una tienda pida al almacén:
   * se pide cuando (existencia + lo que viene en camino) llega al mínimo,
   * y se completa hasta el máximo (o el doble del mínimo si no hay máximo),
   * sin pasar de lo que el almacén tiene.
   */
  app.get("/central/pedidos-sucursal/sugerido", async (req) => {
    const f = z.object({ sucursalId: uuid, surteId: uuid, todos: z.enum(["1"]).optional() }).parse(req.query);
    const empresaId = empresaDe(req);
    const r = await pool.query(
      `WITH tienda AS (
         SELECT ps.producto_id, ps.stock_minimo AS minimo, ps.stock_maximo AS maximo
           FROM producto_sucursal ps WHERE ps.sucursal_id = $2 AND ps.activo
       ), exist AS (
         SELECT e.producto_id, SUM(e.cantidad) AS cantidad
           FROM existencias e JOIN almacenes a ON a.id = e.almacen_id WHERE a.sucursal_id = $2 GROUP BY e.producto_id
       ), almacen AS (
         SELECT e.producto_id, SUM(e.cantidad) AS cantidad
           FROM existencias e JOIN almacenes a ON a.id = e.almacen_id WHERE a.sucursal_id = $3 GROUP BY e.producto_id
       ), camino AS (
         SELECT ti.producto_id, SUM(ti.cantidad_enviada) AS cantidad
           FROM transferencias t JOIN transferencia_items ti ON ti.transferencia_id = t.id
          WHERE t.destino_sucursal_id = $2 AND t.estado = 'EN_TRANSITO' GROUP BY ti.producto_id
       ), pedido AS (
         SELECT i.producto_id, SUM(i.cantidad) AS cantidad
           FROM pedidos_sucursal p JOIN pedido_sucursal_items i ON i.pedido_id = p.id
          WHERE p.sucursal_id = $2 AND p.estado = 'PENDIENTE' GROUP BY i.producto_id
       ), vendido AS (
         SELECT k.producto_id, -SUM(k.cantidad) AS cantidad
           FROM kardex_movimientos k
          WHERE k.sucursal_id = $2 AND k.tipo = 'VENTA' AND k.creado_en > now() - interval '30 days'
          GROUP BY k.producto_id
       )
       SELECT p.id AS "productoId", p.sku, p.nombre, p.unidad_base AS unidad,
              COALESCE(ex.cantidad, 0) AS existencia, t.minimo, t.maximo,
              COALESCE(ca.cantidad, 0) AS "enCamino", COALESCE(pe.cantidad, 0) AS "yaPedido",
              COALESCE(al.cantidad, 0) AS "enAlmacen", COALESCE(v.cantidad, 0) AS "vendido30d",
              GREATEST(0, LEAST(COALESCE(al.cantidad, 0),
                CASE WHEN COALESCE(ex.cantidad, 0) + COALESCE(ca.cantidad, 0) + COALESCE(pe.cantidad, 0) <= t.minimo
                     THEN COALESCE(t.maximo, t.minimo * 2) - COALESCE(ex.cantidad, 0) - COALESCE(ca.cantidad, 0) - COALESCE(pe.cantidad, 0)
                     ELSE 0 END)) AS sugerida
         FROM tienda t
         JOIN productos p ON p.id = t.producto_id AND p.activo AND p.tipo = 'INVENTARIABLE' AND p.empresa_id = $1
         LEFT JOIN exist ex ON ex.producto_id = p.id
         LEFT JOIN almacen al ON al.producto_id = p.id
         LEFT JOIN camino ca ON ca.producto_id = p.id
         LEFT JOIN pedido pe ON pe.producto_id = p.id
         LEFT JOIN vendido v ON v.producto_id = p.id
        WHERE t.minimo > 0 OR $4
        ORDER BY (CASE WHEN COALESCE(ex.cantidad, 0) <= t.minimo THEN 0 ELSE 1 END), p.nombre
        LIMIT 2000`,
      [empresaId, f.sucursalId, f.surteId, f.todos === "1"],
    );
    // Se redondea a unidades enteras (no se mandan fracciones de botella)
    return r.rows.map((x) => ({ ...x, sugerida: String(Math.floor(Number(x.sugerida))) }));
  });

  app.get("/central/pedidos-sucursal", async (req) => {
    const f = z.object({ estado: z.enum(["PENDIENTE", "DESPACHADO", "ANULADO"]).optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT p.id, p.numero, p.estado, p.creado_en AS "creadoEn", p.despachado_en AS "despachadoEn", p.notas,
              s.id AS "sucursalId", s.nombre AS sucursal, a.id AS "surteId", a.nombre AS surte,
              u.nombre AS "creadoPor", t.numero AS traspaso, t.id AS "traspasoId", t.estado AS "estadoTraspaso",
              (SELECT COUNT(*)::int FROM pedido_sucursal_items i WHERE i.pedido_id = p.id) AS lineas,
              (SELECT SUM(i.cantidad) FROM pedido_sucursal_items i WHERE i.pedido_id = p.id) AS unidades
         FROM pedidos_sucursal p
         JOIN sucursales s ON s.id = p.sucursal_id
         JOIN sucursales a ON a.id = p.surte_sucursal_id
         LEFT JOIN usuarios u ON u.id = p.creado_por
         LEFT JOIN transferencias t ON t.id = p.transferencia_id
        WHERE p.empresa_id = $1 AND ($2::text IS NULL OR p.estado = $2)
        ORDER BY (p.estado = 'PENDIENTE') DESC, p.creado_en DESC LIMIT 200`,
      [empresaDe(req), f.estado ?? null],
    );
    return r.rows;
  });

  app.get("/central/pedidos-sucursal/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const empresaId = empresaDe(req);
    const p = await pool.query(
      `SELECT p.id, p.numero, p.estado, p.notas, p.creado_en AS "creadoEn", p.sucursal_id AS "sucursalId", s.nombre AS sucursal,
              p.surte_sucursal_id AS "surteId", a.nombre AS surte, p.transferencia_id AS "traspasoId"
         FROM pedidos_sucursal p JOIN sucursales s ON s.id = p.sucursal_id JOIN sucursales a ON a.id = p.surte_sucursal_id
        WHERE p.id = $1 AND p.empresa_id = $2`,
      [id, empresaId],
    );
    if (!p.rowCount) throw new ErrorNegocio("Pedido no encontrado", 404);
    const items = await pool.query(
      `SELECT i.producto_id AS "productoId", pr.sku, pr.nombre, pr.unidad_base AS unidad, i.existencia, i.sugerida, i.cantidad,
              COALESCE((SELECT SUM(e.cantidad) FROM existencias e JOIN almacenes al ON al.id = e.almacen_id
                         WHERE al.sucursal_id = $2 AND e.producto_id = i.producto_id), 0) AS "enAlmacen"
         FROM pedido_sucursal_items i JOIN productos pr ON pr.id = i.producto_id
        WHERE i.pedido_id = $1 ORDER BY pr.nombre`,
      [id, p.rows[0].surteId],
    );
    return { ...p.rows[0], items: items.rows };
  });

  app.post("/central/pedidos-sucursal", async (req, rep) => {
    const b = z.object({
      sucursalId: uuid, surteId: uuid, notas: z.string().max(300).optional(),
      items: z.array(z.object({ productoId: uuid, cantidad: cant, sugerida: cant.optional(), existencia: z.string().optional() })).min(1).max(2000),
    }).parse(req.body);
    if (b.sucursalId === b.surteId) throw new ErrorNegocio("Una sucursal no se puede surtir a sí misma");
    const empresaId = empresaDe(req);
    const usuario = uuid.safeParse(req.headers["x-usuario-id"]).data ?? null;
    const items = b.items.filter((i) => Number(i.cantidad) > 0);
    if (!items.length) throw new ErrorNegocio("El pedido no tiene cantidades");
    const r = await enTransaccion(async (c) => {
      await almacenDe(c, empresaId, b.sucursalId);
      await almacenDe(c, empresaId, b.surteId);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pedidos:${empresaId}`]);
      const n = (await c.query<{ n: string }>("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM pedidos_sucursal WHERE empresa_id = $1", [empresaId])).rows[0].n;
      const id = uuidv7();
      await c.query(
        `INSERT INTO pedidos_sucursal (id, empresa_id, numero, sucursal_id, surte_sucursal_id, notas, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, empresaId, n, b.sucursalId, b.surteId, b.notas ?? null, usuario],
      );
      const vistos = new Set<string>();
      for (const i of items) {
        if (vistos.has(i.productoId)) throw new ErrorNegocio("Hay un producto repetido en el pedido");
        vistos.add(i.productoId);
        await c.query(
          `INSERT INTO pedido_sucursal_items (id, pedido_id, producto_id, existencia, sugerida, cantidad)
           VALUES ($1,$2,$3,(SELECT COALESCE(SUM(e.cantidad), 0) FROM existencias e JOIN almacenes a ON a.id = e.almacen_id
                              WHERE a.sucursal_id = $6 AND e.producto_id = $3),$4,$5)`,
          [uuidv7(), id, i.productoId, i.sugerida ?? null, i.cantidad, b.sucursalId],
        );
      }
      return { id, numero: n };
    });
    rep.code(201);
    return r;
  });

  /**
   * Despachar un pedido: se crea el traspaso con lo que el almacén manda de verdad
   * (puede ser menos de lo pedido si no hay). Sale del almacén y queda en tránsito.
   */
  app.post("/central/pedidos-sucursal/:id/despachar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      usuarioId: uuid.optional(), chofer: z.string().max(80).optional(), vehiculo: z.string().max(40).optional(),
      notas: z.string().max(300).optional(),
      items: z.array(z.object({ productoId: uuid, cantidad: z.string().regex(/^\d+(\.\d{1,3})?$/) })).optional(), // omitido = lo pedido
    }).parse(req.body ?? {});
    const empresaId = empresaDe(req);
    return enTransaccion(async (c) => {
      const p = (await c.query("SELECT * FROM pedidos_sucursal WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [id, empresaId])).rows[0];
      if (!p) throw new ErrorNegocio("Pedido no encontrado", 404);
      if (p.estado !== "PENDIENTE") throw new ErrorNegocio(`El pedido ya está ${p.estado.toLowerCase()}`, 409);
      const lineas = (await c.query("SELECT producto_id, cantidad FROM pedido_sucursal_items WHERE pedido_id = $1", [id])).rows;
      const despacho = new Map(b.items?.map((i) => [i.productoId, i.cantidad]));
      const items = lineas
        .map((l) => ({ productoId: l.producto_id as string, cantidad: new Decimal(despacho.get(l.producto_id) ?? l.cantidad).toFixed(3), cantidadPedida: new Decimal(l.cantidad).toFixed(3) }))
        .filter((i) => Number(i.cantidad) > 0);
      if (!items.length) throw new ErrorNegocio("No hay nada que despachar: si el almacén no tiene nada, anule el pedido");
      const o = await almacenDe(c, empresaId, p.surte_sucursal_id);
      const d = await almacenDe(c, empresaId, p.sucursal_id);
      const t = await crearTraspaso(c, {
        origenAlmacenId: o.id, destinoAlmacenId: d.id, usuarioId: usuarioDe(req, b.usuarioId),
        notas: b.notas, chofer: b.chofer, vehiculo: b.vehiculo, pedidoId: id, items,
      });
      await c.query("UPDATE pedidos_sucursal SET estado = 'DESPACHADO', despachado_en = now(), transferencia_id = $2 WHERE id = $1", [id, t.id]);
      return { pedido: p.numero, traspaso: t };
    });
  });

  app.post("/central/pedidos-sucursal/:id/anular", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      "UPDATE pedidos_sucursal SET estado = 'ANULADO' WHERE id = $1 AND empresa_id = $2 AND estado = 'PENDIENTE' RETURNING numero, estado",
      [id, empresaDe(req)],
    );
    if (!r.rowCount) throw new ErrorNegocio("Solo se anula un pedido pendiente", 409);
    return r.rows[0];
  });
}
