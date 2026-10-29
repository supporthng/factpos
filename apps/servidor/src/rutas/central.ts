import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";

/**
 * Administración central (oficina principal, corre en la nube).
 *
 * Controla todas las sucursales desde un solo lugar:
 *  - Resumen del día por sucursal
 *  - Inventario consolidado: existencia y valor de cada producto en cada sucursal
 *  - Precios por sucursal y por nivel (Precio 1, 2 y 3)
 *  - Ofertas por sucursal
 *  - Mínimos, máximos y productos habilitados por sucursal
 *  - (La sincronización con los servidores locales está en central-sync.ts)
 *
 * Estas rutas solo se activan con MODO=central.
 */
const uuid = z.string().uuid();
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
const cant = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida");

export async function rutasCentral(app: FastifyInstance) {
  // TODO fase 2: autenticación de administradores (Supabase Auth) y filtro por empresa del usuario.
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  // -------------------------------------------------------------------
  // Panorama
  // -------------------------------------------------------------------
  app.get("/central/sucursales", async (req) => {
    const r = await pool.query("SELECT * FROM rpt_resumen_sucursales WHERE empresa_id = $1 ORDER BY sucursal", [empresaDe(req)]);
    return r.rows;
  });

  /** Inventario consolidado: una fila por producto con la existencia de cada sucursal. */
  app.get("/central/inventario", async (req) => {
    const f = z
      .object({ q: z.string().trim().max(60).optional(), categoriaId: uuid.optional(), soloBajoMinimo: z.enum(["1"]).optional() })
      .parse(req.query);
    const r = await pool.query(
      `SELECT producto_id AS "productoId", sku, nombre,
              SUM(cantidad) AS "existenciaTotal", SUM(valor) AS "valorTotal",
              jsonb_object_agg(sucursal, jsonb_build_object(
                  'sucursalId', sucursal_id, 'cantidad', cantidad, 'valor', valor,
                  'minimo', stock_minimo, 'bajoMinimo', bajo_minimo)) AS sucursales
         FROM rpt_inventario_sucursales
        WHERE empresa_id = $1
          AND ($2::text IS NULL OR nombre ILIKE '%' || $2 || '%' OR sku ILIKE $2 || '%')
          AND ($3::uuid IS NULL OR categoria_id = $3)
        GROUP BY producto_id, sku, nombre
       HAVING $4::boolean IS NOT TRUE OR BOOL_OR(bajo_minimo)
        ORDER BY nombre LIMIT 500`,
      [empresaDe(req), f.q ?? null, f.categoriaId ?? null, f.soloBajoMinimo === "1"],
    );
    return r.rows;
  });

  /** Mínimos, máximos y producto habilitado por sucursal. */
  app.put("/central/inventario/parametros", async (req) => {
    const items = z
      .array(z.object({
        productoId: uuid, sucursalId: uuid,
        stockMinimo: cant.optional(), stockMaximo: cant.nullable().optional(),
        ubicacion: z.string().max(30).nullable().optional(), activo: z.boolean().optional(),
      }))
      .min(1).max(2000)
      .parse(req.body);
    await enTransaccion(async (c) => {
      for (const i of items) {
        await c.query(
          `INSERT INTO producto_sucursal (producto_id, sucursal_id, stock_minimo, stock_maximo, ubicacion, activo)
           VALUES ($1, $2, COALESCE($3, 0), $4, $5, COALESCE($6, true))
           ON CONFLICT (producto_id, sucursal_id) DO UPDATE SET
             stock_minimo = COALESCE($3, producto_sucursal.stock_minimo),
             stock_maximo = CASE WHEN $7 THEN $4 ELSE producto_sucursal.stock_maximo END,
             ubicacion    = CASE WHEN $8 THEN $5 ELSE producto_sucursal.ubicacion END,
             activo       = COALESCE($6, producto_sucursal.activo)`,
          [i.productoId, i.sucursalId, i.stockMinimo ?? null, i.stockMaximo ?? null, i.ubicacion ?? null,
           i.activo ?? null, i.stockMaximo !== undefined, i.ubicacion !== undefined],
        );
      }
    });
    return { actualizados: items.length };
  });

  // -------------------------------------------------------------------
  // Precios por sucursal
  // -------------------------------------------------------------------
  /** Matriz de precios de un producto: presentación × nivel × (general y cada sucursal). */
  app.get("/central/precios/:productoId", async (req) => {
    const { productoId } = z.object({ productoId: uuid }).parse(req.params);
    const r = await pool.query(
      `SELECT pr.id AS "presentacionId", pr.nombre AS presentacion, pr.factor,
              lp.nivel, lp.nombre AS lista, x.sucursal_id AS "sucursalId", s.nombre AS sucursal,
              x.precio, ROUND(e.costo * pr.factor, 2) AS costo,
              CASE WHEN x.precio > 0 THEN ROUND(100 * (x.precio / (1 + i.tasa) - e.costo * pr.factor) / (x.precio / (1 + i.tasa)), 1) END AS "margenPct"
         FROM presentaciones pr
         JOIN productos p ON p.id = pr.producto_id
         JOIN impuestos i ON i.id = p.impuesto_id
         JOIN precios x ON x.presentacion_id = pr.id AND x.activo
         JOIN listas_precio lp ON lp.id = x.lista_precio_id
         LEFT JOIN sucursales s ON s.id = x.sucursal_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(AVG(ex.costo_promedio) FILTER (WHERE ex.cantidad > 0), p.costo_promedio) AS costo
             FROM existencias ex WHERE ex.producto_id = p.id) e ON TRUE
        WHERE p.id = $1
        ORDER BY pr.factor, lp.nivel, x.sucursal_id NULLS FIRST`,
      [productoId],
    );
    return r.rows;
  });

  /**
   * Cambia precios en bloque. sucursalId null = precio general (todas).
   * precio null = quita el precio propio de esa sucursal (vuelve al general).
   */
  app.put("/central/precios", async (req) => {
    const cambios = z
      .array(z.object({ presentacionId: uuid, nivel: z.number().int().min(1).max(3), sucursalId: uuid.nullable(), precio: monto.nullable() }))
      .min(1).max(5000)
      .parse(req.body);
    const empresaId = empresaDe(req);
    await enTransaccion(async (c) => {
      for (const x of cambios) {
        const lp = await c.query<{ id: string }>("SELECT id FROM listas_precio WHERE empresa_id = $1 AND nivel = $2", [empresaId, x.nivel]);
        if (!lp.rowCount) throw new ErrorNegocio(`No existe el nivel de precio ${x.nivel}`);
        const previo = (await c.query<{ precio: string }>(
          "SELECT precio FROM precios WHERE lista_precio_id = $1 AND presentacion_id = $2 AND sucursal_id IS NOT DISTINCT FROM $3 AND activo",
          [lp.rows[0].id, x.presentacionId, x.sucursalId],
        )).rows[0]?.precio ?? null;
        if (previo !== null && x.precio !== null && Number(previo) === Number(x.precio)) continue;
        await c.query(
          `INSERT INTO historial_precios (id, presentacion_id, lista_precio_id, sucursal_id, precio_anterior, precio_nuevo, usuario_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [uuidv7(), x.presentacionId, lp.rows[0].id, x.sucursalId, previo, x.precio, uuid.safeParse(req.headers["x-usuario-id"]).data ?? null],
        );
        if (x.precio === null) {
          if (x.sucursalId === null) throw new ErrorNegocio("El precio general no se puede quitar, solo cambiar");
          await c.query(
            "UPDATE precios SET activo = false WHERE lista_precio_id = $1 AND presentacion_id = $2 AND sucursal_id = $3",
            [lp.rows[0].id, x.presentacionId, x.sucursalId],
          );
        } else {
          await c.query(
            `INSERT INTO precios (id, lista_precio_id, presentacion_id, sucursal_id, precio)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (lista_precio_id, presentacion_id, COALESCE(sucursal_id, '00000000-0000-0000-0000-000000000000'))
             DO UPDATE SET precio = EXCLUDED.precio, porcentaje = NULL, activo = true`,
            [uuidv7(), lp.rows[0].id, x.presentacionId, x.sucursalId, x.precio],
          );
        }
      }
    });
    return { actualizados: cambios.length };
  });

  // -------------------------------------------------------------------
  // Ofertas por sucursal
  // -------------------------------------------------------------------
  const OfertaSchema = z.object({
    nombre: z.string().min(3).max(80),
    tipo: z.enum(["PORCENTAJE", "PRECIO_ESPECIAL", "LLEVA_PAGA", "POR_VOLUMEN"]),
    valor: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
    lleva: z.number().int().min(2).optional(),
    paga: z.number().int().min(1).optional(),
    cantidadMinima: cant.default("1"),
    iniciaEn: z.string().datetime({ offset: true }),
    terminaEn: z.string().datetime({ offset: true }),
    diasSemana: z.array(z.number().int().min(0).max(6)).optional(),
    horaDesde: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    horaHasta: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    sucursales: z.array(uuid).min(1).nullable().default(null), // null = todas
    nivelPrecio: z.number().int().min(1).max(3).optional(),     // solo para clientes de ese nivel
    prioridad: z.number().int().default(0),
    /** Tope de unidades por sucursal ("20 whiskies a 800"); null = sin tope */
    unidadesMaximas: cant.refine((v) => Number(v) > 0, "El tope debe ser mayor que cero").nullable().default(null),
    alcance: z
      .array(z.object({ productoId: uuid.optional(), presentacionId: uuid.optional(), categoriaId: uuid.optional() })
        .refine((a) => [a.productoId, a.presentacionId, a.categoriaId].filter(Boolean).length === 1, "Indique un producto, una presentación o una categoría"))
      .min(1),
  });

  app.post("/central/ofertas", async (req, rep) => {
    const o = OfertaSchema.parse(req.body);
    const empresaId = empresaDe(req);
    const id = await enTransaccion(async (c) => {
      const lista = o.nivelPrecio
        ? (await c.query("SELECT id FROM listas_precio WHERE empresa_id = $1 AND nivel = $2", [empresaId, o.nivelPrecio])).rows[0]?.id
        : null;
      const id = uuidv7();
      try {
        await c.query(
          `INSERT INTO ofertas (id, empresa_id, nombre, tipo, valor, lleva, paga, cantidad_minima, inicia_en, termina_en,
                                dias_semana, hora_desde, hora_hasta, sucursales, lista_precio_id, prioridad, unidades_maximas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [id, empresaId, o.nombre, o.tipo, o.valor ?? null, o.lleva ?? null, o.paga ?? null, o.cantidadMinima,
           o.iniciaEn, o.terminaEn, o.diasSemana ?? null, o.horaDesde ?? null, o.horaHasta ?? null,
           o.sucursales, lista, o.prioridad, o.unidadesMaximas],
        );
      } catch (e: any) {
        if (e.code === "23514") throw new ErrorNegocio("Datos de la oferta inválidos para su tipo (revise valor, lleva/paga o fechas)");
        throw e;
      }
      for (const a of o.alcance) {
        await c.query(
          "INSERT INTO oferta_alcance (id, oferta_id, producto_id, presentacion_id, categoria_id) VALUES ($1,$2,$3,$4,$5)",
          [uuidv7(), id, a.productoId ?? null, a.presentacionId ?? null, a.categoriaId ?? null],
        );
      }
      return id;
    });
    rep.code(201);
    return { id };
  });

  app.get("/central/ofertas", async (req) => {
    const f = z.object({ sucursalId: uuid.optional(), vigentes: z.enum(["1"]).optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT o.id, o.nombre, o.tipo, o.valor, o.lleva, o.paga, o.cantidad_minima AS "cantidadMinima",
              o.inicia_en AS "iniciaEn", o.termina_en AS "terminaEn", o.dias_semana AS "diasSemana",
              o.hora_desde AS "horaDesde", o.hora_hasta AS "horaHasta", o.activo,
              CASE WHEN o.sucursales IS NULL THEN '{Todas}'::text[]
                   ELSE (SELECT array_agg(s.nombre ORDER BY s.nombre) FROM sucursales s WHERE s.id = ANY(o.sucursales)) END AS sucursales,
              lp.nombre AS "nivelPrecio", o.unidades_maximas AS "unidadesMaximas",
              (SELECT COALESCE(SUM(d.descuento_otorgado), 0) FROM rpt_ofertas d WHERE d.oferta_id = o.id) AS "descuentoOtorgado",
              (SELECT COALESCE(jsonb_agg(jsonb_build_object('sucursal', s.nombre, 'vendidas', vv.unidades::text) ORDER BY s.nombre), '[]')
                 FROM v_oferta_vendidas vv JOIN sucursales s ON s.id = vv.sucursal_id WHERE vv.oferta_id = o.id) AS "vendidasPorSucursal"
         FROM ofertas o LEFT JOIN listas_precio lp ON lp.id = o.lista_precio_id
        WHERE o.empresa_id = $1
          AND ($2::uuid IS NULL OR o.sucursales IS NULL OR $2 = ANY(o.sucursales))
          AND ($3::boolean IS NOT TRUE OR (o.activo AND now() BETWEEN o.inicia_en AND o.termina_en))
        ORDER BY o.inicia_en DESC`,
      [empresaDe(req), f.sucursalId ?? null, f.vigentes === "1"],
    );
    return r.rows;
  });

  /**
   * Datos para decidir el precio de una oferta: precio normal, costo promedio
   * y lo que costó en la última compra normal y en la última compra en oferta
   * del proveedor (por presentación, sin ITBIS). Sirve para "ponlo al costo".
   */
  app.get("/central/ofertas/referencia/:presentacionId", async (req) => {
    const { presentacionId } = z.object({ presentacionId: uuid }).parse(req.params);
    const e = empresaDe(req);
    const p = (await pool.query(
      `SELECT pr.id, pr.factor::text AS factor, p.id AS "productoId", p.nombre, pr.nombre AS presentacion,
              i.tasa::text AS "tasaItbis", p.precio_incluye_impuesto AS "precioIncluyeItbis",
              (SELECT x.precio::text FROM precios x JOIN listas_precio lp ON lp.id = x.lista_precio_id AND lp.es_predeterminada
                WHERE x.presentacion_id = pr.id AND x.activo AND x.sucursal_id IS NULL) AS "precioNormal",
              COALESCE((SELECT SUM(ex.cantidad * ex.costo_promedio) / NULLIF(SUM(ex.cantidad), 0)
                          FROM existencias ex WHERE ex.producto_id = p.id AND ex.cantidad > 0), p.costo_promedio)::numeric(14,4)::text AS "costoPromedioUnidad"
         FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id JOIN impuestos i ON i.id = p.impuesto_id
        WHERE pr.id = $1 AND p.empresa_id = $2`,
      [presentacionId, e],
    )).rows[0];
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    const ultima = async (enOferta: boolean) => (await pool.query(
      `SELECT costo_unidad::text AS "costoUnidad", costo_regular_unidad::text AS "costoRegularUnidad", fecha_factura AS fecha, proveedor,
              unidades::text AS unidades
         FROM rpt_costos_compra WHERE producto_id = $1 AND en_oferta = $2 ORDER BY fecha_factura DESC, creado_en DESC LIMIT 1`,
      [p.productoId, enOferta],
    )).rows[0] ?? null;
    return { ...p, ultimaCompraNormal: await ultima(false), ultimaCompraOferta: await ultima(true) };
  });

  /** Activar/desactivar una oferta o cambiar sus sucursales. */
  app.patch("/central/ofertas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ activo: z.boolean().optional(), sucursales: z.array(uuid).min(1).nullable().optional() }).parse(req.body);
    const r = await pool.query(
      `UPDATE ofertas SET activo = COALESCE($2, activo),
              sucursales = CASE WHEN $4 THEN $3::uuid[] ELSE sucursales END
        WHERE id = $1 AND empresa_id = $5 RETURNING id, activo, sucursales`,
      [id, b.activo ?? null, b.sucursales ?? null, b.sucursales !== undefined, empresaDe(req)],
    );
    if (!r.rowCount) throw new ErrorNegocio("Oferta no encontrada", 404);
    return r.rows[0];
  });
}
