import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "./../db.js";
import { abrirTurno } from "./turnos.js";
import { cerrarTurno, reporteTurno, DENOMINACIONES } from "./cierre.js";
import { tienePermiso, sucursalesDe } from "../sesion.js";

/**
 * Mi turno (Administración): en el modo «una sola persona factura y cobra» quien factura abre y cierra su turno sin
 * pasar por el programa de la Caja. Es la misma lógica de la Caja (abrirTurno, reporteTurno, cerrarTurno); aquí solo
 * cambia quién llama: el usuario de la sesión de la Administración. Si la empresa no activó el modo, no responde.
 */
export async function rutasMiTurno(app: FastifyInstance) {
  const uuid = z.string().uuid();
  const empresaDe = (req: { headers: Record<string, unknown> }) => String(req.headers["x-empresa-id"] ?? "");
  const usuarioDe = (req: { headers: Record<string, unknown> }) => String(req.headers["x-usuario-id"] ?? "");

  const exigirModo = async (req: { headers: Record<string, unknown> }) => {
    const r = await pool.query<{ u: boolean }>("SELECT una_sola_persona AS u FROM empresas WHERE id = $1", [empresaDe(req)]);
    if (!r.rows[0]?.u) throw new ErrorNegocio("El modo «una sola persona factura y cobra» no está activado en Datos de la empresa", 409);
  };
  /** La caja debe ser de esta empresa y de tipo CAJA (la de «Facturación» no lleva turno). */
  const exigirCaja = async (req: { headers: Record<string, unknown> }, cajaId: string) => {
    const r = await pool.query(
      `SELECT 1 FROM cajas ca JOIN sucursales s ON s.id = ca.sucursal_id
        WHERE ca.id = $1 AND s.empresa_id = $2 AND ca.tipo = 'CAJA' AND NOT ca.eliminada
          AND ($3::uuid[] IS NULL OR s.id = ANY($3::uuid[]))`, [cajaId, empresaDe(req), sucursalesDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Caja no encontrada", 404);
  };

  /** Las cajas de la empresa con el turno que tienen abierto, y si el modo está activo. */
  app.get("/central/mi-turno", async (req) => {
    const e = empresaDe(req);
    const modo = (await pool.query<{ u: boolean }>("SELECT una_sola_persona AS u FROM empresas WHERE id = $1", [e])).rows[0]?.u ?? false;
    if (!modo) return { modo: false, cajas: [] };
    const cajas = await pool.query(
      `SELECT ca.id AS "cajaId", ca.nombre AS caja, s.id AS "sucursalId", s.nombre AS sucursal,
              CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id', t.id, 'abiertoEn', t.abierto_en, 'fondoInicial', t.fondo_inicial::text,
                   'usuarioId', u.id, 'usuario', u.nombre, 'esMio', t.usuario_id = $2) END AS turno
         FROM cajas ca JOIN sucursales s ON s.id = ca.sucursal_id
         LEFT JOIN turnos t ON t.caja_id = ca.id AND t.estado = 'ABIERTO'
         LEFT JOIN usuarios u ON u.id = t.usuario_id
        WHERE s.empresa_id = $1 AND ca.tipo = 'CAJA' AND ca.activo AND NOT ca.eliminada AND ($3::uuid[] IS NULL OR s.id = ANY($3::uuid[]))
        ORDER BY s.nombre, ca.nombre`, [e, usuarioDe(req), sucursalesDe(req)]);
    return { modo: true, cajas: cajas.rows };
  });

  app.post("/central/mi-turno/abrir", async (req, rep) => {
    await exigirModo(req);
    const b = z.object({
      cajaId: uuid, fondoInicial: z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido"),
      conteoApertura: z.record(z.enum(DENOMINACIONES.map(String) as [string, ...string[]]), z.number().int().min(0).max(100000)).optional(),
    }).parse(req.body);
    await exigirCaja(req, b.cajaId);
    const turno = await abrirTurno(b.cajaId, { usuarioId: usuarioDe(req), fondoInicial: b.fondoInicial, conteoApertura: b.conteoApertura });
    rep.code(201);
    return turno;
  });

  /** Cuadre del turno abierto (reporte X): el suyo; el de otro solo con permiso de cierres. */
  app.get("/central/mi-turno/:cajaId/cuadre", async (req) => {
    await exigirModo(req);
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    await exigirCaja(req, cajaId);
    const t = await pool.query("SELECT id, usuario_id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId]);
    if (!t.rowCount) throw new ErrorNegocio("La caja no tiene un turno abierto");
    const permisos = ((req as { sesion?: { p?: string[] } }).sesion?.p) ?? [];
    if (t.rows[0].usuario_id !== usuarioDe(req) && !tienePermiso(permisos, "admin.cierres")) throw new ErrorNegocio("Este turno es de otra persona", 403);
    return reporteTurno(pool, t.rows[0].id);
  });

  app.post("/central/mi-turno/:cajaId/cerrar", async (req) => {
    await exigirModo(req);
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    await exigirCaja(req, cajaId);
    const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
    const b = z.object({
      conteo: z.record(z.enum(DENOMINACIONES.map(String) as [string, ...string[]]), z.number().int().min(0).max(100000)).default({}),
      tarjeta: monto.default("0"), transferencia: monto.default("0"), notas: z.string().trim().max(300).nullable().default(null),
    }).parse(req.body);
    const t = await pool.query("SELECT usuario_id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId]);
    const permisos = ((req as { sesion?: { p?: string[] } }).sesion?.p) ?? [];
    if (t.rowCount && t.rows[0].usuario_id !== usuarioDe(req) && !tienePermiso(permisos, "admin.cierres")) throw new ErrorNegocio("Este turno es de otra persona: solo quien lo abrió o un administrador puede cerrarlo", 403);
    return cerrarTurno(cajaId, { usuarioId: usuarioDe(req), ...b });
  });
}
