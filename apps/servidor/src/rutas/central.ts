import { sucursalesDe } from "../sesion.js";
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
    const r = await pool.query(
      "SELECT * FROM rpt_resumen_sucursales WHERE empresa_id = $1 AND ($2::uuid[] IS NULL OR sucursal_id = ANY($2)) ORDER BY sucursal",
      [empresaDe(req), sucursalesDe(req)],
    );
    return r.rows;
  });

  /**
   * Lo que pide atención hoy, para el Resumen: servidores caídos, cierres con
   * diferencia, comprobantes rechazados, certificado, secuencias, correos
   * que no salieron. Más la venta de ayer y la del mismo día de la semana pasada.
   */
  /** Venta de un periodo (hoy, ayer, esta semana, semana pasada, este mes) y la del periodo equivalente anterior. */
  app.get("/central/resumen/periodo", async (req) => {
    const { periodo, sucursalId } = z.object({ periodo: z.enum(["hoy", "ayer", "semana", "semanaPasada", "mes"]).default("hoy"), sucursalId: z.string().uuid().optional() }).parse(req.query);
    const r = await pool.query(
      `WITH h AS (SELECT (now() AT TIME ZONE 'America/Santo_Domingo')::date AS hoy),
            r AS (SELECT hoy,
                    CASE $3 WHEN 'hoy' THEN hoy WHEN 'ayer' THEN hoy - 1 WHEN 'semana' THEN date_trunc('week', hoy)::date
                            WHEN 'semanaPasada' THEN date_trunc('week', hoy)::date - 7 ELSE date_trunc('month', hoy)::date END AS desde,
                    CASE $3 WHEN 'hoy' THEN hoy WHEN 'ayer' THEN hoy - 1 WHEN 'semana' THEN hoy
                            WHEN 'semanaPasada' THEN date_trunc('week', hoy)::date - 1 ELSE hoy END AS hasta FROM h),
            a AS (SELECT desde, hasta,
                    CASE WHEN $3 = 'mes' THEN (desde - interval '1 month')::date WHEN $3 IN ('semana','semanaPasada') THEN desde - 7 ELSE desde - 1 END AS pdesde,
                    CASE WHEN $3 = 'mes' THEN LEAST((hasta - interval '1 month')::date, (desde - 1)) WHEN $3 IN ('semana','semanaPasada') THEN hasta - 7 ELSE hasta - 1 END AS phasta FROM r)
       SELECT a.desde::text, a.hasta::text, a.pdesde::text, a.phasta::text,
              COALESCE(SUM(v.venta_total) FILTER (WHERE v.fecha BETWEEN a.desde AND a.hasta), 0)::text AS venta,
              COALESCE(SUM(v.transacciones) FILTER (WHERE v.fecha BETWEEN a.desde AND a.hasta), 0)::text AS transacciones,
              COALESCE(SUM(v.venta_total) FILTER (WHERE v.fecha BETWEEN a.pdesde AND a.phasta), 0)::text AS "ventaAnterior"
         FROM a LEFT JOIN rpt_ventas_sucursal v ON v.sucursal_id IN (SELECT id FROM sucursales WHERE empresa_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2)) AND ($4::uuid IS NULL OR id = $4))
                                              AND v.fecha >= a.pdesde
        GROUP BY a.desde, a.hasta, a.pdesde, a.phasta`,
      [empresaDe(req), sucursalesDe(req), periodo, sucursalId ?? null],
    );
    return { periodo, ...r.rows[0] };
  });

  app.get("/central/resumen/atencion", async (req) => {
    const e = empresaDe(req);
    const suc = sucursalesDe(req);
    const p = [e, suc];
    const enSuc = (col: string) => `($2::uuid[] IS NULL OR ${col} = ANY($2))`;
    const hoyRd = "(now() AT TIME ZONE 'America/Santo_Domingo')::date";
    const [comparar, cierres, ecf, incidentes, cert, secuencias, correos, vencimientos] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(venta_total) FILTER (WHERE fecha = ${hoyRd} - 1), 0) AS ayer,
                COALESCE(SUM(venta_total) FILTER (WHERE fecha = ${hoyRd} - 7), 0) AS "semanaPasada",
                COALESCE(SUM(transacciones) FILTER (WHERE fecha = ${hoyRd} - 1), 0) AS "transaccionesAyer"
           FROM rpt_ventas_sucursal v JOIN sucursales s ON s.id = v.sucursal_id
          WHERE s.empresa_id = $1 AND ${enSuc("v.sucursal_id")} AND v.fecha >= ${hoyRd} - 7`, p),
      pool.query(
        `SELECT c.turno_id AS id, c.sucursal, c.caja, c.cajero, c.cerrado_en AS "cerradoEn", c.diferencia
           FROM rpt_cierres_caja c JOIN sucursales s ON s.id = c.sucursal_id
          WHERE s.empresa_id = $1 AND ${enSuc("c.sucursal_id")} AND c.fecha >= ${hoyRd} - 1
          ORDER BY c.cerrado_en DESC LIMIT 50`, p),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE d.estado = 'RECHAZADO' AND d.creado_en > now() - interval '7 days')::int AS rechazados,
                COUNT(*) FILTER (WHERE d.estado IN ('PENDIENTE','CONTINGENCIA','EN_PROCESO','ENVIADO') AND d.creado_en < now() - interval '1 hour')::int AS atrasados
           FROM ecf_documentos d JOIN sucursales s ON s.id = d.sucursal_id WHERE s.empresa_id = $1 AND ${enSuc("d.sucursal_id")}`, p),
      pool.query(
        `SELECT i.id, i.tipo, i.titulo, i.desde, i.hasta FROM incidentes i
          WHERE i.empresa_id = $1 AND i.tipo <> 'PRUEBA' AND (i.hasta IS NULL OR (i.resuelto_en IS NULL AND i.desde > now() - interval '3 days'))
            AND ($2::uuid[] IS NULL OR i.sucursal_id IS NULL OR i.sucursal_id = ANY($2))
          ORDER BY (i.hasta IS NULL) DESC, i.desde DESC LIMIT 10`, p),
      pool.query(
        `SELECT (SELECT vence FROM certificados_digitales WHERE empresa_id = $1 AND activo) AS vence,
                (SELECT COUNT(*)::int FROM sucursales s WHERE s.empresa_id = $1 AND s.activo AND s.tipo <> 'ALMACEN'
                    AND NOT s.certificado_habilitado AND ${enSuc("s.id")}) AS "sinActivar"`, p),
      pool.query(
        `SELECT q.sucursal, q.tipo_ecf AS tipo, COALESCE(q.disponibles, 0) AS disponibles, COALESCE(cf.alerta_restantes, 500) AS alerta
           FROM rpt_ecf_secuencias q LEFT JOIN configuracion_fiscal cf ON cf.empresa_id = q.empresa_id
          WHERE q.empresa_id = $1 AND ${enSuc("q.sucursal_id")} AND q.tipo_ecf IN ('E31','E32','E34')
            AND COALESCE(q.disponibles, 0) <= COALESCE(cf.alerta_restantes, 500)
          ORDER BY 3 LIMIT 10`, p),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM correos_enviados WHERE empresa_id = $1 AND estado = 'ERROR' AND creado_en > now() - interval '3 days'`, [e]),
      // Lotes vencidos que siguen en existencia y los que vencen en 15 días
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE v.dias_para_vencer < 0)::int AS vencidos,
                COALESCE(SUM(v.valor_al_costo) FILTER (WHERE v.dias_para_vencer < 0), 0)::text AS "valorVencido",
                COUNT(*) FILTER (WHERE v.dias_para_vencer BETWEEN 0 AND 15)::int AS proximos
           FROM rpt_proximos_vencer v JOIN sucursales s ON s.id = v.sucursal_id
          WHERE s.empresa_id = $1 AND ${enSuc("v.sucursal_id")}`, p),
    ]);
    return {
      ...comparar.rows[0],
      cierres: cierres.rows,
      ecf: ecf.rows[0],
      incidentes: incidentes.rows,
      certificado: cert.rows[0],
      secuencias: secuencias.rows,
      correosConError: correos.rows[0].n,
      vencimientos: vencimientos.rows[0],
    };
  });

  /** Inventario consolidado: una fila por producto con la existencia de cada sucursal. */
  app.get("/central/inventario", async (req) => {
    const f = z
      .object({ q: z.string().trim().max(60).optional(), categoriaId: uuid.optional(), soloBajoMinimo: z.enum(["1"]).optional() })
      .parse(req.query);
    // Todos los productos que llevan inventario, aunque todavía no tengan existencia (aparecen en 0)
    const r = await pool.query(
      `SELECT p.id AS "productoId", p.sku, p.nombre,
              SUM(x.cantidad) AS "existenciaTotal", SUM(x.valor) AS "valorTotal",
              jsonb_object_agg(s.nombre, jsonb_build_object(
                  'sucursalId', s.id, 'cantidad', x.cantidad, 'valor', x.valor,
                  'minimo', ps.stock_minimo, 'bajoMinimo', x.cantidad <= COALESCE(ps.stock_minimo, 0))) AS sucursales
         FROM productos p
         CROSS JOIN sucursales s
         LEFT JOIN producto_sucursal ps ON ps.producto_id = p.id AND ps.sucursal_id = s.id
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(e.cantidad), 0) AS cantidad, COALESCE(ROUND(SUM(e.cantidad * e.costo_promedio), 2), 0) AS valor
             FROM existencias e JOIN almacenes a ON a.id = e.almacen_id
            WHERE e.producto_id = p.id AND a.sucursal_id = s.id) x
        WHERE p.empresa_id = $1 AND p.activo AND p.controla_stock AND s.empresa_id = $1 AND s.activo
          AND ($2::text IS NULL OR p.nombre ILIKE '%' || $2 || '%' OR p.sku ILIKE $2 || '%')
          AND ($3::uuid IS NULL OR p.categoria_id = $3)
          AND ($5::uuid[] IS NULL OR s.id = ANY($5))
        GROUP BY p.id, p.sku, p.nombre
       HAVING $4::boolean IS NOT TRUE OR BOOL_OR(x.cantidad <= COALESCE(ps.stock_minimo, 0))
        ORDER BY p.nombre LIMIT 500`,
      [empresaDe(req), f.q ?? null, f.categoriaId ?? null, f.soloBajoMinimo === "1", sucursalesDe(req)],
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
    /** Se muestra en la pantalla de espera del verificador de precios */
    mostrarEnVerificador: z.boolean().default(true),
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
                                dias_semana, hora_desde, hora_hasta, sucursales, lista_precio_id, prioridad, unidades_maximas, mostrar_en_verificador)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [id, empresaId, o.nombre, o.tipo, o.valor ?? null, o.lleva ?? null, o.paga ?? null, o.cantidadMinima,
           o.iniciaEn, o.terminaEn, o.diasSemana ?? null, o.horaDesde ?? null, o.horaHasta ?? null,
           o.sucursales, lista, o.prioridad, o.unidadesMaximas, o.mostrarEnVerificador],
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
              lp.nombre AS "nivelPrecio", lp.nivel AS "nivel", o.unidades_maximas AS "unidadesMaximas",
              o.mostrar_en_verificador AS "mostrarEnVerificador", o.prioridad, o.sucursales AS "sucursalesIds",
              (SELECT COALESCE(jsonb_agg(jsonb_build_object('productoId', COALESCE(a.producto_id, (SELECT pr.producto_id FROM presentaciones pr WHERE pr.id = a.presentacion_id)),
                                                            'presentacionId', a.presentacion_id, 'categoriaId', a.categoria_id)), '[]')
                 FROM oferta_alcance a WHERE a.oferta_id = o.id AND a.activo) AS alcance,
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

  /** Editar una oferta completa (mismos datos que al crearla). Lo ya vendido en oferta no cambia. */
  app.put("/central/ofertas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const o = OfertaSchema.parse(req.body);
    const empresaId = empresaDe(req);
    await enTransaccion(async (c) => {
      const ex = await c.query("SELECT 1 FROM ofertas WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [id, empresaId]);
      if (!ex.rowCount) throw new ErrorNegocio("Oferta no encontrada", 404);
      const lista = o.nivelPrecio
        ? (await c.query("SELECT id FROM listas_precio WHERE empresa_id = $1 AND nivel = $2", [empresaId, o.nivelPrecio])).rows[0]?.id
        : null;
      try {
        await c.query(
          `UPDATE ofertas SET nombre = $3, tipo = $4, valor = $5, lleva = $6, paga = $7, cantidad_minima = $8, inicia_en = $9, termina_en = $10,
                  dias_semana = $11, hora_desde = $12, hora_hasta = $13, sucursales = $14, lista_precio_id = $15, prioridad = $16,
                  unidades_maximas = $17, mostrar_en_verificador = $18
            WHERE id = $1 AND empresa_id = $2`,
          [id, empresaId, o.nombre, o.tipo, o.valor ?? null, o.lleva ?? null, o.paga ?? null, o.cantidadMinima,
           o.iniciaEn, o.terminaEn, o.diasSemana ?? null, o.horaDesde ?? null, o.horaHasta ?? null,
           o.sucursales, lista, o.prioridad, o.unidadesMaximas, o.mostrarEnVerificador],
        );
      } catch (e: any) {
        if (e.code === "23514") throw new ErrorNegocio("Datos de la oferta inválidos para su tipo (revise valor, lleva/paga o fechas)");
        throw e;
      }
      // El alcance se reemplaza: lo anterior se desactiva (así también baja a las sucursales)
      await c.query("UPDATE oferta_alcance SET activo = false WHERE oferta_id = $1 AND activo", [id]);
      for (const a of o.alcance) {
        await c.query(
          "INSERT INTO oferta_alcance (id, oferta_id, producto_id, presentacion_id, categoria_id) VALUES ($1,$2,$3,$4,$5)",
          [uuidv7(), id, a.productoId ?? null, a.presentacionId ?? null, a.categoriaId ?? null],
        );
      }
    });
    return { id };
  });

  /** Activar/desactivar una oferta, mostrarla u ocultarla en el verificador o cambiar sus sucursales. */
  app.patch("/central/ofertas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ activo: z.boolean().optional(), mostrarEnVerificador: z.boolean().optional(), sucursales: z.array(uuid).min(1).nullable().optional() }).parse(req.body);
    const r = await pool.query(
      `UPDATE ofertas SET activo = COALESCE($2, activo),
              mostrar_en_verificador = COALESCE($6, mostrar_en_verificador),
              sucursales = CASE WHEN $4 THEN $3::uuid[] ELSE sucursales END
        WHERE id = $1 AND empresa_id = $5 RETURNING id, activo, sucursales, mostrar_en_verificador AS "mostrarEnVerificador"`,
      [id, b.activo ?? null, b.sucursales ?? null, b.sucursales !== undefined, empresaDe(req), b.mostrarEnVerificador ?? null],
    );
    if (!r.rowCount) throw new ErrorNegocio("Oferta no encontrada", 404);
    return r.rows[0];
  });
}
