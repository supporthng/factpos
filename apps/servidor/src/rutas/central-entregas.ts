import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";

/**
 * Entregas programadas: la mercancía de una factura que se lleva a la casa del cliente.
 * El documento de entrega es para el chofer: lleva la dirección, el contacto, los artículos con su serie y la constancia de recibido,
 * sin precios ni saldos (la factura ya la tiene el cliente). Una factura puede entregarse en varias veces.
 * El inventario ya salió al facturar: la entrega no lo mueve.
 * (Escribir pide el permiso «admin.entregas».)
 */
type Db = Pick<PoolClient, "query">;
const uuid = z.string().uuid();
const fechaZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const FRANJA = z.enum(["MANANA", "TARDE", "DIA"]);
const hoyRD = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);

export async function rutasCentralEntregas(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  /** Lo ya programado de cada línea de la factura (sin contar entregas canceladas) */
  const SQL_LINEAS = `
    SELECT i.id AS "ventaItemId", i.linea, i.descripcion, i.cantidad::text, i.factor::text,
           COALESCE((SELECT SUM(ei.cantidad) FROM entrega_items ei JOIN entregas e ON e.id = ei.entrega_id WHERE ei.venta_item_id = i.id AND e.estado <> 'CANCELADA'), 0)::text AS programada,
           COALESCE((SELECT SUM(ni.cantidad) FROM venta_items ni JOIN ventas n ON n.id = ni.venta_id WHERE n.venta_origen_id = i.venta_id AND n.parcial AND ni.linea = i.linea), 0)::text AS devuelta,
           COALESCE((SELECT jsonb_agg(s.serie ORDER BY s.serie) FROM series_producto s WHERE s.venta_item_id = i.id AND s.devuelta_en IS NULL), '[]'::jsonb) AS series,
           (p.tipo = 'INVENTARIABLE') AS inventariable
      FROM venta_items i JOIN presentaciones pr ON pr.id = i.presentacion_id JOIN productos p ON p.id = pr.producto_id
     WHERE i.venta_id = $1 ORDER BY i.linea`;

  /** Busca la factura a entregar: por número, comprobante, cliente o cédula (últimos 120 días, sin anular) */
  app.get("/central/entregas/facturas", async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(40) }).parse(req.query);
    const r = await pool.query(
      `SELECT v.id, v.numero_interno AS numero, COALESCE(d.encf, v.numero_documento) AS documento, v.creado_en AS fecha, cl.id AS "clienteId", cl.nombre AS cliente, cl.documento AS "clienteDocumento",
              cl.telefono, cl.direccion, s.nombre AS sucursal
         FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id LEFT JOIN clientes cl ON cl.id = v.cliente_id LEFT JOIN ecf_documentos d ON d.venta_id = v.id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) AND v.tipo_documento IN ('E31','E32','B01','B02','B14','B15','B16','SIN')
          AND v.creado_en > now() - interval '120 days'
          AND NOT EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = v.id AND n.tipo_documento IN ('E34','ANU') AND NOT n.parcial)
          AND (v.numero_interno::text = $3 OR COALESCE(d.encf, v.numero_documento, '') ILIKE '%' || $3 || '%' OR cl.nombre ILIKE '%' || $3 || '%' OR cl.documento LIKE $3 || '%')
        ORDER BY v.creado_en DESC LIMIT 15`, [empresaDe(req), sucursalesDe(req), q]);
    return r.rows;
  });
  app.get("/central/entregas/facturas/:ventaId/lineas", async (req) => {
    const { ventaId } = z.object({ ventaId: uuid }).parse(req.params);
    const ok = await pool.query("SELECT 1 FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id WHERE v.id = $1 AND s.empresa_id = $2", [ventaId, empresaDe(req)]);
    if (!ok.rowCount) throw new ErrorNegocio("Factura no encontrada", 404);
    return (await pool.query(SQL_LINEAS, [ventaId])).rows.map((l) => ({ ...l, pendiente: Decimal.max(0, new Decimal(l.cantidad).minus(l.devuelta).minus(l.programada)).toString() }));
  });

  app.get("/central/entregas/repartidores", async (req) => {
    const r = await pool.query(
      `SELECT r.id, r.nombre, r.telefono, r.vehiculo, s.nombre AS sucursal FROM repartidores r JOIN sucursales s ON s.id = r.sucursal_id
        WHERE s.empresa_id = $1 AND r.activo AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) ORDER BY r.nombre`, [empresaDe(req), sucursalesDe(req)]);
    return r.rows;
  });

  // ---------------------------------------------------------------------------------------------- Crear
  const ItemEntrega = z.object({ ventaItemId: uuid, cantidad: z.string().regex(/^\d+(\.\d{1,3})?$/), series: z.array(z.string().trim().max(60)).max(200).default([]) });
  const Datos = z.object({
    fechaProgramada: fechaZ, franja: FRANJA.default("DIA"), direccion: z.string().trim().min(5, "Escriba la dirección de entrega").max(300), referencia: z.string().trim().max(200).optional(),
    telefono: z.string().trim().max(30).optional(), telefono2: z.string().trim().max(30).optional(), instrucciones: z.string().trim().max(400).optional(),
    repartidorId: uuid.nullable().optional(), vehiculo: z.string().trim().max(40).optional(),
  });

  app.post("/central/entregas", async (req, rep) => {
    const b = Datos.extend({ ventaId: uuid, items: z.array(ItemEntrega).min(1, "Elija lo que se entrega").max(100) }).parse(req.body);
    if (b.fechaProgramada < hoyRD()) throw new ErrorNegocio("La fecha de entrega no puede estar en el pasado");
    const empresaId = empresaDe(req);
    const id = uuidv7();
    const numero = await enTransaccion(async (c) => {
      const v = (await c.query<{ sucursal_id: string; cliente_id: string | null; tipo_documento: string }>(
        `SELECT v.sucursal_id, v.cliente_id, v.tipo_documento FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id WHERE v.id = $1 AND s.empresa_id = $2 FOR UPDATE OF v`, [b.ventaId, empresaId])).rows[0];
      if (!v) throw new ErrorNegocio("Factura no encontrada", 404);
      if (["E34", "ANU"].includes(v.tipo_documento)) throw new ErrorNegocio("Esa es una nota de crédito: elija la factura");
      if ((await c.query("SELECT 1 FROM ventas n WHERE n.venta_origen_id = $1 AND n.tipo_documento IN ('E34','ANU') AND NOT n.parcial", [b.ventaId])).rowCount) throw new ErrorNegocio("Esa factura fue anulada", 409);
      if (b.repartidorId && !(await c.query("SELECT 1 FROM repartidores WHERE id = $1 AND sucursal_id = $2 AND activo", [b.repartidorId, v.sucursal_id])).rowCount) throw new ErrorNegocio("Ese chofer no es de la sucursal de la factura");
      const lineas = new Map((await c.query<{ ventaItemId: string; descripcion: string; cantidad: string; programada: string; devuelta: string; series: string[]; inventariable: boolean }>(SQL_LINEAS, [b.ventaId])).rows.map((l) => [l.ventaItemId, l]));
      await c.query("SELECT pg_advisory_xact_lock(hashtext('entrega:' || $1))", [v.sucursal_id]);
      const filas = [];
      for (const it of b.items) {
        const l = lineas.get(it.ventaItemId);
        if (!l) throw new ErrorNegocio("Una línea no pertenece a esa factura");
        const cant = new Decimal(it.cantidad);
        if (cant.lte(0)) throw new ErrorNegocio(`Cantidad inválida en ${l.descripcion}`);
        const pend = new Decimal(l.cantidad).minus(l.devuelta).minus(l.programada);
        if (cant.gt(pend)) throw new ErrorNegocio(`De ${l.descripcion} solo quedan ${pend.toString()} por programar`);
        const series = it.series.map((s) => s.toUpperCase().replace(/\s+/g, "")).filter(Boolean);
        if (series.some((s) => !l.series.includes(s))) throw new ErrorNegocio(`${l.descripcion}: una serie no corresponde a esta factura`);
        if (l.series.length && series.length !== cant.toNumber()) throw new ErrorNegocio(`${l.descripcion}: indique ${cant.toString()} serie(s)`);
        filas.push({ it, l, cant, series });
      }
      const n = (await c.query<{ numero: string }>(
        `INSERT INTO entregas (id, sucursal_id, numero, venta_id, cliente_id, fecha_programada, franja, direccion, referencia, telefono, telefono2, instrucciones, repartidor_id, vehiculo, creada_por,
                               orden)
         VALUES ($1,$2,(SELECT COALESCE(MAX(numero),0)+1 FROM entregas WHERE sucursal_id = $2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 (SELECT COALESCE(MAX(orden),0)+1 FROM entregas WHERE sucursal_id = $2 AND fecha_programada = $5 AND estado <> 'CANCELADA')) RETURNING numero::text`,
        [id, v.sucursal_id, b.ventaId, v.cliente_id, b.fechaProgramada, b.franja, b.direccion, b.referencia ?? null, b.telefono ?? null, b.telefono2 ?? null, b.instrucciones ?? null,
         b.repartidorId ?? null, b.vehiculo ?? null, usuarioDe(req)])).rows[0].numero;
      for (const f of filas) {
        await c.query("INSERT INTO entrega_items (id, entrega_id, venta_item_id, descripcion, cantidad, series) VALUES ($1,$2,$3,$4,$5,$6)", [uuidv7(), id, f.it.ventaItemId, f.l.descripcion, f.cant.toFixed(3), f.series]);
      }
      return n;
    });
    rep.code(201);
    return { id, numero };
  });

  // ---------------------------------------------------------------------------------------------- Consultar
  const SQL_ENTREGA = `
    SELECT e.id, e.numero::text, 'ENT-' || s.codigo || '-' || lpad(e.numero::text, 6, '0') AS codigo, e.estado, to_char(e.fecha_programada,'YYYY-MM-DD') AS fecha, e.franja, e.direccion, e.referencia,
           e.telefono, e.telefono2, e.instrucciones, e.vehiculo, e.orden, e.salida_en AS "salidaEn", e.entregada_en AS "entregadaEn", e.recibe_nombre AS "recibeNombre", e.recibe_cedula AS "recibeCedula",
           e.observaciones, e.motivo_no_entrega AS "motivoNoEntrega", e.repartidor_id AS "repartidorId", r.nombre AS chofer, r.telefono AS "choferTelefono",
           v.id AS "ventaId", v.numero_interno AS factura, COALESCE(d.encf, v.numero_documento) AS documento,
           cl.id AS "clienteId", cl.nombre AS cliente, cl.documento AS "clienteDocumento", s.nombre AS sucursal, s.id AS "sucursalId",
           (SELECT jsonb_agg(jsonb_build_object('id', i.id, 'descripcion', i.descripcion, 'cantidad', i.cantidad, 'series', i.series) ORDER BY i.descripcion) FROM entrega_items i WHERE i.entrega_id = e.id) AS items
      FROM entregas e JOIN sucursales s ON s.id = e.sucursal_id JOIN ventas v ON v.id = e.venta_id LEFT JOIN ecf_documentos d ON d.venta_id = v.id
      LEFT JOIN clientes cl ON cl.id = e.cliente_id LEFT JOIN repartidores r ON r.id = e.repartidor_id`;

  app.get("/central/entregas", async (req) => {
    const f = z.object({ desde: fechaZ.optional(), hasta: fechaZ.optional(), estado: z.enum(["PROGRAMADA", "EN_RUTA", "ENTREGADA", "NO_ENTREGADA", "CANCELADA", "PENDIENTES"]).optional(), repartidorId: uuid.optional() }).parse(req.query);
    const r = await pool.query(
      `${SQL_ENTREGA} WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))
          AND ($3::date IS NULL OR e.fecha_programada >= $3::date) AND ($4::date IS NULL OR e.fecha_programada <= $4::date)
          AND (($5::text IS NULL) OR ($5 = 'PENDIENTES' AND e.estado IN ('PROGRAMADA','EN_RUTA','NO_ENTREGADA')) OR e.estado = $5)
          AND ($6::uuid IS NULL OR e.repartidor_id = $6)
        ORDER BY e.fecha_programada, e.orden, e.numero LIMIT 300`, [empresaDe(req), sucursalesDe(req), f.desde ?? null, f.hasta ?? null, f.estado ?? null, f.repartidorId ?? null]);
    return r.rows;
  });
  const cargar = async (c: Db, id: string, empresaId: string) => {
    const r = await c.query(`${SQL_ENTREGA} WHERE e.id = $1 AND s.empresa_id = $2`, [id, empresaId]);
    if (!r.rowCount) throw new ErrorNegocio("Entrega no encontrada", 404);
    return r.rows[0];
  };
  app.get("/central/entregas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const e = await cargar(pool, id, empresaDe(req));
    const emp = (await pool.query("SELECT COALESCE(nombre_comercial, razon_social) AS nombre, rnc FROM empresas WHERE id = $1", [empresaDe(req)])).rows[0] ?? null;
    return { ...e, empresa: emp };
  });

  // ---------------------------------------------------------------------------------------------- Cambiar
  const EDITABLE = ["PROGRAMADA", "NO_ENTREGADA"];
  app.put("/central/entregas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = Datos.partial().extend({ orden: z.number().int().min(0).max(500).optional() }).parse(req.body);
    const empresaId = empresaDe(req);
    const e = await cargar(pool, id, empresaId);
    if (!EDITABLE.includes(e.estado)) throw new ErrorNegocio("Solo se cambia una entrega programada o no entregada", 409);
    if (b.fechaProgramada && b.fechaProgramada < hoyRD()) throw new ErrorNegocio("La fecha de entrega no puede estar en el pasado");
    if (b.repartidorId && !(await pool.query("SELECT 1 FROM repartidores WHERE id = $1 AND sucursal_id = $2 AND activo", [b.repartidorId, e.sucursalId])).rowCount) throw new ErrorNegocio("Ese chofer no es de la sucursal de la factura");
    await pool.query(
      `UPDATE entregas SET fecha_programada = COALESCE($2::date, fecha_programada), franja = COALESCE($3, franja), direccion = COALESCE($4, direccion), referencia = COALESCE($5, referencia),
              telefono = COALESCE($6, telefono), telefono2 = COALESCE($7, telefono2), instrucciones = COALESCE($8, instrucciones),
              repartidor_id = CASE WHEN $9::boolean THEN $10::uuid ELSE repartidor_id END, vehiculo = COALESCE($11, vehiculo), orden = COALESCE($12, orden),
              estado = CASE WHEN estado = 'NO_ENTREGADA' THEN 'PROGRAMADA' ELSE estado END
        WHERE id = $1`,
      [id, b.fechaProgramada ?? null, b.franja ?? null, b.direccion ?? null, b.referencia ?? null, b.telefono ?? null, b.telefono2 ?? null, b.instrucciones ?? null,
       b.repartidorId !== undefined, b.repartidorId ?? null, b.vehiculo ?? null, b.orden ?? null]);
    return { ok: true };
  });

  const cambiarEstado = async (id: string, empresaId: string, desde: string[], sql: string, params: unknown[], error: string) => {
    const e = await cargar(pool, id, empresaId);
    if (!desde.includes(e.estado)) throw new ErrorNegocio(error, 409);
    await pool.query(sql, [id, ...params]);
    return { ok: true };
  };
  app.post("/central/entregas/:id/salir", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const e = await cargar(pool, id, empresaDe(req));
    if (!e.repartidorId) throw new ErrorNegocio("Asigne el chofer antes de sacar la entrega");
    return cambiarEstado(id, empresaDe(req), ["PROGRAMADA"], "UPDATE entregas SET estado = 'EN_RUTA', salida_en = now() WHERE id = $1", [], "Solo sale una entrega programada");
  });
  app.post("/central/entregas/:id/entregar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ recibeNombre: z.string().trim().min(3, "Escriba quién recibió").max(120), recibeCedula: z.string().trim().max(20).optional(), observaciones: z.string().trim().max(400).optional() }).parse(req.body);
    return cambiarEstado(id, empresaDe(req), ["PROGRAMADA", "EN_RUTA"],
      "UPDATE entregas SET estado = 'ENTREGADA', entregada_en = now(), recibe_nombre = $2, recibe_cedula = $3, observaciones = $4, salida_en = COALESCE(salida_en, now()) WHERE id = $1",
      [b.recibeNombre, b.recibeCedula ?? null, b.observaciones ?? null], "Esa entrega no está pendiente");
  });
  app.post("/central/entregas/:id/no-entregada", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ motivo: z.string().trim().min(5, "Explique por qué no se entregó").max(300) }).parse(req.body);
    return cambiarEstado(id, empresaDe(req), ["EN_RUTA", "PROGRAMADA"], "UPDATE entregas SET estado = 'NO_ENTREGADA', motivo_no_entrega = $2 WHERE id = $1", [b.motivo], "Esa entrega no está pendiente");
  });
  app.post("/central/entregas/:id/cancelar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return cambiarEstado(id, empresaDe(req), ["PROGRAMADA", "NO_ENTREGADA"], "UPDATE entregas SET estado = 'CANCELADA' WHERE id = $1", [], "Solo se cancela una entrega programada o no entregada");
  });
}
