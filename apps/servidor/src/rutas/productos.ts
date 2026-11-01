import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { leerCodigoBalanza } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { contextoCaja, SQL_PRESENTACION, type PresentacionVenta } from "../contexto.js";
import { SQL_RESTANTES } from "../promociones.js";

/**
 * Versión del catálogo de una sucursal: cambia si cambia cualquier dato maestro
 * o si se venden unidades de una oferta con tope (así las demás cajas ven
 * cuántas quedan sin esperar). `$s` = parámetro con la sucursal.
 */
const sqlVersion = (s: string) => `(SELECT last_value FROM sync_version)::text || '-' || COALESCE((
    SELECT SUM(CASE WHEN v.tipo_documento IN ('E34','ANU') THEN -i.unidades_oferta ELSE i.unidades_oferta END)
      FROM venta_items i JOIN ventas v ON v.id = i.venta_id
     WHERE v.sucursal_id = ${s}
       AND i.oferta_id IN (SELECT id FROM ofertas WHERE unidades_maximas IS NOT NULL AND activo AND termina_en > now())), 0)::text`;

export async function rutasProductos(app: FastifyInstance) {
  /**
   * Catálogo completo para la memoria de la terminal: productos, códigos,
   * precios de los 3 niveles (ya resueltos para esta sucursal) y ofertas.
   * Con esto la terminal escanea y calcula sin consultar al servidor.
   * Se descarga al iniciar y cuando cambia `version`.
   */
  app.get("/cajas/:cajaId/catalogo/version", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query(`SELECT ${sqlVersion("$1")} AS version`, [ctx.sucursalId]);
    return { cajaId, version: r.rows[0].version };
  });

  /**
   * Foto de un producto. Antes viajaba dentro del catálogo (hasta 400 KB por producto, en cada descarga);
   * ahora el catálogo solo lleva su dirección y la caja la pide una vez: el navegador la guarda por versión.
   */
  app.get("/imagenes/:productoId", async (req, rep) => {
    const { productoId } = z.object({ productoId: z.string().uuid() }).parse(req.params);
    const r = await pool.query<{ imagen: string | null }>("SELECT imagen FROM productos WHERE id = $1", [productoId]);
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/s.exec(r.rows[0]?.imagen ?? "");
    if (!m) return rep.code(404).send({ error: "Sin imagen" });
    return rep.header("content-type", m[1]).header("cache-control", "public, max-age=31536000, immutable").send(Buffer.from(m[2], "base64"));
  });

  /** Solo las existencias (por presentación): la caja las repone tras cada venta sin bajar el catálogo completo. */
  app.get("/cajas/:cajaId/existencias", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query<{ id: string; e: string }>(
      `SELECT pr.id, (CASE WHEN p.tipo = 'COMBO'
                        THEN COALESCE((SELECT vc.cantidad FROM v_existencia_combos vc WHERE vc.combo_id = p.id AND vc.almacen_id = $2), 0)
                        ELSE COALESCE(ex.cantidad, 0) END / pr.factor)::numeric(14,3)::text AS e
         FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id AND p.activo
         LEFT JOIN existencias ex ON ex.producto_id = p.id AND ex.almacen_id = $2
        WHERE p.empresa_id = $1 AND (p.controla_stock OR p.tipo = 'COMBO')`, [ctx.empresaId, ctx.almacenId]);
    return Object.fromEntries(r.rows.map((x) => [x.id, x.e]));
  });

  app.get("/cajas/:cajaId/catalogo", async (req, rep) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query(
      `WITH niveles AS (SELECT id, nivel FROM listas_precio WHERE empresa_id = $1 AND nivel IS NOT NULL)
       SELECT ${sqlVersion("$2")} AS version,
              (SELECT nivel FROM listas_precio WHERE empresa_id = $1 AND es_predeterminada) AS "nivelPredeterminado",
              (SELECT COALESCE(jsonb_object_agg(nivel::text, descuento_pct::text), '{}'::jsonb) FROM listas_precio
                WHERE empresa_id = $1 AND nivel > 1 AND descuento_pct > 0 AND NOT es_predeterminada) AS "descuentosNivel",
              (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'presentacionId', pr.id, 'productoId', p.id, 'categoriaId', p.categoria_id, 'sku', p.sku,
                  'nombre', p.nombre, 'presentacion', pr.nombre, 'factor', pr.factor::text, 'esPesable', p.es_pesable,
                  'precioIncluyeItbis', p.precio_incluye_impuesto, 'tasaItbis', i.tasa::text,
                  'codigos', (SELECT COALESCE(jsonb_agg(cb.codigo), '[]') FROM codigos_barra cb WHERE cb.presentacion_id = pr.id AND cb.activo),
                  'imagen', CASE WHEN p.imagen LIKE 'data:%' THEN '/imagenes/' || p.id::text || '?v=' || p.version::text ELSE p.imagen END, 'categoria', cat.nombre, 'categoriaColor', cat.color, 'categoriaIcono', cat.icono,
                  'controlaStock', p.controla_stock OR p.tipo = 'COMBO', 'tipo', p.tipo,
                  'permiteSinExistencia', false,
                  'precioVariable', p.precio_variable, 'precioVariableMin', p.precio_variable_min::text,
                  'precioVariableMax', p.precio_variable_max::text, 'nombreCorto', p.nombre_corto,
                  'existencia', (CASE WHEN p.tipo = 'COMBO'
                                   THEN COALESCE((SELECT vc.cantidad FROM v_existencia_combos vc WHERE vc.combo_id = p.id AND vc.almacen_id = $3), 0)
                                   ELSE COALESCE(ex.cantidad, 0) END / pr.factor)::numeric(14,3)::text,
                  'minimo', (ps.stock_minimo / pr.factor)::numeric(14,3)::text,
                  'precios', (SELECT jsonb_object_agg(n.nivel, x.precio::text) FROM niveles n
                               CROSS JOIN LATERAL (SELECT precio FROM precios x
                                  WHERE x.presentacion_id = pr.id AND x.lista_precio_id = n.id AND x.activo
                                    AND (x.sucursal_id IS NULL OR (x.sucursal_id = $2 AND (SELECT precios_por_sucursal FROM empresas WHERE id = $1)))
                                  ORDER BY x.sucursal_id NULLS LAST LIMIT 1) x)
                ) ORDER BY p.nombre, pr.factor), '[]')
                 FROM presentaciones pr
                 JOIN productos p ON p.id = pr.producto_id AND p.activo
                 JOIN impuestos i ON i.id = p.impuesto_id
                 LEFT JOIN categorias cat ON cat.id = p.categoria_id
                 LEFT JOIN existencias ex ON ex.producto_id = p.id AND ex.almacen_id = $3
                 LEFT JOIN producto_sucursal ps ON ps.producto_id = p.id AND ps.sucursal_id = $2
                WHERE p.empresa_id = $1
                  AND NOT EXISTS (SELECT 1 FROM producto_sucursal ps WHERE ps.producto_id = p.id AND ps.sucursal_id = $2 AND NOT ps.activo)
              ) AS productos,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', o.id, 'nombre', o.nombre, 'tipo', o.tipo, 'valor', o.valor::text, 'lleva', o.lleva, 'paga', o.paga,
                  'cantidadMinima', o.cantidad_minima::text, 'iniciaEn', o.inicia_en, 'terminaEn', o.termina_en,
                  'diasSemana', o.dias_semana, 'horaDesde', o.hora_desde::text, 'horaHasta', o.hora_hasta::text,
                  'prioridad', o.prioridad, 'nivel', lp.nivel, 'restantes', ${SQL_RESTANTES},
                  'alcance', (SELECT jsonb_agg(jsonb_build_object('productoId', a.producto_id, 'presentacionId', a.presentacion_id, 'categoriaId', a.categoria_id))
                                FROM oferta_alcance a WHERE a.oferta_id = o.id AND a.activo))), '[]')
                 FROM ofertas o LEFT JOIN listas_precio lp ON lp.id = o.lista_precio_id
                WHERE o.empresa_id = $1 AND o.activo AND o.termina_en > now()
                  AND (o.sucursales IS NULL OR $2::uuid = ANY(o.sucursales))
              ) AS ofertas`,
      [ctx.empresaId, ctx.sucursalId, ctx.almacenId],
    );
    rep.header("cache-control", "no-store");
    return r.rows[0];
  });

  /** Lectura de código de barras (incluye etiquetas de balanza). */
  app.get("/cajas/:cajaId/productos/codigo/:codigo", async (req) => {
    const { cajaId, codigo } = z.object({ cajaId: z.string().uuid(), codigo: z.string().min(1).max(30) }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const args = [ctx.empresaId, ctx.sucursalId, ctx.almacenId, null];

    const r = await pool.query<PresentacionVenta>(
      `${SQL_PRESENTACION} AND pr.id = (SELECT presentacion_id FROM codigos_barra WHERE empresa_id = $1 AND codigo = $5 AND activo)`,
      [...args, codigo],
    );
    if (r.rowCount) return { ...r.rows[0], cantidadSugerida: "1" };

    // ¿Es una etiqueta de balanza? El código de 5 dígitos se registra como código de barras del producto.
    const balanza = leerCodigoBalanza(codigo, "PESO");
    if (balanza) {
      const rb = await pool.query<PresentacionVenta>(
        `${SQL_PRESENTACION} AND p.es_pesable AND pr.id = (SELECT presentacion_id FROM codigos_barra WHERE empresa_id = $1 AND codigo = $5 AND activo)`,
        [...args, balanza.codigoProducto],
      );
      if (rb.rowCount) return { ...rb.rows[0], cantidadSugerida: balanza.valor.toFixed(3) };
    }
    throw new ErrorNegocio(`Código ${codigo} no registrado`, 404);
  });

  /** Búsqueda por nombre o SKU (tecla de búsqueda en la caja). */
  app.get("/cajas/:cajaId/productos", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query<PresentacionVenta>(
      `${SQL_PRESENTACION} AND (p.nombre ILIKE '%' || $5 || '%' OR p.sku ILIKE $5 || '%')
       ORDER BY similarity(p.nombre, $5) DESC, p.nombre, pr.factor LIMIT 30`,
      [ctx.empresaId, ctx.sucursalId, ctx.almacenId, null, q],
    );
    return r.rows;
  });
}
