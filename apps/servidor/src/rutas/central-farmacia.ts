import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";

/**
 * Farmacias: ubicación de cada producto en la tramería (estante › nivel › posición), datos del medicamento (principio activo,
 * laboratorio, controlado, con receta) y el control de vencimientos con aviso escalonado (30, 60 y 90 días; lo vencido no se factura).
 * Escribir pide «admin.inventario»; leer, la sesión de administración.
 */
const uuid = z.string().uuid();
const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

/** Niveles del aviso: VENCIDO ya pasó la fecha; 30, 60 y 90 son los días que faltan */
const NIVELES = ["VENCIDO", "30", "60", "90"] as const;
const CASO_NIVEL = `CASE WHEN l.vence_en < CURRENT_DATE THEN 'VENCIDO' WHEN l.vence_en <= CURRENT_DATE + 30 THEN '30'
                         WHEN l.vence_en <= CURRENT_DATE + 60 THEN '60' ELSE '90' END`;

export async function rutasCentralFarmacia(app: FastifyInstance) {
  /** Cuántos lotes con existencia hay en cada nivel de aviso (lo que se muestra como alerta al entrar) */
  app.get("/central/farmacia/resumen", async (req) => {
    const r = await pool.query<{ nivel: string; lotes: number; unidades: string }>(
      `SELECT ${CASO_NIVEL} AS nivel, COUNT(*)::int AS lotes, SUM(el.cantidad)::text AS unidades
         FROM existencias_lote el JOIN lotes l ON l.id = el.lote_id JOIN almacenes a ON a.id = el.almacen_id JOIN sucursales s ON s.id = a.sucursal_id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))
          AND el.cantidad > 0 AND l.vence_en IS NOT NULL AND l.vence_en <= CURRENT_DATE + 90
        GROUP BY 1`, [empresaDe(req), sucursalesDe(req)]);
    const por = Object.fromEntries(r.rows.map((x) => [x.nivel, { lotes: x.lotes, unidades: x.unidades }]));
    return Object.fromEntries(NIVELES.map((n) => [n, por[n] ?? { lotes: 0, unidades: "0" }]));
  });

  /** Lotes por vencer o vencidos con su ubicación en la tramería, para sacarlos del estante */
  app.get("/central/farmacia/vencimientos", async (req) => {
    const { nivel } = z.object({ nivel: z.enum(NIVELES).optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT * FROM (
         SELECT p.id AS "productoId", p.sku, p.nombre, f.principio_activo AS "principioActivo", l.numero_lote AS lote,
                to_char(l.vence_en, 'YYYY-MM-DD') AS vence, (l.vence_en - CURRENT_DATE)::int AS dias, el.cantidad::text AS cantidad,
                a.nombre AS almacen, a.id AS "almacenId", a.sucursal_id AS "sucursalId", ${CASO_NIVEL} AS nivel,
                (SELECT string_agg(u.estante || '-' || u.nivel || '-' || u.posicion, ', ' ORDER BY u.estante, u.nivel, u.posicion)
                   FROM producto_ubicaciones pu JOIN farmacia_ubicaciones u ON u.id = pu.ubicacion_id
                  WHERE pu.producto_id = p.id AND u.almacen_id = el.almacen_id) AS ubicacion
           FROM existencias_lote el JOIN lotes l ON l.id = el.lote_id JOIN productos p ON p.id = el.producto_id
           JOIN almacenes a ON a.id = el.almacen_id JOIN sucursales s ON s.id = a.sucursal_id
           LEFT JOIN producto_farmacia f ON f.producto_id = p.id
          WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))
            AND el.cantidad > 0 AND l.vence_en IS NOT NULL AND l.vence_en <= CURRENT_DATE + 90
       ) t WHERE ($3::text IS NULL OR t.nivel = $3) ORDER BY t.dias, t.nombre LIMIT 1000`,
      [empresaDe(req), sucursalesDe(req), nivel ?? null]);
    return r.rows;
  });

  /** Recetas de lo controlado o de venta con receta: quién, qué médico y qué se despachó (para la inspección) */
  app.get("/central/farmacia/recetas", async (req) => {
    const { desde, hasta } = z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
    const r = await pool.query(
      `SELECT v.id AS "ventaId", v.numero_interno AS factura, to_char(v.creado_en AT TIME ZONE 'America/Santo_Domingo', 'YYYY-MM-DD HH24:MI') AS fecha,
              r.paciente, r.medico, r.exequatur, to_char(r.fecha_receta, 'YYYY-MM-DD') AS "fechaReceta", s.nombre AS sucursal, u.nombre AS vendedor,
              (SELECT string_agg(DISTINCT p.nombre || CASE WHEN f.controlado THEN ' (controlado)' ELSE '' END, ', ')
                 FROM venta_items vi JOIN presentaciones pr ON pr.id = vi.presentacion_id JOIN productos p ON p.id = pr.producto_id
                 JOIN producto_farmacia f ON f.producto_id = p.id AND (f.controlado OR f.requiere_receta) WHERE vi.venta_id = v.id) AS productos
         FROM venta_recetas r JOIN ventas v ON v.id = r.venta_id JOIN sucursales s ON s.id = v.sucursal_id LEFT JOIN usuarios u ON u.id = v.usuario_id
        WHERE s.empresa_id = $1 AND ($4::uuid[] IS NULL OR s.id = ANY($4::uuid[]))
          AND (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date BETWEEN $2::date AND $3::date
        ORDER BY v.creado_en DESC LIMIT 2000`, [empresaDe(req), desde, hasta, sucursalesDe(req)]);
    return r.rows;
  });

  // ------------------------------------------------------------------ ubicaciones de la tramería
  app.get("/central/farmacia/ubicaciones", async (req) => {
    const r = await pool.query(
      `SELECT u.id, u.almacen_id AS "almacenId", a.nombre AS almacen, u.estante, u.nivel, u.posicion, u.activo,
              (SELECT COUNT(*)::int FROM producto_ubicaciones pu WHERE pu.ubicacion_id = u.id) AS productos
         FROM farmacia_ubicaciones u JOIN almacenes a ON a.id = u.almacen_id
        WHERE u.empresa_id = $1 ORDER BY a.nombre, u.estante, u.nivel, u.posicion`, [empresaDe(req)]);
    return r.rows;
  });
  app.get("/central/farmacia/almacenes", async (req) => {
    return (await pool.query(
      `SELECT a.id, a.nombre || ' · ' || s.nombre AS nombre FROM almacenes a JOIN sucursales s ON s.id = a.sucursal_id
        WHERE s.empresa_id = $1 AND s.activo AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) ORDER BY s.nombre, a.nombre`, [empresaDe(req), sucursalesDe(req)])).rows;
  });
  /** Crea una ubicación, o una tanda: «posiciones: 12» crea de la 1 a la 12 del estante y nivel indicados */
  app.post("/central/farmacia/ubicaciones", async (req, rep) => {
    const b = z.object({
      almacenId: uuid, estante: z.string().trim().min(1).max(20).transform((x) => x.toUpperCase()),
      nivel: z.number().int().min(1).max(30), posicion: z.string().trim().min(1).max(10).default("1"), posiciones: z.number().int().min(1).max(60).optional(),
    }).parse(req.body);
    const e = empresaDe(req);
    if (!(await pool.query("SELECT 1 FROM almacenes a JOIN sucursales s ON s.id = a.sucursal_id WHERE a.id = $1 AND s.empresa_id = $2", [b.almacenId, e])).rowCount) throw new ErrorNegocio("Almacén no encontrado", 404);
    const lista = b.posiciones ? Array.from({ length: b.posiciones }, (_, i) => String(i + 1)) : [b.posicion];
    let nuevas = 0;
    for (const pos of lista) {
      const r = await pool.query(
        "INSERT INTO farmacia_ubicaciones (id, empresa_id, almacen_id, estante, nivel, posicion) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (almacen_id, estante, nivel, posicion) DO NOTHING",
        [uuidv7(), e, b.almacenId, b.estante, b.nivel, pos]);
      nuevas += r.rowCount ?? 0;
    }
    if (!nuevas) throw new ErrorNegocio("Esa ubicación ya existe", 409);
    rep.code(201);
    return { creadas: nuevas };
  });
  app.put("/central/farmacia/ubicaciones/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
    const r = await pool.query("UPDATE farmacia_ubicaciones SET activo = $3 WHERE id = $1 AND empresa_id = $2", [id, empresaDe(req), activo]);
    if (!r.rowCount) throw new ErrorNegocio("Ubicación no encontrada", 404);
    return { ok: true };
  });

  // ------------------------------------------------------------------ datos del medicamento
  app.get("/central/farmacia/productos/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const e = empresaDe(req);
    if (!(await pool.query("SELECT 1 FROM productos WHERE id = $1 AND empresa_id = $2", [id, e])).rowCount) throw new ErrorNegocio("Producto no encontrado", 404);
    const f = (await pool.query(`SELECT principio_activo AS "principioActivo", laboratorio, controlado, requiere_receta AS "requiereReceta" FROM producto_farmacia WHERE producto_id = $1`, [id])).rows[0]
      ?? { principioActivo: null, laboratorio: null, controlado: false, requiereReceta: false };
    const ubicaciones = (await pool.query("SELECT ubicacion_id AS id FROM producto_ubicaciones WHERE producto_id = $1", [id])).rows.map((x) => x.id as string);
    return { ...f, ubicaciones };
  });
  app.put("/central/farmacia/productos/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      principioActivo: z.string().trim().max(120).nullable(), laboratorio: z.string().trim().max(80).nullable(),
      controlado: z.boolean(), requiereReceta: z.boolean(), ubicaciones: z.array(uuid).max(20),
    }).parse(req.body);
    const e = empresaDe(req);
    await enTransaccion(async (c) => {
      if (!(await c.query("SELECT 1 FROM productos WHERE id = $1 AND empresa_id = $2", [id, e])).rowCount) throw new ErrorNegocio("Producto no encontrado", 404);
      if (b.ubicaciones.length) {
        const ok = await c.query("SELECT COUNT(*)::int AS n FROM farmacia_ubicaciones WHERE empresa_id = $1 AND id = ANY($2::uuid[])", [e, b.ubicaciones]);
        if (ok.rows[0].n !== new Set(b.ubicaciones).size) throw new ErrorNegocio("Alguna ubicación no existe");
      }
      await c.query(
        `INSERT INTO producto_farmacia (producto_id, principio_activo, laboratorio, controlado, requiere_receta) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (producto_id) DO UPDATE SET principio_activo = $2, laboratorio = $3, controlado = $4, requiere_receta = $5, actualizado_en = now()`,
        [id, b.principioActivo || null, b.laboratorio || null, b.controlado, b.requiereReceta]);
      await c.query("DELETE FROM producto_ubicaciones WHERE producto_id = $1", [id]);
      for (const u of new Set(b.ubicaciones)) await c.query("INSERT INTO producto_ubicaciones (producto_id, ubicacion_id) VALUES ($1,$2)", [id, u]);
    });
    return { ok: true };
  });

  /** «¿Dónde está?»: busca por nombre, código o principio activo (así se ofrecen genéricos y sustitutos) con su ubicación y lo vigente */
  /** Para el buscador de «Vender»: dónde está cada producto en la tramería y su principio activo (una sola consulta; solo lo que tiene datos de farmacia) */
  app.get("/central/farmacia/mapa", async (req) => {
    const r = await pool.query(
      `SELECT p.id AS "productoId", f.principio_activo AS "principioActivo",
              (SELECT string_agg(u.estante || '-' || u.nivel || '-' || u.posicion, ', ' ORDER BY u.estante, u.nivel, u.posicion)
                 FROM producto_ubicaciones pu JOIN farmacia_ubicaciones u ON u.id = pu.ubicacion_id WHERE pu.producto_id = p.id AND u.activo) AS ubicacion
         FROM productos p LEFT JOIN producto_farmacia f ON f.producto_id = p.id
        WHERE p.empresa_id = $1 AND p.activo
          AND (COALESCE(f.principio_activo, '') <> '' OR EXISTS (SELECT 1 FROM producto_ubicaciones pu WHERE pu.producto_id = p.id))`, [empresaDe(req)]);
    return r.rows;
  });

  app.get("/central/farmacia/buscar", async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    const r = await pool.query(
      `SELECT p.id, p.sku, p.nombre, f.principio_activo AS "principioActivo", f.laboratorio, COALESCE(f.controlado, false) AS controlado, COALESCE(f.requiere_receta, false) AS "requiereReceta",
              COALESCE((SELECT SUM(e.cantidad) FROM existencias e JOIN almacenes a ON a.id = e.almacen_id JOIN sucursales s ON s.id = a.sucursal_id
                         WHERE e.producto_id = p.id AND s.empresa_id = $1 AND ($3::uuid[] IS NULL OR s.id = ANY($3::uuid[]))), 0)::text AS existencia,
              COALESCE((SELECT SUM(el.cantidad) FROM existencias_lote el JOIN lotes l ON l.id = el.lote_id JOIN almacenes a ON a.id = el.almacen_id JOIN sucursales s ON s.id = a.sucursal_id
                         WHERE el.producto_id = p.id AND s.empresa_id = $1 AND ($3::uuid[] IS NULL OR s.id = ANY($3::uuid[])) AND l.vence_en < CURRENT_DATE), 0)::text AS vencido,
              (SELECT string_agg(a.nombre || ': ' || u.estante || '-' || u.nivel || '-' || u.posicion, ' · ' ORDER BY a.nombre, u.estante, u.nivel, u.posicion)
                 FROM producto_ubicaciones pu JOIN farmacia_ubicaciones u ON u.id = pu.ubicacion_id JOIN almacenes a ON a.id = u.almacen_id WHERE pu.producto_id = p.id AND u.activo) AS ubicacion
         FROM productos p LEFT JOIN producto_farmacia f ON f.producto_id = p.id
        WHERE p.empresa_id = $1 AND p.activo AND (p.nombre ILIKE '%' || $2 || '%' OR p.sku ILIKE $2 || '%' OR f.principio_activo ILIKE '%' || $2 || '%')
        ORDER BY (f.principio_activo ILIKE $2 || '%') DESC, p.nombre LIMIT 40`, [empresaDe(req), q, sucursalesDe(req)]);
    return r.rows;
  });
}
