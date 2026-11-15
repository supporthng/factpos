import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";
import { autorizacionDirecta } from "../autorizacion.js";
import { exigirLicenciaParaVender } from "../licencia/cliente.js";
import { cotizar, resumen, registrarVenta, exigirSinComprobante } from "./ventas.js";

/**
 * Ventas por cobrar (lado de la caja): las que la administración envió a esta caja.
 * El cajero revisa la venta, elige comprobante y forma de pago y cobra. El precio libre y los descuentos
 * ya fueron autorizados al enviarla (permiso + motivo); aquí se recalcula todo con el motor de la venta.
 */
const uuid = z.string().uuid();
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
interface Fila { id: string; numero: string; items: { presentacionId: string; cantidad: string; descuentoManual?: string; precioVariable?: string; precioLibre?: string; series?: string[] }[];
  clienteId: string | null; notas: string | null; motivoDescuento: string | null; creadaPor: string | null; total: string; }

export async function rutasPorCobrar(app: FastifyInstance) {
  const usuarioDe = (req: unknown) => ((req as { sesionCaja?: { u?: string } }).sesionCaja?.u) ?? null;
  const cargar = async (cajaId: string, id: string): Promise<Fila> => {
    const r = await pool.query(
      `SELECT id, numero::text, items, cliente_id AS "clienteId", notas, motivo_descuento AS "motivoDescuento", creada_por AS "creadaPor", total::text
         FROM ventas_por_cobrar WHERE id = $1 AND caja_id = $2 AND estado = 'PENDIENTE'`, [id, cajaId]);
    if (!r.rowCount) throw new ErrorNegocio("Esa venta ya no está pendiente en esta caja", 404);
    return r.rows[0] as Fila;
  };

  app.get("/cajas/:cajaId/por-cobrar", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const r = await pool.query(
      `SELECT v.id, v.numero::text, v.total::text, v.notas, v.creada_en AS "creadaEn", cl.nombre AS cliente, u.nombre AS vendedor, jsonb_array_length(v.items) AS lineas
         FROM ventas_por_cobrar v LEFT JOIN clientes cl ON cl.id = v.cliente_id LEFT JOIN usuarios u ON u.id = v.creada_por
        WHERE v.caja_id = $1 AND v.estado = 'PENDIENTE' ORDER BY v.creada_en`, [cajaId]);
    return r.rows;
  });

  app.get("/cajas/:cajaId/por-cobrar/:id", async (req) => {
    const { cajaId, id } = z.object({ cajaId: uuid, id: uuid }).parse(req.params);
    const f = await cargar(cajaId, id);
    const ctx = await contextoCaja(cajaId);
    const q = await cotizar(pool, ctx, { clienteId: f.clienteId ?? undefined, items: f.items }, false);
    const cl = f.clienteId ? (await pool.query("SELECT id, nombre, tipo_documento AS \"tipoDocumento\", documento FROM clientes WHERE id = $1", [f.clienteId])).rows[0] : null;
    return { id: f.id, numero: f.numero, notas: f.notas, cliente: cl ?? null, ...resumen(q) };
  });

  app.post("/cajas/:cajaId/por-cobrar/:id/cobrar", async (req, rep) => {
    const { cajaId, id } = z.object({ cajaId: uuid, id: uuid }).parse(req.params);
    const b = z.object({
      tipoDocumento: z.enum(["E32", "E31", "B01", "B02", "B14", "B15", "B16", "SIN"]),
      pagos: z.array(z.object({
        formaPago: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO", "OTRO"]), monto, recibido: monto.optional(), referencia: z.string().max(60).optional(),
      })).min(1, "Falta la forma de pago"),
    }).parse(req.body);
    const usuarioId = usuarioDe(req);
    if (!usuarioId) throw new ErrorNegocio("Sesión de caja no válida", 401);
    await exigirLicenciaParaVender();
    if (b.tipoDocumento === "SIN") await exigirSinComprobante(cajaId);
    const venta = await enTransaccion(async (c) => {
      const r = await c.query(
        `SELECT id, numero::text, items, cliente_id AS "clienteId", notas, motivo_descuento AS "motivoDescuento", creada_por AS "creadaPor"
           FROM ventas_por_cobrar WHERE id = $1 AND caja_id = $2 AND estado = 'PENDIENTE' FOR UPDATE`, [id, cajaId]);
      if (!r.rowCount) throw new ErrorNegocio("Esa venta ya fue cobrada o anulada", 409);
      const f = r.rows[0] as Fila;
      const hayDescuento = f.items.some((i) => Number(i.descuentoManual ?? 0) > 0);
      let autorizacion: string | undefined;
      if (hayDescuento && f.creadaPor) {
        const u = (await c.query<{ nombre: string }>("SELECT nombre FROM usuarios WHERE id = $1", [f.creadaPor])).rows[0];
        autorizacion = autorizacionDirecta(f.creadaPor, u?.nombre ?? "Administración", "venta.descuento", cajaId);
      }
      const v = await registrarVenta(c, cajaId, {
        usuarioId, clienteId: f.clienteId ?? undefined, tipoDocumento: b.tipoDocumento, notas: `Venta por cobrar #${f.numero}${f.notas ? ` · ${f.notas}` : ""}`.slice(0, 300),
        items: f.items, pagos: b.pagos, ...(hayDescuento ? { autorizacionDescuento: autorizacion, motivoDescuento: f.motivoDescuento ?? undefined } : {}),
      }, { exigirSeries: true });
      await c.query("UPDATE ventas_por_cobrar SET estado = 'COBRADA', cerrada_en = now(), cerrada_por = $2, venta_id = $3 WHERE id = $1", [id, usuarioId, (v as { id: string }).id]);
      return v;
    });
    rep.code(201);
    return venta;
  });

  /** El cajero la devuelve (no se cobra): queda anulada y no mueve inventario */
  app.post("/cajas/:cajaId/por-cobrar/:id/anular", async (req) => {
    const { cajaId, id } = z.object({ cajaId: uuid, id: uuid }).parse(req.params);
    const r = await pool.query("UPDATE ventas_por_cobrar SET estado = 'ANULADA', cerrada_en = now(), cerrada_por = $3 WHERE id = $1 AND caja_id = $2 AND estado = 'PENDIENTE'", [id, cajaId, usuarioDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Esa venta ya no está pendiente", 404);
    return { ok: true };
  });
}
