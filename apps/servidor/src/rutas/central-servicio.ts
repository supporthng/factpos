import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";

/**
 * Servicio técnico y garantías: la orden de servicio de un artículo vendido. Al abrirla con la serie se ve si la garantía está vigente
 * y a quién se le vendió. El técnico la mueve por sus estados (revisión, reparación, espera de pieza, lista) hasta entregarla.
 * Si no cubre la garantía, el costo de mano de obra y piezas queda anotado para cobrarlo al cliente.
 * (Pide el permiso «admin.servicio».)
 */
const uuid = z.string().uuid();
const hoyRD = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const ESTADOS = ["RECIBIDO", "EN_REVISION", "EN_REPARACION", "ESPERANDO_PIEZA", "LISTO", "ENTREGADO", "SIN_REPARACION", "CANCELADO"] as const;
const FINALES = ["ENTREGADO", "SIN_REPARACION", "CANCELADO"];
const monto = z.coerce.number().min(0).max(99999999);

export async function rutasCentralServicio(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  const SQL = `
    SELECT t.id, t.numero::text, 'SRV-' || s.codigo || '-' || lpad(t.numero::text, 6, '0') AS codigo, t.estado, t.descripcion, t.serie, t.falla, t.lugar, t.direccion, t.telefono, t.tecnico,
           to_char(t.garantia_hasta,'YYYY-MM-DD') AS "garantiaHasta", t.en_garantia AS "enGarantia", t.diagnostico, t.solucion,
           t.costo_mano_obra::text AS "costoManoObra", t.costo_piezas::text AS "costoPiezas", t.recibida_en AS "recibidaEn", t.lista_en AS "listaEn", t.entregada_en AS "entregadaEn",
           t.venta_id AS "ventaId", v.numero_interno AS factura, t.cliente_id AS "clienteId", cl.nombre AS cliente, cl.documento AS "clienteDocumento", s.nombre AS sucursal, u.nombre AS "creadaPor"
      FROM servicios_tecnicos t JOIN sucursales s ON s.id = t.sucursal_id LEFT JOIN clientes cl ON cl.id = t.cliente_id LEFT JOIN ventas v ON v.id = t.venta_id LEFT JOIN usuarios u ON u.id = t.creada_por`;

  /** Busca el artículo vendido por serie, factura, cliente o cédula: de ahí sale la garantía */
  app.get("/central/servicio/series", async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(40) }).parse(req.query);
    const r = await pool.query(
      `SELECT sp.id, sp.serie, p.nombre AS producto, sp.venta_id AS "ventaId", v.numero_interno AS factura, sp.vendida_en AS "vendidaEn", to_char(sp.garantia_hasta,'YYYY-MM-DD') AS "garantiaHasta",
              (sp.garantia_hasta IS NOT NULL AND sp.garantia_hasta >= $4::date) AS vigente, cl.id AS "clienteId", cl.nombre AS cliente, cl.documento AS "clienteDocumento", cl.telefono, cl.direccion
         FROM series_producto sp JOIN productos p ON p.id = sp.producto_id JOIN ventas v ON v.id = sp.venta_id JOIN sucursales s ON s.id = v.sucursal_id
         LEFT JOIN clientes cl ON cl.id = sp.cliente_id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) AND sp.devuelta_en IS NULL
          AND (sp.serie ILIKE '%' || $3 || '%' OR v.numero_interno::text = $3 OR cl.nombre ILIKE '%' || $3 || '%' OR cl.documento LIKE $3 || '%')
        ORDER BY sp.vendida_en DESC LIMIT 20`, [empresaDe(req), sucursalesDe(req), q.replace(/\s+/g, ""), hoyRD()]);
    return r.rows;
  });

  app.post("/central/servicio", async (req, rep) => {
    const empresaId = empresaDe(req);
    const b = z.object({
      serieId: uuid.optional(), descripcion: z.string().trim().min(2).max(200).optional(), clienteId: uuid.optional(), sucursalId: uuid.optional(),
      falla: z.string().trim().min(3, "Describa la falla").max(500), lugar: z.enum(["TALLER", "DOMICILIO"]).default("TALLER"),
      direccion: z.string().trim().max(300).optional(), telefono: z.string().trim().max(30).optional(), tecnico: z.string().trim().max(80).optional(),
    }).parse(req.body);
    if (!b.serieId && !b.descripcion) throw new ErrorNegocio("Busque el artículo por su serie o escriba qué artículo es");
    if (b.lugar === "DOMICILIO" && !b.direccion) throw new ErrorNegocio("El servicio a domicilio necesita la dirección");
    const id = uuidv7();
    const out = await enTransaccion(async (c) => {
      let sucursalId = b.sucursalId, clienteId = b.clienteId ?? null, ventaId: string | null = null, productoId: string | null = null, serie: string | null = null, garantiaHasta: string | null = null;
      let descripcion = b.descripcion ?? "";
      if (b.serieId) {
        const s = (await c.query<{ sucursal_id: string; producto_id: string; producto: string; serie: string; venta_id: string; cliente_id: string | null; garantia: string | null }>(
          `SELECT v.sucursal_id, sp.producto_id, p.nombre AS producto, sp.serie, sp.venta_id, sp.cliente_id, to_char(sp.garantia_hasta,'YYYY-MM-DD') AS garantia
             FROM series_producto sp JOIN productos p ON p.id = sp.producto_id JOIN ventas v ON v.id = sp.venta_id JOIN sucursales su ON su.id = v.sucursal_id
            WHERE sp.id = $1 AND su.empresa_id = $2`, [b.serieId, empresaId])).rows[0];
        if (!s) throw new ErrorNegocio("Artículo no encontrado", 404);
        sucursalId = s.sucursal_id; clienteId = s.cliente_id ?? clienteId; ventaId = s.venta_id; productoId = s.producto_id; serie = s.serie; garantiaHasta = s.garantia;
        descripcion = s.producto;
      }
      if (!sucursalId) sucursalId = (await c.query<{ id: string }>("SELECT id FROM sucursales WHERE empresa_id = $1 AND activo ORDER BY tipo = 'ALMACEN', codigo LIMIT 1", [empresaId])).rows[0]?.id;
      if (!sucursalId || !(await c.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2", [sucursalId, empresaId])).rowCount) throw new ErrorNegocio("Sucursal no válida");
      if (clienteId && !(await c.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2", [clienteId, empresaId])).rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
      const enGarantia = !!garantiaHasta && garantiaHasta >= hoyRD();
      await c.query("SELECT pg_advisory_xact_lock(hashtext('servicio:' || $1))", [sucursalId]);
      const n = (await c.query<{ numero: string }>(
        `INSERT INTO servicios_tecnicos (id, sucursal_id, numero, cliente_id, venta_id, serie_id, producto_id, descripcion, serie, falla, lugar, direccion, telefono, tecnico, garantia_hasta, en_garantia, creada_por)
         VALUES ($1,$2,(SELECT COALESCE(MAX(numero),0)+1 FROM servicios_tecnicos WHERE sucursal_id = $2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING numero::text`,
        [id, sucursalId, clienteId, ventaId, b.serieId ?? null, productoId, descripcion, serie, b.falla, b.lugar, b.direccion ?? null, b.telefono ?? null, b.tecnico ?? null, garantiaHasta, enGarantia, usuarioDe(req)])).rows[0].numero;
      await c.query("INSERT INTO servicio_historial (id, servicio_id, estado, nota, usuario_id) VALUES ($1,$2,'RECIBIDO',$3,$4)", [uuidv7(), id, b.falla, usuarioDe(req)]);
      return { numero: n, enGarantia };
    });
    rep.code(201);
    return { id, ...out };
  });

  app.get("/central/servicio", async (req) => {
    const q = z.object({ estado: z.enum([...ESTADOS, "ABIERTAS"]).optional(), q: z.string().trim().max(40).optional() }).parse(req.query);
    const p: unknown[] = [empresaDe(req), sucursalesDe(req)];
    const cond = ["s.empresa_id = $1", "($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))"];
    if (q.estado === "ABIERTAS") cond.push(`t.estado NOT IN ('ENTREGADO','SIN_REPARACION','CANCELADO')`);
    else if (q.estado) { p.push(q.estado); cond.push(`t.estado = $${p.length}`); }
    if (q.q) { p.push(q.q); cond.push(`(t.serie ILIKE '%' || $${p.length} || '%' OR t.descripcion ILIKE '%' || $${p.length} || '%' OR cl.nombre ILIKE '%' || $${p.length} || '%' OR t.numero::text = $${p.length})`); }
    return (await pool.query(`${SQL} WHERE ${cond.join(" AND ")} ORDER BY t.recibida_en DESC LIMIT 300`, p)).rows;
  });

  app.get("/central/servicio/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(`${SQL} WHERE t.id = $1 AND s.empresa_id = $2`, [id, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Orden no encontrada", 404);
    const h = await pool.query(`SELECT h.estado, h.nota, h.creado_en AS fecha, u.nombre AS por FROM servicio_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.servicio_id = $1 ORDER BY h.creado_en`, [id]);
    return { ...r.rows[0], historial: h.rows };
  });

  /** Mueve la orden de estado y anota diagnóstico, solución, técnico y costos */
  app.put("/central/servicio/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      estado: z.enum(ESTADOS).optional(), nota: z.string().trim().max(400).optional(), diagnostico: z.string().trim().max(600).optional(), solucion: z.string().trim().max(600).optional(),
      tecnico: z.string().trim().max(80).optional(), costoManoObra: monto.optional(), costoPiezas: monto.optional(),
    }).parse(req.body);
    await enTransaccion(async (c) => {
      const t = (await c.query<{ estado: string }>(
        "SELECT t.estado FROM servicios_tecnicos t JOIN sucursales s ON s.id = t.sucursal_id WHERE t.id = $1 AND s.empresa_id = $2 FOR UPDATE OF t", [id, empresaDe(req)])).rows[0];
      if (!t) throw new ErrorNegocio("Orden no encontrada", 404);
      if (FINALES.includes(t.estado)) throw new ErrorNegocio("Esa orden ya está cerrada", 409);
      if (b.estado === "SIN_REPARACION" && !b.nota) throw new ErrorNegocio("Anote por qué no tiene reparación");
      const set: string[] = [], p: unknown[] = [id];
      const add = (col: string, v: unknown) => { p.push(v); set.push(`${col} = $${p.length}`); };
      if (b.diagnostico !== undefined) add("diagnostico", b.diagnostico || null);
      if (b.solucion !== undefined) add("solucion", b.solucion || null);
      if (b.tecnico !== undefined) add("tecnico", b.tecnico || null);
      if (b.costoManoObra !== undefined) add("costo_mano_obra", new Decimal(b.costoManoObra).toFixed(2));
      if (b.costoPiezas !== undefined) add("costo_piezas", new Decimal(b.costoPiezas).toFixed(2));
      if (b.estado && b.estado !== t.estado) {
        add("estado", b.estado);
        if (b.estado === "LISTO") set.push("lista_en = now()");
        if (b.estado === "ENTREGADO") set.push("entregada_en = now()");
        await c.query("INSERT INTO servicio_historial (id, servicio_id, estado, nota, usuario_id) VALUES ($1,$2,$3,$4,$5)", [uuidv7(), id, b.estado, b.nota ?? null, usuarioDe(req)]);
      }
      if (set.length) await c.query(`UPDATE servicios_tecnicos SET ${set.join(", ")} WHERE id = $1`, p);
    });
    return { ok: true };
  });
}
