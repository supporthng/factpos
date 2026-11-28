import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tieneModulo, leerMedida, vencimientoDot, ANIOS_DOT, TIPOS_NEUMATICO } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";

/**
 * Gomera: la ficha de cada neumático (medida, tipo de vehículo, nuevo o usado), la búsqueda por medida con lo que hay en cada sucursal
 * y su ubicación en el almacén, y los reportes de medidas y de antigüedad (DOT). La ficha vive en la central, como la de farmacia;
 * el nombre del producto lleva la medida, así que cada caja y sucursal lo encuentra escribiéndola.
 * La ubicación (rack › nivel › posición) usa las tablas de ubicaciones de la tramería: /central/farmacia/ubicaciones.
 */
const uuid = z.string().uuid();
const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
const TIPOS = TIPOS_NEUMATICO.map((t) => t.id) as [string, ...string[]];

export async function rutasCentralGomera(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/central/gomera")) return;
    const r = (await pool.query<{ t: string; m: string[] }>("SELECT tipo_negocio AS t, modulos_extra AS m FROM empresas WHERE id = $1", [empresaDe(req)])).rows[0];
    if (!r || !tieneModulo("GOMERA", r.t, r.m)) throw new ErrorNegocio("El módulo de gomera no está activado: se enciende en Datos de la empresa", 409);
  });

  /** Neumáticos con su existencia por sucursal y la ubicación donde están. Filtra por texto, medida, tipo de vehículo y condición. */
  app.get("/central/gomera/buscar", async (req) => {
    const f = z.object({
      q: z.string().trim().max(60).optional(), medida: z.string().trim().max(20).optional(), tipo: z.enum(TIPOS).optional(),
      condicion: z.enum(["NUEVO", "USADO"]).optional(), sucursalId: uuid.optional(), soloConExistencia: z.enum(["1", "0"]).default("0"),
    }).parse(req.query);
    const m = f.medida ? leerMedida(f.medida) : null;
    if (f.medida && !m) throw new ErrorNegocio("No entiendo esa medida: escríbala como 205/55R16, 90/90-18, 11R22.5 o 26x1.95");
    const r = await pool.query(
      `SELECT p.id, p.sku, p.nombre, p.marca, n.medida, n.tipo_vehiculo AS tipo, n.condicion, n.modelo, n.indice, n.desgaste_vida AS "vidaBanda",
              COALESCE((SELECT jsonb_agg(jsonb_build_object('sucursalId', s.id, 'sucursal', s.nombre, 'almacenId', a.id, 'cantidad', e.cantidad::text,
                          'ubicacion', (SELECT string_agg(u.estante || '-' || u.nivel || '-' || u.posicion, ', ' ORDER BY u.estante, u.nivel, u.posicion)
                                          FROM producto_ubicaciones pu JOIN farmacia_ubicaciones u ON u.id = pu.ubicacion_id
                                         WHERE pu.producto_id = p.id AND u.almacen_id = a.id AND u.activo)) ORDER BY s.nombre)
                          FROM existencias e JOIN almacenes a ON a.id = e.almacen_id JOIN sucursales s ON s.id = a.sucursal_id
                         WHERE e.producto_id = p.id AND s.empresa_id = $1 AND s.activo AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))
                           AND ($7::uuid IS NULL OR s.id = $7)), '[]'::jsonb) AS existencias,
              (SELECT MIN(l.vence_en) FROM existencias_lote el JOIN lotes l ON l.id = el.lote_id JOIN almacenes a ON a.id = el.almacen_id
                WHERE el.producto_id = p.id AND el.cantidad > 0 AND a.sucursal_id IN (SELECT id FROM sucursales WHERE empresa_id = $1)) AS "masViejoVence",
              (SELECT pr.precio FROM presentaciones ps JOIN precios pr ON pr.presentacion_id = ps.id AND pr.sucursal_id IS NULL
                WHERE ps.producto_id = p.id ORDER BY ps.factor, pr.lista_precio_id LIMIT 1)::text AS precio
         FROM producto_neumatico n JOIN productos p ON p.id = n.producto_id
        WHERE p.empresa_id = $1 AND p.activo
          AND ($3::numeric IS NULL OR (n.ancho = $3 AND n.rin = $5 AND n.perfil IS NOT DISTINCT FROM $4::smallint))
          AND ($6::text IS NULL OR n.tipo_vehiculo = $6) AND ($8::text IS NULL OR n.condicion = $8)
          AND ($9::text IS NULL OR translate(lower(p.nombre || ' ' || COALESCE(p.marca,'') || ' ' || COALESCE(n.modelo,'') || ' ' || n.medida), 'áéíóúñ', 'aeioun') LIKE '%' || translate(lower($9), 'áéíóúñ', 'aeioun') || '%')
        ORDER BY n.rin, n.ancho, n.perfil NULLS FIRST, p.nombre LIMIT 300`,
      [empresaDe(req), sucursalesDe(req), m?.ancho ?? null, m?.perfil ?? null, m?.rin ?? null, f.tipo ?? null, f.sucursalId ?? null, f.condicion ?? null, f.q ?? null]);
    type Exis = { cantidad: string };
    const filas = r.rows as Array<{ existencias: Exis[] }>;
    return f.soloConExistencia === "1" ? filas.filter((x) => x.existencias.some((e) => Number(e.cantidad) > 0)) : filas;
  });

  /** Productos todavía sin ficha de neumático, para completarlos (los que ya tiene la gomera antes de usar el módulo) */
  app.get("/central/gomera/sin-ficha", async (req) => {
    const { q } = z.object({ q: z.string().trim().max(60).optional() }).parse(req.query);
    return (await pool.query(
      `SELECT p.id, p.sku, p.nombre, p.marca FROM productos p
        WHERE p.empresa_id = $1 AND p.activo AND p.tipo = 'INVENTARIABLE' AND NOT EXISTS (SELECT 1 FROM producto_neumatico n WHERE n.producto_id = p.id)
          AND ($2::text IS NULL OR translate(lower(p.nombre || ' ' || p.sku), 'áéíóúñ', 'aeioun') LIKE '%' || translate(lower($2), 'áéíóúñ', 'aeioun') || '%')
        ORDER BY p.nombre LIMIT 100`, [empresaDe(req), q ?? null])).rows;
  });

  app.get("/central/gomera/neumatico/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      `SELECT p.id, p.nombre, p.marca, n.medida, n.tipo_vehiculo AS tipo, n.condicion, n.modelo, n.indice, n.desgaste_vida AS "vidaBanda", n.notas, p.controla_lotes AS "controlaDot",
              COALESCE((SELECT array_agg(pu.ubicacion_id) FROM producto_ubicaciones pu WHERE pu.producto_id = p.id), '{}') AS ubicaciones
         FROM productos p LEFT JOIN producto_neumatico n ON n.producto_id = p.id WHERE p.id = $1 AND p.empresa_id = $2`, [id, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Producto no encontrado", 404);
    return r.rows[0];
  });

  /** Guarda la ficha. Con «medidaEnNombre» el nombre del producto pasa a llevar la medida («205/55R16 Michelin Primacy»). */
  app.put("/central/gomera/neumatico/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      medida: z.string().trim().min(3).max(20), tipo: z.enum(TIPOS), condicion: z.enum(["NUEVO", "USADO"]),
      modelo: z.string().trim().max(60).nullish(), indice: z.string().trim().max(10).nullish(),
      vidaBanda: z.number().int().min(0).max(100).nullish(), notas: z.string().trim().max(500).nullish(),
      ubicaciones: z.array(uuid).max(20).default([]), medidaEnNombre: z.boolean().default(true),
      /** Pide el DOT al recibir y vende primero el más viejo */
      controlaDot: z.boolean().default(false),
    }).parse(req.body);
    const med = leerMedida(b.medida);
    if (!med) throw new ErrorNegocio("No entiendo esa medida: escríbala como 205/55R16, 90/90-18, 11R22.5 o 26x1.95");
    if (b.condicion === "NUEVO" && b.vidaBanda != null) throw new ErrorNegocio("La vida de la banda es solo para neumáticos usados");
    const e = empresaDe(req);
    await enTransaccion(async (c) => {
      const p = (await c.query<{ nombre: string }>("SELECT nombre FROM productos WHERE id = $1 AND empresa_id = $2", [id, e])).rows[0];
      if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
      if (b.ubicaciones.length) {
        const ok = await c.query("SELECT COUNT(*)::int AS n FROM farmacia_ubicaciones WHERE empresa_id = $1 AND id = ANY($2::uuid[])", [e, b.ubicaciones]);
        if (ok.rows[0].n !== new Set(b.ubicaciones).size) throw new ErrorNegocio("Alguna ubicación no existe");
      }
      await c.query(
        `INSERT INTO producto_neumatico (producto_id, medida, ancho, perfil, rin, tipo_vehiculo, modelo, indice, condicion, desgaste_vida, notas, actualizado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         ON CONFLICT (producto_id) DO UPDATE SET medida=$2, ancho=$3, perfil=$4, rin=$5, tipo_vehiculo=$6, modelo=$7, indice=$8, condicion=$9, desgaste_vida=$10, notas=$11, actualizado_en=now()`,
        [id, med.texto, med.ancho, med.perfil, med.rin, b.tipo, b.modelo ?? null, b.indice ?? null, b.condicion, b.vidaBanda ?? null, b.notas ?? null]);
      await c.query("DELETE FROM producto_ubicaciones WHERE producto_id = $1", [id]);
      for (const u of new Set(b.ubicaciones)) await c.query("INSERT INTO producto_ubicaciones (producto_id, ubicacion_id) VALUES ($1,$2)", [id, u]);
      await c.query("UPDATE productos SET controla_lotes = $3 WHERE id = $1 AND empresa_id = $2", [id, e, b.controlaDot && b.condicion === "NUEVO"]);
      // La medida en el nombre es lo que hace que la caja lo encuentre escribiéndola; un usado se distingue del nuevo en el mismo nombre
      if (b.medidaEnNombre) {
        const sinMedida = p.nombre.replace(/\s*\((?:usado)\)\s*$/i, "").trim();
        const lleva = sinMedida.replace(/[\s/-]/g, "").toUpperCase().includes(med.texto.replace(/[\s/-]/g, "").toUpperCase());
        const base = lleva ? sinMedida : `${med.texto} ${sinMedida}`;
        const nombre = (b.condicion === "USADO" ? `${base} (usado)` : base).slice(0, 120);
        if (nombre !== p.nombre) await c.query("UPDATE productos SET nombre = $3 WHERE id = $1 AND empresa_id = $2", [id, e, nombre]);
      }
    });
    return { ok: true };
  });

  /** Medidas con lo que hay, lo vendido en los últimos 90 días y lo que se está agotando */
  app.get("/central/gomera/medidas", async (req) => {
    return (await pool.query(
      `SELECT n.medida, n.tipo_vehiculo AS tipo, COUNT(DISTINCT p.id)::int AS modelos,
              COALESCE(SUM(e.cantidad) FILTER (WHERE s.id IS NOT NULL), 0)::text AS existencia,
              COALESCE((SELECT SUM(vi.cantidad * vi.factor) FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id JOIN sucursales vs ON vs.id = v.sucursal_id
                         JOIN presentaciones ps ON ps.id = vi.presentacion_id JOIN producto_neumatico n2 ON n2.producto_id = ps.producto_id
                        WHERE n2.medida = n.medida AND n2.tipo_vehiculo = n.tipo_vehiculo AND vs.empresa_id = $1 AND v.tipo_documento <> 'E34'
                          AND v.creado_en >= now() - interval '90 days' AND ($2::uuid[] IS NULL OR v.sucursal_id = ANY($2::uuid[]))), 0)::text AS vendidos90
         FROM producto_neumatico n JOIN productos p ON p.id = n.producto_id AND p.empresa_id = $1 AND p.activo
         LEFT JOIN existencias e ON e.producto_id = p.id
         LEFT JOIN almacenes a ON a.id = e.almacen_id LEFT JOIN sucursales s ON s.id = a.sucursal_id AND s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))
        GROUP BY n.medida, n.tipo_vehiculo ORDER BY 5 DESC NULLS LAST, 1`, [empresaDe(req), sucursalesDe(req)])).rows;
  });

  /** Neumáticos con existencia, del DOT más viejo al más nuevo, con su edad: lo que ya pasó de ANIOS_DOT años se avisa */
  app.get("/central/gomera/antiguedad", async (req) => {
    const r = await pool.query(
      `SELECT p.id AS "productoId", p.nombre, n.medida, l.numero_lote AS dot, to_char(l.vence_en, 'YYYY-MM-DD') AS vence,
              ROUND(((CURRENT_DATE - (l.vence_en - make_interval(years => $3::int))::date) / 365.25)::numeric, 1)::text AS edad,
              el.cantidad::text AS cantidad, s.nombre AS sucursal, a.id AS "almacenId",
              (l.vence_en <= CURRENT_DATE) AS "pasada"
         FROM existencias_lote el JOIN lotes l ON l.id = el.lote_id JOIN productos p ON p.id = el.producto_id
         JOIN producto_neumatico n ON n.producto_id = p.id JOIN almacenes a ON a.id = el.almacen_id JOIN sucursales s ON s.id = a.sucursal_id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) AND el.cantidad > 0 AND n.condicion = 'NUEVO' AND l.vence_en IS NOT NULL
        ORDER BY l.vence_en, p.nombre LIMIT 500`, [empresaDe(req), sucursalesDe(req), ANIOS_DOT]);
    return r.rows;
  });

  /** Para la pantalla de compras: de un DOT («2324») sale la fecha que se guarda como vencimiento del lote */
  app.get("/central/gomera/dot", async (req) => {
    const { dot } = z.object({ dot: z.string().trim().max(8) }).parse(req.query);
    const v = vencimientoDot(dot);
    if (!v) throw new ErrorNegocio("El DOT son 4 números: semana y año de fabricación, por ejemplo 2324");
    return { dot, vence: v };
  });
}
