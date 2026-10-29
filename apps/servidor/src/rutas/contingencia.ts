import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";
import { registrarVenta } from "./ventas.js";
import { avisarPendientes, registrarIncidente } from "../incidentes.js";
import { config } from "../config.js";
import type { SesionCaja } from "../sesion.js";

/**
 * Contingencia de la caja: si el servidor de la sucursal se cae, la caja sigue
 * vendiendo (factura de consumo E32, al contado) y guarda las ventas. Para eso:
 *
 *  1. Mientras hay servidor, cada caja mantiene apartados unos e-NCF E32 (RESERVA).
 *  2. Sin servidor, cada venta usa uno de esos números y se imprime como
 *     "pendiente de firma" (sin código de seguridad ni QR).
 *  3. Al volver el servidor, la caja manda sus ventas a /ventas/contingencia:
 *     se registran con su hora real y su e-NCF, se firman y se envían a la DGII.
 *  4. La caja informa el corte (/incidentes) y la central avisa al servicio técnico.
 */
const uuid = z.string().uuid();
const RESERVA = Number(process.env.CONTINGENCIA_RESERVA ?? 30);
const sesionCaja = (req: FastifyRequest) => (req as FastifyRequest & { sesionCaja?: SesionCaja }).sesionCaja;

/** e-NCF apartados de una caja que todavía no se han usado. */
async function disponibles(c: { query: typeof pool.query }, cajaId: string) {
  const r = await c.query<{ encf: string; rango_id: string; vence_en: string }>(
    `SELECT r.tipo_ecf || lpad(n::text, 10, '0') AS encf, r.rango_id, g.vence_en
       FROM ecf_reservas r JOIN ecf_rangos g ON g.id = r.rango_id
       CROSS JOIN LATERAL generate_series(r.desde, r.hasta) AS n
      WHERE r.caja_id = $1 AND g.vence_en >= CURRENT_DATE
        AND NOT EXISTS (SELECT 1 FROM ecf_documentos d WHERE d.encf = r.tipo_ecf || lpad(n::text, 10, '0'))
      ORDER BY n`,
    [cajaId],
  );
  return r.rows;
}

export async function rutasContingencia(app: FastifyInstance) {
  /**
   * La caja pide (o repone) sus e-NCF de reserva. Devuelve la lista completa de
   * números disponibles: la caja la guarda y los usa solo si se cae el servidor.
   */
  app.post("/cajas/:cajaId/contingencia/reserva", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    return enTransaccion(async (c) => {
      await c.query("SELECT 1 FROM cajas WHERE id = $1 FOR UPDATE", [cajaId]);
      let lista = await disponibles(c, cajaId);
      const faltan = RESERVA - lista.length;
      if (faltan >= RESERVA / 3) {
        // Se aparta un bloque del rango E32 de la sucursal (mismo bloqueo que una venta normal)
        const g = await c.query<{ id: string; siguiente: string; hasta: string }>(
          `SELECT id, siguiente, hasta FROM ecf_rangos
            WHERE sucursal_id = $1 AND tipo_ecf = 'E32' AND activo AND siguiente <= hasta AND vence_en >= CURRENT_DATE
            ORDER BY desde LIMIT 1 FOR UPDATE`,
          [ctx.sucursalId],
        );
        if (g.rowCount) {
          const desde = Number(g.rows[0].siguiente);
          const hasta = Math.min(desde + faltan - 1, Number(g.rows[0].hasta));
          await c.query("UPDATE ecf_rangos SET siguiente = $2 WHERE id = $1", [g.rows[0].id, hasta + 1]);
          await c.query(
            "INSERT INTO ecf_reservas (id, caja_id, rango_id, tipo_ecf, desde, hasta) VALUES ($1,$2,$3,'E32',$4,$5)",
            [uuidv7(), cajaId, g.rows[0].id, desde, hasta],
          );
          lista = await disponibles(c, cajaId);
        }
      }
      return { numeros: lista.map((x) => ({ encf: x.encf, rangoId: x.rango_id })), turno: (await c.query("SELECT id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId])).rows[0]?.id ?? null };
    });
  });

  /** Ventas que la caja hizo sin servidor. Idempotente: reenviar la misma venta no la duplica. */
  app.post("/cajas/:cajaId/ventas/contingencia", async (req, rep) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z.object({
      ventaId: uuid,
      usuarioId: uuid,
      turnoId: uuid,
      creadoEn: z.string().datetime({ offset: true }),
      encf: z.string().regex(/^E32\d{10}$/),
      items: z.array(z.object({ presentacionId: uuid, cantidad: z.string().regex(/^\d+(\.\d{1,3})?$/), precioVariable: z.string().regex(/^\d+(\.\d{1,2})?$/).optional() })).min(1).max(500),
      pagos: z.array(z.object({
        formaPago: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]),
        monto: z.string().regex(/^\d+(\.\d{1,2})?$/), recibido: z.string().optional(), referencia: z.string().max(60).optional(),
      })).min(1),
      clienteId: uuid.optional(),
    }).parse(req.body);
    // Quien vendió es quien entró a la caja en ese momento (va en la venta guardada)
    const s = sesionCaja(req);
    const usuarioVenta = (req.body as { usuarioOriginal?: string }).usuarioOriginal ?? s?.u ?? b.usuarioId;

    const r = await enTransaccion(async (c) => {
      const ya = await c.query("SELECT numero_interno AS numero FROM ventas WHERE id = $1", [b.ventaId]);
      if (ya.rowCount) return { id: b.ventaId, numero: ya.rows[0].numero, duplicada: true };
      const reserva = await c.query<{ rango_id: string }>(
        `SELECT r.rango_id FROM ecf_reservas r
          WHERE r.caja_id = $1 AND r.tipo_ecf = 'E32' AND substr($2, 4)::bigint BETWEEN r.desde AND r.hasta`,
        [cajaId, b.encf],
      );
      if (!reserva.rowCount) throw new ErrorNegocio(`El e-NCF ${b.encf} no está apartado para esta caja`, 409);
      const usado = await c.query("SELECT 1 FROM ecf_documentos WHERE encf = $1", [b.encf]);
      if (usado.rowCount) throw new ErrorNegocio(`El e-NCF ${b.encf} ya fue usado`, 409);
      const v = await registrarVenta(c, cajaId, {
        ventaId: b.ventaId, usuarioId: usuarioVenta, clienteId: b.clienteId, tipoDocumento: "E32",
        items: b.items, pagos: b.pagos,
      }, { contingencia: { creadoEn: b.creadoEn, encf: b.encf, rangoId: reserva.rows[0].rango_id, turnoId: b.turnoId } });
      return { id: v.id, numero: v.numero, encf: b.encf, total: v.total };
    });
    rep.code(201);
    return r;
  });

  /** La caja informa que trabajó sin servidor (desde, hasta y cuántas ventas hizo). */
  app.post("/cajas/:cajaId/incidentes", async (req, rep) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z.object({
      id: uuid,
      desde: z.string().datetime({ offset: true }),
      hasta: z.string().datetime({ offset: true }),
      ventas: z.number().int().min(0),
      monto: z.string().optional(),
      equipo: z.string().max(120).optional(),
    }).parse(req.body);
    const ctx = await contextoCaja(cajaId);
    const caja = (await pool.query<{ nombre: string; sucursal: string }>(
      "SELECT ca.nombre, s.nombre AS sucursal FROM cajas ca JOIN sucursales s ON s.id = ca.sucursal_id WHERE ca.id = $1", [cajaId])).rows[0];
    await registrarIncidente(pool, {
      id: b.id, empresa_id: ctx.empresaId, sucursal_id: ctx.sucursalId, caja_id: cajaId, tipo: "CAJA_SIN_SERVIDOR",
      gravedad: "ALTA", titulo: `${caja.nombre} de ${caja.sucursal} trabajó sin servidor`,
      detalle: { ventas: b.ventas, monto: b.monto ?? null, equipo: b.equipo ?? null }, desde: b.desde, hasta: b.hasta,
    });
    // En la central (o una sola PC) se avisa ya; en una sucursal, el aviso sale de la central al subir
    if (config.modo === "central") await avisarPendientes((m) => req.log.warn(m)).catch(() => 0);
    rep.code(201);
    return { ok: true };
  });
}
