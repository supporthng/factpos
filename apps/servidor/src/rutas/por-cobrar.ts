import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";
import { autorizacionDirecta } from "../autorizacion.js";
import { exigirLicenciaParaVender } from "../licencia/cliente.js";
import { Decimal } from "decimal.js";
import { cotizar, resumen, registrarVenta, exigirSinComprobante } from "./ventas.js";
import { crearPlanDeVenta, emitirRecibo } from "./venta-plazos.js";
import { devengarComision } from "./comision.js";

/**
 * Ventas por cobrar (lado de la caja): las que la administración envió a esta caja.
 * El cajero revisa la venta, elige comprobante y forma de pago y cobra. El precio libre y los descuentos
 * ya fueron autorizados al enviarla (permiso + motivo); aquí se recalcula todo con el motor de la venta.
 */
const uuid = z.string().uuid();
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
interface Fila { id: string; numero: string; items: { presentacionId: string; cantidad: string; descuentoManual?: string; precioVariable?: string; precioLibre?: string; series?: string[] }[];
  clienteId: string | null; notas: string | null; motivoDescuento: string | null; creadaPor: string | null; total: string;
  planId: string | null; inicial: string; primeraCuota: string | null; garante: { nombre: string | null; documento: string | null; telefono: string | null };
  excepciones: string[]; excepcionMotivo: string | null; excepcionPor: string | null;
  /** Farmacias: la receta que se pidió en el mostrador al enviar la venta */
  receta: { paciente: string; medico: string; exequatur?: string; fechaReceta?: string } | null; }
const COLS = `id, numero::text, items, cliente_id AS "clienteId", notas, motivo_descuento AS "motivoDescuento", creada_por AS "creadaPor", total::text,
  plan_id AS "planId", inicial::text, to_char(primera_cuota,'YYYY-MM-DD') AS "primeraCuota",
  jsonb_build_object('nombre', garante_nombre, 'documento', garante_documento, 'telefono', garante_telefono) AS garante,
  excepciones, excepcion_motivo AS "excepcionMotivo", excepcion_por AS "excepcionPor", receta`;

export async function rutasPorCobrar(app: FastifyInstance) {
  const usuarioDe = (req: unknown) => ((req as { sesionCaja?: { u?: string } }).sesionCaja?.u) ?? null;
  const cargar = async (cajaId: string, id: string): Promise<Fila> => {
    const r = await pool.query(
      `SELECT ${COLS} FROM ventas_por_cobrar WHERE id = $1 AND caja_id = $2 AND estado = 'PENDIENTE'`, [id, cajaId]);
    if (!r.rowCount) throw new ErrorNegocio("Esa venta ya no está pendiente en esta caja", 404);
    return r.rows[0] as Fila;
  };

  app.get("/cajas/:cajaId/por-cobrar", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const r = await pool.query(
      `SELECT v.id, v.numero::text, v.total::text, v.notas, v.creada_en AS "creadaEn", cl.nombre AS cliente, u.nombre AS vendedor, jsonb_array_length(v.items) AS lineas,
              v.inicial::text AS inicial, (v.plan_id IS NOT NULL) AS "aPlazos"
         FROM ventas_por_cobrar v LEFT JOIN clientes cl ON cl.id = v.cliente_id LEFT JOIN usuarios u ON u.id = v.creada_por
        WHERE v.caja_id = $1 AND v.estado = 'PENDIENTE' ORDER BY v.creada_en`, [cajaId]);
    return r.rows;
  });

  app.get("/cajas/:cajaId/por-cobrar/:id", async (req) => {
    const { cajaId, id } = z.object({ cajaId: uuid, id: uuid }).parse(req.params);
    const f = await cargar(cajaId, id);
    const ctx = await contextoCaja(cajaId);
    const q = await cotizar(pool, ctx, { clienteId: f.clienteId ?? undefined, items: f.items, excluirApartado: f.id }, false);
    const cl = f.clienteId ? (await pool.query("SELECT id, nombre, tipo_documento AS \"tipoDocumento\", documento FROM clientes WHERE id = $1", [f.clienteId])).rows[0] : null;
    let plazos = null;
    if (f.planId) {
      const r = resumen(q);
      const p = (await pool.query<{ nombre: string; cuotas: number; frecuencia: string; interes_pct: string }>("SELECT nombre, cuotas, frecuencia, interes_pct::text FROM cxc_planes_catalogo WHERE id = $1", [f.planId])).rows[0];
      const financiado = new Decimal(r.total).minus(f.inicial);
      const interes = financiado.mul(p?.interes_pct ?? 0).div(100).toDecimalPlaces(2);
      plazos = { plan: p?.nombre ?? "", cuotas: p?.cuotas ?? 0, frecuencia: p?.frecuencia ?? "", interesPct: p?.interes_pct ?? "0", inicial: f.inicial, financiado: financiado.toFixed(2), interes: interes.toFixed(2),
        totalAPagar: financiado.plus(interes).toFixed(2), garante: f.garante.nombre ? f.garante : null, excepciones: f.excepciones, excepcionMotivo: f.excepcionMotivo };
    }
    return { id: f.id, numero: f.numero, notas: f.notas, cliente: cl ?? null, ...resumen(q), plazos };
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
      const r = await c.query(`SELECT ${COLS} FROM ventas_por_cobrar WHERE id = $1 AND caja_id = $2 AND estado = 'PENDIENTE' FOR UPDATE`, [id, cajaId]);
      if (!r.rowCount) throw new ErrorNegocio("Esa venta ya fue cobrada o anulada", 409);
      const f = r.rows[0] as Fila;
      const ctx = await contextoCaja(cajaId, c);
      // Venta a plazos: la caja cobra solo la inicial; el resto lo pone el servidor a crédito
      let pagos = b.pagos, autorizacionCredito: string | undefined, saldoAntes = new Decimal(0), cobradoInicial = new Decimal(0);
      if (f.planId) {
        if (!f.clienteId) throw new ErrorNegocio("La venta a plazos requiere un cliente");
        if (b.pagos.some((p) => p.formaPago === "CREDITO")) throw new ErrorNegocio("En una venta a plazos la caja cobra solo la inicial; el resto queda a crédito solo");
        cobradoInicial = b.pagos.reduce((a, p) => a.plus(p.monto), new Decimal(0));
        if (!cobradoInicial.eq(f.inicial)) throw new ErrorNegocio(`La inicial acordada es RD$ ${new Decimal(f.inicial).toFixed(2)}: la caja debe cobrar exactamente ese monto`);
        const total = new Decimal(resumen(await cotizar(c, ctx, { clienteId: f.clienteId, items: f.items, excluirApartado: f.id }, false)).total);
        if (total.lte(f.inicial)) throw new ErrorNegocio("El total cambió y la inicial ya cubre todo: pida al vendedor que rehaga la venta");
        pagos = [...b.pagos, { formaPago: "CREDITO" as const, monto: total.minus(f.inicial).toFixed(2) }];
        const aprobador = f.excepcionPor ?? f.creadaPor;
        const nombreAp = aprobador ? (await c.query<{ nombre: string }>("SELECT nombre FROM usuarios WHERE id = $1", [aprobador])).rows[0]?.nombre : null;
        autorizacionCredito = autorizacionDirecta(aprobador ?? usuarioId, nombreAp ?? "Administración", "venta.credito", cajaId);
        saldoAntes = new Decimal((await c.query("SELECT COALESCE(SUM(monto),0) AS s FROM cxc_movimientos WHERE cliente_id = $1", [f.clienteId])).rows[0].s);
      }
      const hayDescuento = f.items.some((i) => Number(i.descuentoManual ?? 0) > 0);
      let autorizacion: string | undefined;
      if (hayDescuento && f.creadaPor) {
        const u = (await c.query<{ nombre: string }>("SELECT nombre FROM usuarios WHERE id = $1", [f.creadaPor])).rows[0];
        autorizacion = autorizacionDirecta(f.creadaPor, u?.nombre ?? "Administración", "venta.descuento", cajaId);
      }
      const v = await registrarVenta(c, cajaId, {
        usuarioId, clienteId: f.clienteId ?? undefined, tipoDocumento: b.tipoDocumento, notas: `Venta por cobrar #${f.numero}${f.notas ? ` · ${f.notas}` : ""}`.slice(0, 300),
        items: f.items, excluirApartado: f.id, pagos, ...(f.receta ? { receta: f.receta } : {}), ...(autorizacionCredito ? { autorizacionCredito } : {}), ...(hayDescuento ? { autorizacionDescuento: autorizacion, motivoDescuento: f.motivoDescuento ?? undefined } : {}),
      }, { exigirSeries: true, omitirLimiteCredito: !!f.excepcionPor });
      const ventaId = (v as { id: string }).id;
      await c.query("UPDATE ventas_por_cobrar SET estado = 'COBRADA', cerrada_en = now(), cerrada_por = $2, venta_id = $3 WHERE id = $1", [id, usuarioId, ventaId]);
      if (!f.planId) {
        // Venta sin plan: comisión sobre lo que entró de verdad (el crédito simple se comisiona al cobrarlo)
        await devengarComision(c, { ventaId, cobrado: pagos.filter((p) => p.formaPago !== "CREDITO").reduce((a, p) => a.plus(p.monto), new Decimal(0)), concepto: "CONTADO" });
        return v;
      }
      const sucursalId = ctx.sucursalId;
      const plan = await crearPlanDeVenta(c, {
        empresaId: ctx.empresaId, sucursalId, clienteId: f.clienteId!, ventaId, usuarioId, planId: f.planId, financiado: new Decimal(pagos[pagos.length - 1].monto).toFixed(2), inicial: f.inicial,
        primeraCuota: f.primeraCuota, garante: f.garante.nombre ? { nombre: f.garante.nombre, documento: f.garante.documento ?? "", telefono: f.garante.telefono } : null,
        excepciones: f.excepciones, excepcionMotivo: f.excepcionMotivo, excepcionPor: f.excepcionPor, notas: `Venta por cobrar #${f.numero}`,
      });
      const turno = (await c.query<{ id: string }>("SELECT id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId])).rows[0];
      const saldoDespues = new Decimal((await c.query("SELECT COALESCE(SUM(monto),0) AS s FROM cxc_movimientos WHERE cliente_id = $1", [f.clienteId])).rows[0].s);
      const formas = [...new Set(b.pagos.map((p) => p.formaPago))];
      const cliente = (await c.query<{ nombre: string; documento: string | null }>("SELECT nombre, documento FROM clientes WHERE id = $1", [f.clienteId])).rows[0];
      const rec = await emitirRecibo(c, {
        sucursalId, tipo: "INICIAL", clienteId: f.clienteId!, ventaId, monto: cobradoInicial, formaPago: formas.length === 1 ? formas[0] : "MIXTO", referencia: b.pagos.find((p) => p.referencia)?.referencia ?? null,
        saldoAnterior: saldoAntes, saldoNuevo: saldoDespues, usuarioId, turnoId: turno?.id ?? null,
        aplicaciones: [{ ventaId, factura: (v as { numero?: number }).numero ?? null, aplicado: cobradoInicial.toFixed(2), concepto: "Inicial" }],
      });
      return { ...v, plazos: { plan: plan.nombre, cuotas: plan.cuotas.length, frecuencia: plan.frecuencia, interesPct: plan.interesPct, financiado: plan.capital, interes: plan.interes, totalAPagar: plan.total, inicial: f.inicial,
        calendario: plan.cuotas, garante: f.garante.nombre ? f.garante : null, cliente }, recibo: rec };
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
