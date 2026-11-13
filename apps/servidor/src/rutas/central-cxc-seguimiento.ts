import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { enviarCorreo, correoListo } from "../correo/transporte.js";
import { marcaDe } from "../correo/envios.js";
import { correoEstadoCuenta } from "../correo/plantillas.js";

/**
 * Seguimiento de cobros: promesas de pago y envío del estado de cuenta por correo.
 * (El permiso lo da el prefijo /central/cxc: admin.cxc.)
 */
const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");

export async function rutasCentralCxcSeguimiento(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => {
    const u = uuid.safeParse(req.headers["x-usuario-id"]);
    return u.success ? u.data : null;
  };
  const clienteDe = async (empresaId: string, clienteId: string) => {
    const r = await pool.query("SELECT id, nombre, correo FROM clientes WHERE id = $1 AND empresa_id = $2", [clienteId, empresaId]);
    if (!r.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
    return r.rows[0] as { id: string; nombre: string; correo: string | null };
  };

  /** Promesas de pago de un cliente (las más recientes primero). */
  app.get("/central/cxc/:clienteId/promesas", async (req) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const empresaId = empresaDe(req);
    await clienteDe(empresaId, clienteId);
    const r = await pool.query(
      `SELECT id, monto, fecha_promesa::text AS fecha, nota, estado, cobrado, creado_en AS "creadoEn"
         FROM rpt_cxc_promesas WHERE cliente_id = $1 AND empresa_id = $2 ORDER BY fecha_promesa DESC, creado_en DESC LIMIT 30`,
      [clienteId, empresaId],
    );
    return r.rows;
  });

  /** Anota una promesa de pago. */
  app.post("/central/cxc/:clienteId/promesas", async (req, rep) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const b = z.object({ monto, fecha, nota: z.string().trim().max(200).optional() }).parse(req.body);
    const empresaId = empresaDe(req);
    await clienteDe(empresaId, clienteId);
    if (Number(b.monto) <= 0) throw new ErrorNegocio("El monto debe ser mayor que cero");
    const id = uuidv7();
    await pool.query(
      "INSERT INTO cxc_promesas (id, empresa_id, cliente_id, monto, fecha_promesa, nota, usuario_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, empresaId, clienteId, b.monto, b.fecha, b.nota || null, usuarioDe(req)],
    );
    rep.code(201);
    return { id };
  });

  /** Cancela una promesa (ya no cuenta como pendiente ni como incumplida). */
  app.delete("/central/cxc-promesas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query("UPDATE cxc_promesas SET cancelada = TRUE WHERE id = $1 AND empresa_id = $2", [id, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("No existe esa promesa", 404);
    return { ok: true };
  });

  /** Promesas pendientes y vencidas de todos los clientes (lo que hay que seguir). */
  app.get("/central/cxc-promesas", async (req) => {
    const r = await pool.query(
      `SELECT id, cliente_id AS "clienteId", cliente, telefono, monto, fecha_promesa::text AS fecha, nota, estado, cobrado
         FROM rpt_cxc_promesas WHERE empresa_id = $1 AND estado IN ('PENDIENTE','VENCIDA')
        ORDER BY (estado = 'VENCIDA') DESC, fecha_promesa LIMIT 200`,
      [empresaDe(req)],
    );
    return r.rows;
  });

  /** Envía por correo el estado de cuenta (lo que debe y sus facturas pendientes). */
  app.post("/central/cxc/:clienteId/enviar-estado", async (req) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const b = z.object({
      para: z.string().trim().toLowerCase().email("Correo inválido").max(120).optional(),
      mensaje: z.string().trim().max(1000).optional(),
    }).parse(req.body);
    const empresaId = empresaDe(req);
    const cl = await clienteDe(empresaId, clienteId);
    const para = b.para ?? cl.correo;
    if (!para) throw new ErrorNegocio("Escriba el correo del cliente");
    if (!(await correoListo(empresaId))) throw new ErrorNegocio("Falta configurar el correo: Negocio › Correo y envíos.");

    const t = (await pool.query(
      `SELECT saldo, al_dia, vencido_30 + vencido_60 + vencido_mas AS vencido FROM rpt_cxc_antiguedad WHERE cliente_id = $1`, [clienteId],
    )).rows[0];
    if (!t || Number(t.saldo) <= 0) throw new ErrorNegocio("Este cliente no tiene saldo pendiente");
    const fac = (await pool.query(
      `SELECT COALESCE(d.encf, v.numero_documento, v.numero_interno::text) AS documento, f.creado_en AS fecha,
              (f.creado_en + make_interval(days => cl.dias_credito)) AS vence, f.pendiente
         FROM rpt_cxc_facturas f
         JOIN clientes cl ON cl.id = f.cliente_id
         JOIN ventas v ON v.id = f.venta_id
         LEFT JOIN ecf_documentos d ON d.venta_id = f.venta_id
        WHERE f.cliente_id = $1 AND f.pendiente > 0 ORDER BY f.creado_en, f.venta_id LIMIT 60`, [clienteId],
    )).rows;

    const marca = await marcaDe(empresaId);
    const mail = correoEstadoCuenta(marca, {
      cliente: cl.nombre, saldo: Number(t.saldo), alDia: Number(t.al_dia), vencido: Number(t.vencido),
      facturas: fac.map((f) => ({ documento: String(f.documento), fecha: new Date(f.fecha).toISOString(), vence: new Date(f.vence).toISOString(), pendiente: Number(f.pendiente) })),
    }, b.mensaje);
    try {
      await enviarCorreo(empresaId, { para: [para], asunto: mail.asunto, html: mail.html, texto: mail.texto });
    } catch (e) { throw new ErrorNegocio(`No se pudo enviar: ${(e as Error).message}`, 502); }
    if (!cl.correo) await pool.query("UPDATE clientes SET correo = $2 WHERE id = $1 AND correo IS NULL", [clienteId, para]);
    return { ok: true, para };
  });
}
