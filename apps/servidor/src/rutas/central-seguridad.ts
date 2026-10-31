import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";

/**
 * Seguridad: funciones sensibles que un administrador habilita o deshabilita.
 * Lectura: cualquier usuario con sesión (para saber qué botones mostrar).
 * Cambio: solo administradores (permiso «*», ver permisoDeRuta: lo que no está en el mapa exige «*»).
 * El servidor SIEMPRE vuelve a comprobarla (exigirFuncion); ocultar el botón no basta.
 */
export const FUNCIONES = [
  {
    clave: "agregar_existencia",
    titulo: "Agregar existencia desde Productos",
    descripcion: "Muestra «Existencia actual» al crear un producto y el botón «Agregar existencia» en su ficha, y permite cargarla al importar desde Excel. Cada carga queda en el kardex como un ajuste de entrada con el nombre de quien la hizo. Desactivada: la existencia solo cambia con compras, traspasos, ajustes y conteos.",
    porDefecto: false,
  },
  {
    clave: "acceso_web",
    titulo: "Acceso web desde internet",
    descripcion: "Permite entrar a la administración desde internet con el enlace de «Conexión web». Desactivado: el sistema solo se usa desde la red local y el enlace deja de funcionar hasta que un administrador lo vuelva a activar desde un equipo de la red.",
    porDefecto: true,
  },
] as const;
export type ClaveFuncion = (typeof FUNCIONES)[number]["clave"];

export async function funcionHabilitada(empresaId: string, clave: ClaveFuncion) {
  const r = await pool.query<{ habilitada: boolean }>("SELECT habilitada FROM seguridad_funciones WHERE empresa_id = $1 AND clave = $2", [empresaId, clave]);
  return r.rows[0]?.habilitada ?? FUNCIONES.find((f) => f.clave === clave)!.porDefecto;
}
/** ¿Se permite entrar desde internet? (consulta corta con caché de 5 s; la usa el filtro del túnel) */
let cacheWeb: { v: boolean; t: number } | null = null;
export async function accesoWebPermitido() {
  if (cacheWeb && Date.now() - cacheWeb.t < 5_000) return cacheWeb.v;
  const r = await pool.query<{ habilitada: boolean }>("SELECT habilitada FROM seguridad_funciones WHERE clave = 'acceso_web' ORDER BY actualizado_en DESC LIMIT 1").catch(() => ({ rows: [] as { habilitada: boolean }[] }));
  const v = r.rows[0]?.habilitada ?? true;
  cacheWeb = { v, t: Date.now() };
  return v;
}
export async function exigirFuncion(empresaId: string, clave: ClaveFuncion) {
  if (!(await funcionHabilitada(empresaId, clave))) {
    throw new ErrorNegocio("Esta función está desactivada. Un administrador puede activarla en Configuración › Seguridad.", 403);
  }
}

export async function rutasCentralSeguridad(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => z.string().uuid().parse(req.headers["x-empresa-id"]);

  app.get("/central/seguridad", async (req) => {
    const filas = (await pool.query<{ clave: string; habilitada: boolean; actualizado_en: string; usuario: string | null }>(
      `SELECT s.clave, s.habilitada, s.actualizado_en, u.nombre AS usuario FROM seguridad_funciones s LEFT JOIN usuarios u ON u.id = s.usuario_id WHERE s.empresa_id = $1`,
      [empresaDe(req)])).rows;
    return {
      funciones: FUNCIONES.map((f) => {
        const x = filas.find((r) => r.clave === f.clave);
        return { clave: f.clave, titulo: f.titulo, descripcion: f.descripcion, habilitada: x?.habilitada ?? f.porDefecto, porDefecto: f.porDefecto,
          cambiadaEn: x?.actualizado_en ?? null, cambiadaPor: x?.usuario ?? null };
      }),
    };
  });

  app.put("/central/seguridad/:clave", async (req) => {
    const { clave } = z.object({ clave: z.enum(FUNCIONES.map((f) => f.clave) as [ClaveFuncion, ...ClaveFuncion[]]) }).parse(req.params);
    const b = z.object({ habilitada: z.boolean() }).parse(req.body);
    await pool.query(
      `INSERT INTO seguridad_funciones (empresa_id, clave, habilitada, usuario_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (empresa_id, clave) DO UPDATE SET habilitada = $3, usuario_id = $4, actualizado_en = now()`,
      [empresaDe(req), clave, b.habilitada, z.string().uuid().safeParse(req.headers["x-usuario-id"]).data ?? null]);
    cacheWeb = null;
    return { ok: true };
  });
}
