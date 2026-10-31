import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { config } from "../config.js";
import { sucursalesDe, tienePermiso, type SesionAdmin } from "../sesion.js";
import { anularVenta, datosTicket } from "./facturas.js";

/**
 * Facturas (administración): buscar cualquier factura, reimprimirla, modificarla o anularla.
 *  - Ver / reimprimir / modificar: permiso «admin.facturas».
 *  - Anular: además el permiso de supervisor «venta.anular». Deja nota de crédito (e-CF) o anulación interna,
 *    regresa la mercancía al inventario y registra la devolución en un turno abierto de la sucursal.
 *  - Modificar: una factura con comprobante fiscal no se edita (la DGII ya la conoce): solo se le puede cambiar la nota.
 *    En una factura interna (sin comprobante) también se puede cambiar el cliente.
 */
const uuid = z.string().uuid();
const TIPOS_FACTURA = ["E31", "E32", "B01", "B02", "B14", "B15", "B16", "SIN"];

export async function rutasCentralFacturas(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);
  const permisos = (req: unknown) => ((req as { sesion?: SesionAdmin }).sesion?.p ?? []) as string[];

  /** La factura debe ser de esta empresa y de una sucursal a la que el usuario tiene acceso. */
  const cargar = async (req: { headers: Record<string, unknown> }, id: string) => {
    const r = await pool.query(
      `SELECT v.id, v.sucursal_id, v.caja_id, v.tipo_documento, v.cliente_id FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id
        WHERE v.id = $1 AND s.empresa_id = $2 AND v.tipo_documento = ANY($3::text[])`,
      [id, empresaDe(req), TIPOS_FACTURA],
    );
    if (!r.rowCount) throw new ErrorNegocio("Factura no encontrada", 404);
    const permitidas = sucursalesDe(req);
    if (permitidas && !permitidas.includes(r.rows[0].sucursal_id)) throw new ErrorNegocio("No tiene acceso a esa sucursal", 403);
    return r.rows[0] as { id: string; sucursal_id: string; caja_id: string; tipo_documento: string; cliente_id: string | null };
  };

  app.get("/central/facturas", async (req) => {
    const f = z.object({
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      sucursalId: uuid.optional(), familia: z.enum(["E", "B", "SIN"]).optional(), estado: z.enum(["EMITIDA", "ANULADA"]).optional(),
      q: z.string().trim().max(60).optional(),
    }).parse(req.query);
    const params: unknown[] = [empresaDe(req), TIPOS_FACTURA];
    const cond = ["s.empresa_id = $1", "v.tipo_documento = ANY($2::text[])"];
    const add = (sql: string, v: unknown) => { params.push(v); cond.push(sql.replace("?", `$${params.length}`)); };
    const permitidas = sucursalesDe(req);
    if (permitidas) add("v.sucursal_id = ANY(?::uuid[])", permitidas);
    if (f.sucursalId) add("v.sucursal_id = ?", f.sucursalId);
    if (f.desde) add("(v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date >= ?::date", f.desde);
    if (f.hasta) add("(v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date <= ?::date", f.hasta);
    if (f.familia === "E") cond.push("v.tipo_documento LIKE 'E%'");
    if (f.familia === "B") cond.push("v.tipo_documento LIKE 'B%'");
    if (f.familia === "SIN") cond.push("v.tipo_documento = 'SIN'");
    if (f.estado === "ANULADA") cond.push("EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = v.id AND n.tipo_documento IN ('E34','ANU'))");
    if (f.estado === "EMITIDA") cond.push("NOT EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = v.id AND n.tipo_documento IN ('E34','ANU'))");
    if (f.q) {
      params.push(`%${f.q}%`);
      const n = params.length;
      cond.push(`(v.numero_documento ILIKE $${n} OR d.encf ILIKE $${n} OR cl.nombre ILIKE $${n} OR cl.documento ILIKE $${n} OR v.numero_interno::text = trim(both '%' from $${n}))`);
    }
    const r = await pool.query(
      `SELECT v.id, v.numero_interno AS numero, v.tipo_documento AS tipo, COALESCE(d.encf, v.numero_documento) AS comprobante,
              v.total, v.creado_en AS fecha, s.nombre AS sucursal, c.nombre AS caja, u.nombre AS cajero, cl.nombre AS cliente,
              EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = v.id AND n.tipo_documento IN ('E34','ANU')) AS anulada
         FROM ventas v
         JOIN sucursales s ON s.id = v.sucursal_id
         LEFT JOIN cajas c ON c.id = v.caja_id
         LEFT JOIN usuarios u ON u.id = v.usuario_id
         LEFT JOIN ecf_documentos d ON d.venta_id = v.id
         LEFT JOIN clientes cl ON cl.id = v.cliente_id
        WHERE ${cond.join(" AND ")}
        ORDER BY v.creado_en DESC LIMIT 300`,
      params,
    );
    return r.rows;
  });

  app.get("/central/facturas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await cargar(req, id);
    const t = await datosTicket(pool, id);
    const x = await pool.query(
      `SELECT s.nombre AS sucursal, c.nombre AS caja, u.nombre AS cajero,
              (SELECT jsonb_build_object('numero', n.numero_interno, 'fecha', n.creado_en, 'motivo', n.motivo, 'por', ua.nombre)
                 FROM ventas n LEFT JOIN usuarios ua ON ua.id = n.usuario_id
                WHERE n.venta_origen_id = v.id AND n.tipo_documento IN ('E34','ANU') LIMIT 1) AS anulacion
         FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id LEFT JOIN cajas c ON c.id = v.caja_id LEFT JOIN usuarios u ON u.id = v.usuario_id
        WHERE v.id = $1`, [id]);
    return { ...t, ...x.rows[0], anulada: !!x.rows[0].anulacion };
  });

  /** Modificar: solo la nota y, en facturas internas, el cliente. Siempre con motivo y en auditoría. */
  app.put("/central/facturas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      motivo: z.string().trim().min(10, "Explique el motivo (mínimo 10 caracteres)").max(200),
      notas: z.string().trim().max(300).nullable().optional(),
      clienteId: uuid.nullable().optional(),
    }).parse(req.body);
    const v = await cargar(req, id);
    if (b.notas === undefined && b.clienteId === undefined) throw new ErrorNegocio("No hay nada que modificar");
    if (b.clienteId !== undefined && v.tipo_documento !== "SIN") {
      throw new ErrorNegocio("El cliente de una factura con comprobante fiscal no se cambia: anule la factura y emita otra.", 409);
    }
    await enTransaccion(async (c) => {
      const ant = (await c.query("SELECT notas, cliente_id FROM ventas WHERE id = $1 FOR UPDATE", [id])).rows[0];
      const ya = await c.query("SELECT 1 FROM ventas WHERE venta_origen_id = $1 AND tipo_documento IN ('E34','ANU')", [id]);
      if (ya.rowCount) throw new ErrorNegocio("La factura está anulada y no se puede modificar", 409);
      if (b.clienteId) {
        const ok = await c.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2", [b.clienteId, empresaDe(req)]);
        if (!ok.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
      }
      await c.query(
        "UPDATE ventas SET notas = CASE WHEN $2::boolean THEN $3 ELSE notas END, cliente_id = CASE WHEN $4::boolean THEN $5::uuid ELSE cliente_id END WHERE id = $1",
        [id, b.notas !== undefined, b.notas ?? null, b.clienteId !== undefined, b.clienteId ?? null],
      );
      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
         VALUES ($1,$2,$3,$3,'venta.modificar','venta',$4,$5)`,
        [uuidv7(), v.sucursal_id, usuarioDe(req), id, JSON.stringify({ motivo: b.motivo, antes: ant, despues: { notas: b.notas, clienteId: b.clienteId } })],
      );
    });
    return datosTicket(pool, id);
  });

  /** Anular desde la administración de la sucursal (donde están las cajas y el inventario). */
  app.post("/central/facturas/:id/anular", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ motivo: z.string().trim().min(10, "Explique el motivo (mínimo 10 caracteres)").max(200) }).parse(req.body);
    if (!tienePermiso(permisos(req), "venta.anular")) throw new ErrorNegocio("Anular una factura requiere permiso de supervisor", 403);
    if (config.modo !== "sucursal") {
      throw new ErrorNegocio("La anulación se hace en la administración de la sucursal (su servidor): allí están la caja y el inventario de esa factura.", 409);
    }
    const v = await cargar(req, id);
    const usuarioId = usuarioDe(req);
    return enTransaccion(async (c) => {
      // La devolución del dinero se registra en un turno abierto: el de la caja de la factura o, si no, el de otra caja de la sucursal
      const t = await c.query<{ caja_id: string }>(
        `SELECT caja_id FROM turnos WHERE sucursal_id = $1 AND estado = 'ABIERTO' ORDER BY (caja_id = $2) DESC, abierto_en LIMIT 1`,
        [v.sucursal_id, v.caja_id],
      );
      if (!t.rowCount) throw new ErrorNegocio("No hay un turno abierto en la sucursal para registrar la devolución: abra una caja e intente de nuevo.", 409);
      const r = await anularVenta(c, { cajaId: t.rows[0].caja_id, ventaId: id, usuarioId, supervisorId: usuarioId, motivo: b.motivo, corregir: false });
      return r;
    });
  });
}
