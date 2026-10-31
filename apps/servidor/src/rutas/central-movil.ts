import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { sucursalesDe } from "../sesion.js";

/**
 * Versión celular de la administración: si está activa, en pantallas angostas solo se ven las
 * secciones elegidas y solo entran los usuarios autorizados. Es una restricción de la pantalla:
 * los permisos de cada rol siguen valiendo igual en el servidor.
 * Lectura: cualquier sesión (la pantalla la necesita). Cambio: solo administradores.
 */
export const OPCIONES_MOVIL = ["resumen", "productos", "compras", "inventario", "ajustes", "conteos", "traspasos", "kardex", "precios", "ofertas", "delivery", "cxc", "caja", "reportes"] as const;
const POR_DEFECTO = ["resumen", "productos", "compras", "inventario", "precios", "cxc", "caja", "reportes"];

interface Fila { habilitada: boolean; secciones: string[]; todos_usuarios: boolean; usuarios: string[]; con_sucursales: boolean; actualizado_en: string | null; quien: string | null }

export async function rutasCentralMovil(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => z.string().uuid().parse(req.headers["x-empresa-id"]);

  app.get("/central/movil", async (req) => {
    const f = (await pool.query<Fila>(
      `SELECT m.habilitada, m.secciones, m.todos_usuarios, m.usuarios::text[] AS usuarios, m.con_sucursales, m.actualizado_en, u.nombre AS quien
         FROM config_movil m LEFT JOIN usuarios u ON u.id = m.usuario_id WHERE m.empresa_id = $1`, [empresaDe(req)])).rows[0];
    const c = f ?? { habilitada: true, secciones: POR_DEFECTO, todos_usuarios: true, usuarios: [], con_sucursales: true, actualizado_en: null, quien: null };
    const yo = z.string().uuid().safeParse(req.headers["x-usuario-id"]).data;
    return {
      habilitada: c.habilitada, secciones: c.secciones.filter((s) => (OPCIONES_MOVIL as readonly string[]).includes(s)),
      todosUsuarios: c.todos_usuarios, usuarios: c.usuarios,
      conSucursales: c.con_sucursales,
      // Entra si es de la lista, si se permite a todos o si tiene sucursales asignadas (administra solo las suyas)
      aplica: c.habilitada && (c.todos_usuarios || (!!yo && c.usuarios.includes(yo)) || (c.con_sucursales && sucursalesDe(req) !== null)),
      cambiadaEn: c.actualizado_en, cambiadaPor: c.quien,
    };
  });

  app.put("/central/movil", async (req) => {
    const b = z.object({
      habilitada: z.boolean(),
      secciones: z.array(z.enum(OPCIONES_MOVIL)).max(OPCIONES_MOVIL.length),
      todosUsuarios: z.boolean(),
      usuarios: z.array(z.string().uuid()).max(500),
      conSucursales: z.boolean().default(true),
    }).parse(req.body);
    await pool.query(
      `INSERT INTO config_movil (empresa_id, habilitada, secciones, todos_usuarios, usuarios, usuario_id, con_sucursales)
       VALUES ($1,$2,$3,$4,$5::uuid[],$6,$7)
       ON CONFLICT (empresa_id) DO UPDATE SET habilitada = $2, secciones = $3, todos_usuarios = $4, usuarios = $5::uuid[], usuario_id = $6, con_sucursales = $7, actualizado_en = now()`,
      [empresaDe(req), b.habilitada, [...new Set(b.secciones)], b.todosUsuarios, [...new Set(b.usuarios)], z.string().uuid().safeParse(req.headers["x-usuario-id"]).data ?? null, b.conSucursales]);
    return { ok: true };
  });
}
