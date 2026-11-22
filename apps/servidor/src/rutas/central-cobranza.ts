import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";
import { estadoCuotas } from "./credito-plan.js";

/**
 * Cobranza en ruta: a quién cobrar hoy (cuotas vencidas y las que vencen en pocos días), qué cobrador atiende cada plan,
 * y el registro de cada gestión (llamada, visita, mensaje) con su promesa de pago.
 * El dinero que se recibe se registra como siempre, en Cuentas por cobrar (abono con recibo numerado).
 * (Pide el permiso «admin.cobranza».)
 */
const uuid = z.string().uuid();
const fechaZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const hoyRD = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);

export async function rutasCentralCobranza(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  /** Usuarios que pueden ser cobradores (tienen el permiso de cobranza) */
  app.get("/central/cobranza/cobradores", async (req) => {
    const r = await pool.query(
      `SELECT u.id, u.nombre FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.empresa_id = $1 AND u.activo AND ('admin.cobranza' = ANY(r.permisos) OR '*' = ANY(r.permisos)) ORDER BY u.nombre`, [empresaDe(req)]);
    return r.rows;
  });

  /** La ruta: planes con cuotas vencidas o por vencer en los próximos días, con la última gestión y la promesa de pago */
  app.get("/central/cobranza/ruta", async (req) => {
    const empresaId = empresaDe(req);
    const permitidas = sucursalesDe(req);
    const q = z.object({ dias: z.coerce.number().int().min(0).max(30).default(3), cobradorId: z.union([uuid, z.literal("SIN")]).optional() }).parse(req.query);
    const ps = await pool.query(
      `SELECT p.id, p.cliente_id, p.creado_en, p.mora_pct::text, p.dias_gracia, p.nombre, cl.nombre AS cliente, cl.telefono, cl.documento, cl.direccion,
              p.garante_nombre, p.garante_telefono, v.numero_interno AS factura, a.cobrador_id, cu.nombre AS cobrador,
              g.creada_en AS g_fecha, g.tipo AS g_tipo, g.resultado AS g_resultado, g.nota AS g_nota, to_char(g.promesa_fecha,'YYYY-MM-DD') AS promesa_fecha, g.promesa_monto::text,
              to_char(g.proxima_fecha,'YYYY-MM-DD') AS proxima_fecha, gu.nombre AS g_por,
              COALESCE((SELECT SUM(m.monto) FROM cxc_movimientos m WHERE m.cliente_id = p.cliente_id), 0)::text AS saldo
         FROM cxc_planes p JOIN clientes cl ON cl.id = p.cliente_id LEFT JOIN ventas v ON v.id = p.venta_id
         LEFT JOIN cobranza_asignaciones a ON a.plan_id = p.id LEFT JOIN usuarios cu ON cu.id = a.cobrador_id
         LEFT JOIN LATERAL (SELECT * FROM cobranza_gestiones x WHERE x.plan_id = p.id ORDER BY x.creada_en DESC LIMIT 1) g ON TRUE
         LEFT JOIN usuarios gu ON gu.id = g.usuario_id
        WHERE p.empresa_id = $1 AND p.estado = 'ACTIVO'
          AND ($2::uuid[] IS NULL OR v.sucursal_id IS NULL OR v.sucursal_id = ANY($2::uuid[]))
          AND ($3::text IS NULL OR ($3 = 'SIN' AND a.cobrador_id IS NULL) OR a.cobrador_id::text = $3)`, [empresaId, permitidas, q.cobradorId ?? null]);
    const hoy = hoyRD();
    const limite = new Date(Date.parse(hoy) + q.dias * 86400e3).toISOString().slice(0, 10);
    const filas = [];
    for (const p of ps.rows) {
      const cu = await pool.query(`SELECT numero, to_char(vence,'YYYY-MM-DD') AS vence, monto::text, mora_cobrada::text AS "moraCobrada" FROM cxc_cuotas WHERE plan_id = $1 ORDER BY numero`, [p.id]);
      const pagado = new Decimal((await pool.query(
        `SELECT COALESCE(-SUM(monto) FILTER (WHERE tipo = 'ABONO'), 0) + COALESCE(SUM(monto) FILTER (WHERE tipo = 'AJUSTE' AND notas LIKE 'Anulación del abono%'), 0) AS p
           FROM cxc_movimientos WHERE cliente_id = $1 AND creado_en >= $2`, [p.cliente_id, p.creado_en])).rows[0].p);
      const e = estadoCuotas(cu.rows, pagado, hoy, p.mora_pct, p.dias_gracia);
      const vencidas = e.filter((x) => x.estado === "VENCIDA");
      const proxima = e.find((x) => x.estado !== "PAGADA" && x.estado !== "VENCIDA");
      const porVencer = proxima && proxima.vence <= limite ? proxima : null;
      const promesaHoy = p.promesa_fecha === hoy;
      if (!vencidas.length && !porVencer && !promesaHoy) continue;
      const vencido = vencidas.reduce((a, x) => a.plus(x.pendiente), new Decimal(0));
      const promesaIncumplida = !!p.promesa_fecha && p.promesa_fecha < hoy && vencidas.length > 0;
      filas.push({
        planId: p.id, clienteId: p.cliente_id, cliente: p.cliente, telefono: p.telefono, documento: p.documento, direccion: p.direccion, plan: p.nombre, factura: p.factura,
        garante: p.garante_nombre, garanteTelefono: p.garante_telefono, saldo: p.saldo, cobradorId: p.cobrador_id, cobrador: p.cobrador,
        estado: vencidas.length ? "VENCIDO" : "POR_VENCER", cuotasVencidas: vencidas.length, diasAtraso: vencidas.length ? Math.max(...vencidas.map((x) => x.diasAtraso)) : 0, vencido: vencido.toFixed(2),
        proxima: proxima ? { numero: proxima.numero, vence: proxima.vence, pendiente: proxima.pendiente } : null,
        ultimaGestion: p.g_fecha ? { fecha: p.g_fecha, tipo: p.g_tipo, resultado: p.g_resultado, nota: p.g_nota, por: p.g_por } : null,
        promesa: p.promesa_fecha ? { fecha: p.promesa_fecha, monto: p.promesa_monto, incumplida: promesaIncumplida } : null, proximaGestion: p.proxima_fecha,
      });
    }
    // Primero las promesas incumplidas, luego los más atrasados, luego lo que vence pronto
    filas.sort((a, b) => Number(b.promesa?.incumplida ?? false) - Number(a.promesa?.incumplida ?? false) || b.diasAtraso - a.diasAtraso || (a.proxima?.vence ?? "").localeCompare(b.proxima?.vence ?? ""));
    return filas;
  });

  app.put("/central/cobranza/asignacion", async (req) => {
    const empresaId = empresaDe(req);
    const b = z.object({ planId: uuid, cobradorId: uuid.nullable() }).parse(req.body);
    if (!(await pool.query("SELECT 1 FROM cxc_planes WHERE id = $1 AND empresa_id = $2", [b.planId, empresaId])).rowCount) throw new ErrorNegocio("Plan no encontrado", 404);
    if (!b.cobradorId) await pool.query("DELETE FROM cobranza_asignaciones WHERE plan_id = $1", [b.planId]);
    else {
      if (!(await pool.query("SELECT 1 FROM usuarios WHERE id = $1 AND empresa_id = $2 AND activo", [b.cobradorId, empresaId])).rowCount) throw new ErrorNegocio("Cobrador no válido", 404);
      await pool.query(
        `INSERT INTO cobranza_asignaciones (plan_id, cobrador_id, asignado_por) VALUES ($1,$2,$3)
         ON CONFLICT (plan_id) DO UPDATE SET cobrador_id = EXCLUDED.cobrador_id, asignado_por = EXCLUDED.asignado_por, asignado_en = now()`, [b.planId, b.cobradorId, usuarioDe(req)]);
    }
    return { ok: true };
  });

  app.post("/central/cobranza/gestiones", async (req, rep) => {
    const empresaId = empresaDe(req);
    const b = z.object({
      planId: uuid, tipo: z.enum(["LLAMADA", "VISITA", "MENSAJE", "OTRO"]), resultado: z.enum(["PROMESA", "PAGO", "NO_LOCALIZADO", "SIN_PAGO", "OTRO"]),
      nota: z.string().trim().max(500).optional(), promesaFecha: fechaZ.optional(), promesaMonto: z.coerce.number().positive().optional(), proximaFecha: fechaZ.optional(),
    }).parse(req.body);
    if (b.resultado === "PROMESA" && !b.promesaFecha) throw new ErrorNegocio("Indique la fecha en que el cliente prometió pagar");
    const p = (await pool.query<{ cliente_id: string }>("SELECT cliente_id FROM cxc_planes WHERE id = $1 AND empresa_id = $2", [b.planId, empresaId])).rows[0];
    if (!p) throw new ErrorNegocio("Plan no encontrado", 404);
    const id = uuidv7();
    await pool.query(
      `INSERT INTO cobranza_gestiones (id, empresa_id, plan_id, cliente_id, tipo, resultado, nota, promesa_fecha, promesa_monto, proxima_fecha, usuario_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, empresaId, b.planId, p.cliente_id, b.tipo, b.resultado, b.nota || null, b.resultado === "PROMESA" ? b.promesaFecha : null, b.resultado === "PROMESA" ? b.promesaMonto ?? null : null, b.proximaFecha ?? null, usuarioDe(req)]);
    rep.code(201);
    return { id };
  });

  app.get("/central/cobranza/gestiones", async (req) => {
    const q = z.object({ planId: uuid }).parse(req.query);
    const r = await pool.query(
      `SELECT g.id, g.creada_en AS fecha, g.tipo, g.resultado, g.nota, to_char(g.promesa_fecha,'YYYY-MM-DD') AS "promesaFecha", g.promesa_monto::text AS "promesaMonto",
              to_char(g.proxima_fecha,'YYYY-MM-DD') AS "proximaFecha", u.nombre AS por
         FROM cobranza_gestiones g LEFT JOIN usuarios u ON u.id = g.usuario_id WHERE g.plan_id = $1 AND g.empresa_id = $2 ORDER BY g.creada_en DESC LIMIT 100`, [q.planId, empresaDe(req)]);
    return r.rows;
  });
}
