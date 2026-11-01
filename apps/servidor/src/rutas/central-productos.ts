import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";

/**
 * Módulo de productos (Administración central).
 *
 * El formulario guarda todo de una vez: datos generales, presentaciones con sus
 * códigos y precios (3 niveles), parámetros por sucursal, proveedores y
 * componentes del combo. La existencia NO se edita aquí: se consulta por
 * sucursal y se corrige con un ajuste (queda en el kardex).
 */
const uuid = z.string().uuid();
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
const montoCosto = z.string().regex(/^\d+(\.\d{1,4})?$/, "Costo inválido");
const cant = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida");

const ProductoSchema = z
  .object({
    sku: z.string().trim().min(1).max(30),
    nombre: z.string().trim().min(2).max(120),
    nombreCorto: z.string().trim().max(32).nullable().default(null),
    marca: z.string().trim().max(60).nullable().default(null),
    categoriaId: uuid.nullable().default(null),
    tipo: z.enum(["INVENTARIABLE", "SERVICIO", "COMBO"]).default("INVENTARIABLE"),
    impuestoId: uuid,
    precioIncluyeItbis: z.boolean().default(true),
    esPesable: z.boolean().default(false),
    costoReferencia: montoCosto.default("0"),
    permiteSinExistencia: z.boolean().default(true),
    precioVariable: z.boolean().default(false),
    precioVariableMin: monto.nullable().default(null),
    precioVariableMax: monto.nullable().default(null),
    controlaLotes: z.boolean().default(false),
    volumenMl: z.number().int().positive().nullable().default(null),
    gradoAlcohol: z.number().min(0).max(100).nullable().default(null),
    imagen: z.string().regex(/^(https?:\/\/|data:image\/)/).max(400000, "La imagen es muy pesada").nullable().default(null),
    activo: z.boolean().default(true),
    presentaciones: z
      .array(z.object({
        id: uuid.optional(),
        nombre: z.string().trim().min(1).max(40),
        factor: cant.refine((v) => Number(v) > 0, "El factor debe ser mayor que cero"),
        codigos: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
        precios: z.record(z.enum(["1", "2", "3"]), monto.nullable()).default({}),
        /** % de ganancia sobre el costo con que se calculó cada precio (null = fijado por monto) */
        porcentajes: z.record(z.enum(["1", "2", "3"]), z.number().min(0).max(1000).nullable()).default({}),
        /** Precios 2 y 3: «PRECIO1» = el % es un descuento sobre el precio 1 (se recalcula solo); por omisión, sobre el costo */
        bases: z.record(z.enum(["2", "3"]), z.enum(["COSTO", "PRECIO1"])).default({}),
      }))
      .min(1, "Agregue al menos una presentación"),
    sucursales: z
      .array(z.object({ sucursalId: uuid, stockMinimo: cant.default("0"), stockMaximo: cant.nullable().default(null), ubicacion: z.string().max(30).nullable().default(null), activo: z.boolean().default(true) }))
      .default([]),
    proveedores: z
      .array(z.object({ proveedorId: uuid, codigoProveedor: z.string().max(40).nullable().default(null), ultimoCosto: montoCosto.nullable().default(null), principal: z.boolean().default(false) }))
      .default([]),
    componentes: z.array(z.object({ productoId: uuid, cantidad: cant })).default([]),
  })
  .refine((p) => !p.precioVariable || (p.precioVariableMin && p.precioVariableMax && Number(p.precioVariableMax) >= Number(p.precioVariableMin)),
    "Indique el rango del precio variable (mínimo y máximo)")
  .refine((p) => p.tipo !== "COMBO" || p.componentes.length > 0, "Un combo necesita al menos un componente")
  .refine((p) => p.proveedores.filter((x) => x.principal).length <= 1, "Solo puede haber un proveedor principal")
  .refine((p) => new Set(p.presentaciones.flatMap((x) => x.codigos)).size === p.presentaciones.flatMap((x) => x.codigos).length,
    "Hay códigos de barra repetidos");

type Producto = z.infer<typeof ProductoSchema>;

async function guardar(c: PoolClient, empresaId: string, usuarioId: string | null, id: string, p: Producto, nuevo: boolean) {
  // Códigos de barra únicos en toda la empresa
  const codigos = p.presentaciones.flatMap((x) => x.codigos);
  if (codigos.length) {
    const dup = await c.query<{ codigo: string; nombre: string }>(
      `SELECT cb.codigo, pr2.nombre FROM codigos_barra cb
         JOIN presentaciones ps ON ps.id = cb.presentacion_id JOIN productos pr2 ON pr2.id = ps.producto_id
        WHERE cb.empresa_id = $1 AND cb.activo AND cb.codigo = ANY($2) AND ps.producto_id <> $3`,
      [empresaId, codigos, id],
    );
    if (dup.rowCount) throw new ErrorNegocio(`El código ${dup.rows[0].codigo} ya pertenece a "${dup.rows[0].nombre}"`, 409);
  }

  const valores = [
    id, empresaId, p.sku, p.nombre, p.nombreCorto, p.marca, p.categoriaId, p.tipo, p.impuestoId, p.precioIncluyeItbis,
    p.esPesable, p.esPesable ? "LB" : "UND", p.tipo === "INVENTARIABLE", p.costoReferencia, p.permiteSinExistencia,
    p.precioVariable, p.precioVariableMin, p.precioVariableMax, p.controlaLotes, p.volumenMl,
    p.gradoAlcohol, p.imagen, p.activo,
  ];
  try {
    if (nuevo) {
      await c.query(
        `INSERT INTO productos (id, empresa_id, sku, nombre, nombre_corto, marca, categoria_id, tipo, impuesto_id,
                                precio_incluye_impuesto, es_pesable, unidad_base, controla_stock, costo_promedio,
                                permite_sin_existencia, precio_variable, precio_variable_min, precio_variable_max,
                                controla_lotes, volumen_ml, grado_alcohol, imagen, activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        valores,
      );
    } else {
      const r = await c.query(
        `UPDATE productos SET sku=$3, nombre=$4, nombre_corto=$5, marca=$6, categoria_id=$7, tipo=$8, impuesto_id=$9,
                precio_incluye_impuesto=$10, es_pesable=$11, unidad_base=$12, controla_stock=$13,
                costo_promedio = CASE WHEN EXISTS (SELECT 1 FROM existencias WHERE producto_id = $1 AND cantidad <> 0) THEN costo_promedio ELSE $14 END,
                permite_sin_existencia=$15, precio_variable=$16, precio_variable_min=$17, precio_variable_max=$18,
                controla_lotes=$19, volumen_ml=$20, grado_alcohol=$21, imagen=$22, activo=$23
          WHERE id = $1 AND empresa_id = $2`,
        valores,
      );
      if (!r.rowCount) throw new ErrorNegocio("Producto no encontrado", 404);
    }
  } catch (e: any) {
    if (e.code === "23505") throw new ErrorNegocio(`Ya existe un producto con el SKU ${p.sku}`, 409);
    throw e;
  }

  // Presentaciones, códigos y precios
  const listas = (await c.query<{ id: string; nivel: number }>("SELECT id, nivel FROM listas_precio WHERE empresa_id = $1 AND nivel IS NOT NULL", [empresaId])).rows;
  const existentes = (await c.query<{ id: string }>("SELECT id FROM presentaciones WHERE producto_id = $1", [id])).rows.map((r) => r.id);
  const conservadas = new Set<string>();
  for (const [i, pr] of p.presentaciones.entries()) {
    const prId = pr.id && existentes.includes(pr.id) ? pr.id : uuidv7();
    conservadas.add(prId);
    await c.query(
      `INSERT INTO presentaciones (id, producto_id, nombre, factor, es_principal) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, factor = EXCLUDED.factor, es_principal = EXCLUDED.es_principal`,
      [prId, id, pr.nombre, pr.factor, i === 0],
    );
    // Códigos: los quitados se desactivan (así la baja viaja a las sucursales)
    await c.query("UPDATE codigos_barra SET activo = false WHERE presentacion_id = $1 AND activo AND NOT (codigo = ANY($2))", [prId, pr.codigos]);
    for (const cod of pr.codigos) {
      await c.query(
        `INSERT INTO codigos_barra (codigo, empresa_id, presentacion_id) VALUES ($1,$2,$3)
         ON CONFLICT (empresa_id, codigo) DO UPDATE SET presentacion_id = EXCLUDED.presentacion_id, activo = true`,
        [cod, empresaId, prId],
      );
    }
    for (const lp of listas) {
      const k = String(lp.nivel) as "1" | "2" | "3";
      // Descuento sobre el precio 1: el precio lo calcula el servidor (así también se respeta si cambia el precio 1 por otra vía)
      const sobrePrecio1 = k !== "1" && pr.bases[k as "2" | "3"] === "PRECIO1" && pr.porcentajes[k] != null && pr.porcentajes[k]! <= 100;
      const precio1 = pr.precios["1"];
      const nuevoPrecio = sobrePrecio1
        ? (precio1 ? (Math.round(Number(precio1) * (1 - pr.porcentajes[k]! / 100) * 100) / 100).toFixed(2) : null)
        : pr.precios[k];
      const pct = nuevoPrecio ? pr.porcentajes[k] ?? null : null;
      const base = sobrePrecio1 && nuevoPrecio ? "PRECIO1" : "COSTO";
      const actual = (await c.query<{ precio: string; activo: boolean; porcentaje: string | null; base: string }>(
        "SELECT precio, activo, porcentaje, base FROM precios WHERE lista_precio_id = $1 AND presentacion_id = $2 AND sucursal_id IS NULL", [lp.id, prId],
      )).rows[0];
      const anterior = actual?.activo ? actual.precio : null;
      const mismoPrecio = (nuevoPrecio ?? null) === anterior || (!!nuevoPrecio && !!anterior && Number(nuevoPrecio) === Number(anterior));
      const mismoPct = (actual?.porcentaje == null ? null : Number(actual.porcentaje)) === pct;
      const mismaBase = (actual?.base ?? "COSTO") === base;
      if (mismoPrecio && mismoPct && mismaBase) continue;
      if (nuevoPrecio) {
        await c.query(
          `INSERT INTO precios (id, lista_precio_id, presentacion_id, precio, porcentaje, base) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (lista_precio_id, presentacion_id, COALESCE(sucursal_id, '00000000-0000-0000-0000-000000000000'))
           DO UPDATE SET precio = EXCLUDED.precio, porcentaje = EXCLUDED.porcentaje, base = EXCLUDED.base, activo = true`,
          [uuidv7(), lp.id, prId, nuevoPrecio, pct, base],
        );
      } else {
        await c.query("UPDATE precios SET activo = false WHERE lista_precio_id = $1 AND presentacion_id = $2 AND sucursal_id IS NULL", [lp.id, prId]);
      }
      if (mismoPrecio) continue; // solo cambió la forma (monto ↔ %): no es un cambio de precio
      await c.query(
        `INSERT INTO historial_precios (id, presentacion_id, lista_precio_id, precio_anterior, precio_nuevo, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuidv7(), prId, lp.id, anterior, nuevoPrecio ?? null, usuarioId],
      );
    }
  }
  // Presentaciones eliminadas: se quitan sus códigos y precios (no se borran: pueden estar en ventas)
  for (const viejo of existentes.filter((x) => !conservadas.has(x))) {
    await c.query("UPDATE codigos_barra SET activo = false WHERE presentacion_id = $1", [viejo]);
    await c.query("UPDATE precios SET activo = false WHERE presentacion_id = $1", [viejo]);
  }

  // Parámetros por sucursal
  for (const s of p.sucursales) {
    await c.query(
      `INSERT INTO producto_sucursal (producto_id, sucursal_id, stock_minimo, stock_maximo, ubicacion, activo)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (producto_id, sucursal_id) DO UPDATE SET stock_minimo = $3, stock_maximo = $4, ubicacion = $5, activo = $6`,
      [id, s.sucursalId, s.stockMinimo, s.stockMaximo, s.ubicacion, s.activo],
    );
  }

  // Proveedores
  await c.query("UPDATE producto_proveedores SET activo = false, principal = false WHERE producto_id = $1 AND NOT (proveedor_id = ANY($2::uuid[]))",
    [id, p.proveedores.map((x) => x.proveedorId)]);
  await c.query("UPDATE producto_proveedores SET principal = false WHERE producto_id = $1", [id]);
  for (const pv of p.proveedores) {
    await c.query(
      `INSERT INTO producto_proveedores (producto_id, proveedor_id, codigo_proveedor, ultimo_costo, principal, activo)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (producto_id, proveedor_id) DO UPDATE SET codigo_proveedor = $3, ultimo_costo = COALESCE($4, producto_proveedores.ultimo_costo), principal = $5, activo = true`,
      [id, pv.proveedorId, pv.codigoProveedor, pv.ultimoCosto, pv.principal],
    );
  }

  // Componentes del combo (se reemplazan completos)
  await c.query("DELETE FROM producto_componentes WHERE combo_id = $1", [id]);
  if (p.tipo === "COMBO") {
    for (const comp of p.componentes) {
      if (comp.productoId === id) throw new ErrorNegocio("Un combo no puede contenerse a sí mismo");
      await c.query("INSERT INTO producto_componentes (combo_id, componente_id, cantidad) VALUES ($1,$2,$3)", [id, comp.productoId, comp.cantidad]);
    }
  }
}

export async function rutasCentralProductos(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.safeParse(req.headers["x-usuario-id"]).data ?? null;

  /** Lista para la pantalla de productos. */
  app.get("/central/productos", async (req) => {
    const f = z.object({ q: z.string().trim().max(60).optional(), categoriaId: uuid.optional(), estado: z.enum(["activos", "inactivos", "todos"]).default("activos") }).parse(req.query);
    const r = await pool.query(
      `SELECT p.id, p.sku, p.nombre, p.marca, p.tipo, p.activo, p.imagen IS NOT NULL AS "tieneImagen",
              c.nombre AS categoria, c.color AS "categoriaColor",
              (SELECT x.precio FROM presentaciones pr JOIN precios x ON x.presentacion_id = pr.id AND x.activo AND x.sucursal_id IS NULL
                 JOIN listas_precio lp ON lp.id = x.lista_precio_id AND lp.es_predeterminada
                WHERE pr.producto_id = p.id ORDER BY pr.es_principal DESC, pr.factor LIMIT 1) AS precio,
              (SELECT COUNT(*) FROM presentaciones pr WHERE pr.producto_id = p.id) AS presentaciones,
              COALESCE((SELECT SUM(e.cantidad) FROM existencias e WHERE e.producto_id = p.id), 0) AS existencia,
              CASE WHEN p.tipo = 'COMBO'
                   THEN (SELECT COALESCE(SUM(pc.cantidad * cp.costo_promedio), 0) FROM producto_componentes pc JOIN productos cp ON cp.id = pc.componente_id WHERE pc.combo_id = p.id)
                   ELSE COALESCE((SELECT SUM(e.cantidad * e.costo_promedio) / NULLIF(SUM(e.cantidad), 0)
                                    FROM existencias e WHERE e.producto_id = p.id AND e.cantidad > 0), p.costo_promedio) END AS costo
         FROM productos p LEFT JOIN categorias c ON c.id = p.categoria_id
        WHERE p.empresa_id = $1
          AND ($2::text IS NULL OR p.nombre ILIKE '%' || $2 || '%' OR p.sku ILIKE $2 || '%' OR p.marca ILIKE $2 || '%'
               OR EXISTS (SELECT 1 FROM codigos_barra cb JOIN presentaciones pr ON pr.id = cb.presentacion_id
                           WHERE pr.producto_id = p.id AND cb.codigo = $2))
          AND ($3::uuid IS NULL OR p.categoria_id = $3)
          AND ($4 = 'todos' OR p.activo = ($4 = 'activos'))
        ORDER BY p.nombre LIMIT 500`,
      [empresaDe(req), f.q || null, f.categoriaId ?? null, f.estado],
    );
    return r.rows;
  });

  /** Ficha completa para editar. */
  app.get("/central/productos/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const e = empresaDe(req);
    const p = (await pool.query(
      `SELECT id, sku, nombre, nombre_corto AS "nombreCorto", marca, categoria_id AS "categoriaId", tipo, impuesto_id AS "impuestoId",
              precio_incluye_impuesto AS "precioIncluyeItbis", es_pesable AS "esPesable",
              CASE WHEN tipo = 'COMBO' THEN (SELECT COALESCE(SUM(pc.cantidad * cp.costo_promedio), 0)::numeric(14,4)
                                               FROM producto_componentes pc JOIN productos cp ON cp.id = pc.componente_id WHERE pc.combo_id = productos.id)
                   ELSE costo_promedio END AS "costoReferencia",
              permite_sin_existencia AS "permiteSinExistencia", precio_variable AS "precioVariable",
              precio_variable_min AS "precioVariableMin", precio_variable_max AS "precioVariableMax",
              controla_lotes AS "controlaLotes", volumen_ml AS "volumenMl",
              grado_alcohol::float AS "gradoAlcohol", imagen, activo
         FROM productos WHERE id = $1 AND empresa_id = $2`,
      [id, e],
    )).rows[0];
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    const [pres, sucs, provs, comps, hist] = await Promise.all([
      pool.query(
        `SELECT pr.id, pr.nombre, pr.factor::text AS factor,
                COALESCE((SELECT jsonb_agg(codigo ORDER BY codigo) FROM codigos_barra WHERE presentacion_id = pr.id AND activo), '[]') AS codigos,
                COALESCE((SELECT jsonb_object_agg(lp.nivel, x.precio::text) FROM precios x JOIN listas_precio lp ON lp.id = x.lista_precio_id
                           WHERE x.presentacion_id = pr.id AND x.activo AND x.sucursal_id IS NULL AND lp.nivel IS NOT NULL), '{}') AS precios,
                COALESCE((SELECT jsonb_object_agg(lp.nivel, x.porcentaje::float) FROM precios x JOIN listas_precio lp ON lp.id = x.lista_precio_id
                           WHERE x.presentacion_id = pr.id AND x.activo AND x.sucursal_id IS NULL AND lp.nivel IS NOT NULL AND x.porcentaje IS NOT NULL), '{}') AS porcentajes,
                COALESCE((SELECT jsonb_object_agg(lp.nivel, x.base) FROM precios x JOIN listas_precio lp ON lp.id = x.lista_precio_id
                           WHERE x.presentacion_id = pr.id AND x.activo AND x.sucursal_id IS NULL AND lp.nivel IN (2, 3) AND x.base = 'PRECIO1'), '{}') AS bases
           FROM presentaciones pr WHERE pr.producto_id = $1
            AND (EXISTS (SELECT 1 FROM codigos_barra WHERE presentacion_id = pr.id AND activo)
                 OR EXISTS (SELECT 1 FROM precios WHERE presentacion_id = pr.id AND activo) OR pr.es_principal)
          ORDER BY pr.es_principal DESC, pr.factor`,
        [id],
      ),
      pool.query(
        `SELECT s.id AS "sucursalId", s.nombre AS sucursal,
                COALESCE((SELECT SUM(e.cantidad) FROM existencias e JOIN almacenes a ON a.id = e.almacen_id WHERE a.sucursal_id = s.id AND e.producto_id = $1), 0) AS existencia,
                COALESCE(ps.stock_minimo, 0) AS "stockMinimo", ps.stock_maximo AS "stockMaximo", ps.ubicacion, COALESCE(ps.activo, true) AS activo
           FROM sucursales s LEFT JOIN producto_sucursal ps ON ps.sucursal_id = s.id AND ps.producto_id = $1
          WHERE s.empresa_id = $2 AND s.activo ORDER BY s.nombre`,
        [id, e],
      ),
      pool.query(
        `SELECT pp.proveedor_id AS "proveedorId", pv.nombre, pp.codigo_proveedor AS "codigoProveedor",
                pp.ultimo_costo AS "ultimoCosto", pp.principal
           FROM producto_proveedores pp JOIN proveedores pv ON pv.id = pp.proveedor_id
          WHERE pp.producto_id = $1 AND pp.activo ORDER BY pp.principal DESC, pv.nombre`,
        [id],
      ),
      pool.query(
        `SELECT pc.componente_id AS "productoId", p.nombre, p.sku, pc.cantidad::text AS cantidad
           FROM producto_componentes pc JOIN productos p ON p.id = pc.componente_id WHERE pc.combo_id = $1 ORDER BY p.nombre`,
        [id],
      ),
      pool.query(
        `SELECT h.creado_en AS fecha, pr.nombre AS presentacion, lp.nivel, h.precio_anterior AS anterior, h.precio_nuevo AS nuevo, u.nombre AS usuario
           FROM historial_precios h JOIN presentaciones pr ON pr.id = h.presentacion_id
           JOIN listas_precio lp ON lp.id = h.lista_precio_id LEFT JOIN usuarios u ON u.id = h.usuario_id
          WHERE pr.producto_id = $1 ORDER BY h.creado_en DESC LIMIT 30`,
        [id],
      ),
    ]);
    return { ...p, presentaciones: pres.rows, sucursales: sucs.rows, proveedores: provs.rows, componentes: comps.rows, historialPrecios: hist.rows };
  });

  app.post("/central/productos", async (req, rep) => {
    const p = ProductoSchema.parse(req.body);
    const id = uuidv7();
    await enTransaccion((c) => guardar(c, empresaDe(req), usuarioDe(req), id, p, true));
    rep.code(201);
    return { id };
  });

  app.put("/central/productos/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const p = ProductoSchema.parse(req.body);
    await enTransaccion((c) => guardar(c, empresaDe(req), usuarioDe(req), id, p, false));
    return { id };
  });

  /** Duplicar (para variantes: sabores, tamaños). Copia todo menos SKU y códigos. */
  app.post("/central/productos/:id/duplicar", async (req, rep) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const e = empresaDe(req);
    const nuevo = await enTransaccion(async (c) => {
      const o = (await c.query("SELECT * FROM productos WHERE id = $1 AND empresa_id = $2", [id, e])).rows[0];
      if (!o) throw new ErrorNegocio("Producto no encontrado", 404);
      const nid = uuidv7();
      let sku = `${o.sku}-C`;
      for (let n = 2; (await c.query("SELECT 1 FROM productos WHERE empresa_id = $1 AND sku = $2", [e, sku])).rowCount; n++) sku = `${o.sku}-C${n}`;
      await c.query(
        `INSERT INTO productos (id, empresa_id, sku, nombre, nombre_corto, marca, categoria_id, tipo, impuesto_id, precio_incluye_impuesto,
                                es_pesable, unidad_base, controla_stock, costo_promedio, permite_sin_existencia, precio_variable,
                                precio_variable_min, precio_variable_max, controla_lotes, volumen_ml, grado_alcohol, imagen)
         SELECT $1, empresa_id, $2, nombre || ' (copia)', nombre_corto, marca, categoria_id, tipo, impuesto_id, precio_incluye_impuesto,
                es_pesable, unidad_base, controla_stock, costo_promedio, permite_sin_existencia, precio_variable,
                precio_variable_min, precio_variable_max, controla_lotes, volumen_ml, grado_alcohol, imagen
           FROM productos WHERE id = $3`,
        [nid, sku, id],
      );
      const pres = (await c.query("SELECT * FROM presentaciones WHERE producto_id = $1", [id])).rows;
      for (const pr of pres) {
        const npr = uuidv7();
        await c.query("INSERT INTO presentaciones (id, producto_id, nombre, factor, es_principal) VALUES ($1,$2,$3,$4,$5)", [npr, nid, pr.nombre, pr.factor, pr.es_principal]);
        await c.query(
          `INSERT INTO precios (id, lista_precio_id, presentacion_id, sucursal_id, precio, porcentaje, base)
           SELECT gen_random_uuid(), lista_precio_id, $1, sucursal_id, precio, porcentaje, base FROM precios WHERE presentacion_id = $2 AND activo`,
          [npr, pr.id],
        );
      }
      await c.query(
        `INSERT INTO producto_sucursal (producto_id, sucursal_id, stock_minimo, stock_maximo, ubicacion, activo)
         SELECT $1, sucursal_id, stock_minimo, stock_maximo, ubicacion, activo FROM producto_sucursal WHERE producto_id = $2`,
        [nid, id],
      );
      await c.query(
        `INSERT INTO producto_proveedores (producto_id, proveedor_id, codigo_proveedor, ultimo_costo, principal)
         SELECT $1, proveedor_id, NULL, ultimo_costo, principal FROM producto_proveedores WHERE producto_id = $2 AND activo`,
        [nid, id],
      );
      await c.query(
        "INSERT INTO producto_componentes (combo_id, componente_id, cantidad) SELECT $1, componente_id, cantidad FROM producto_componentes WHERE combo_id = $2",
        [nid, id],
      );
      return nid;
    });
    rep.code(201);
    return { id: nuevo };
  });

  /**
   * Alta rápida por código de barras: primero busca en FactPOS; si no existe,
   * consulta Open Food Facts (base pública de productos) para sugerir nombre,
   * marca e imagen. Requiere internet en la central; si no hay, no pasa nada.
   */
  app.get("/central/productos/codigo/:codigo", async (req) => {
    const { codigo } = z.object({ codigo: z.string().regex(/^\d{6,14}$/, "Código inválido") }).parse(req.params);
    const propio = await pool.query(
      `SELECT p.id, p.nombre FROM codigos_barra cb JOIN presentaciones pr ON pr.id = cb.presentacion_id JOIN productos p ON p.id = pr.producto_id
        WHERE cb.empresa_id = $1 AND cb.codigo = $2 AND cb.activo`,
      [empresaDe(req), codigo],
    );
    if (propio.rowCount) return { existe: true, producto: propio.rows[0] };
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${codigo}.json?fields=product_name,product_name_es,brands,image_front_url,quantity`, {
        headers: { "user-agent": "FactPOS/1.0" }, signal: AbortSignal.timeout(5000),
      });
      const d: any = await r.json();
      if (d?.status !== 1) return { existe: false, sugerencia: null };
      const pr = d.product ?? {};
      return {
        existe: false,
        sugerencia: {
          nombre: [pr.product_name_es || pr.product_name, pr.quantity].filter(Boolean).join(" ") || null,
          marca: (pr.brands ?? "").split(",")[0]?.trim() || null,
          imagen: pr.image_front_url ?? null,
          fuente: "Open Food Facts",
        },
      };
    } catch {
      return { existe: false, sugerencia: null, sinConexion: true };
    }
  });

  /** Precios 2 y 3 como % de descuento sobre el precio 1 (se definen una vez para toda la empresa) */
  app.put("/central/niveles-precio", async (req) => {
    const b = z.object({ nivel2: z.number().min(0).max(90), nivel3: z.number().min(0).max(90) }).parse(req.body);
    const e = empresaDe(req);
    await pool.query("UPDATE listas_precio SET descuento_pct = $2 WHERE empresa_id = $1 AND nivel = 2 AND NOT es_predeterminada", [e, b.nivel2]);
    await pool.query("UPDATE listas_precio SET descuento_pct = $2 WHERE empresa_id = $1 AND nivel = 3 AND NOT es_predeterminada", [e, b.nivel3]);
    return { ok: true };
  });

  // ---- Catálogos auxiliares del formulario ----
  app.get("/central/productos-auxiliares", async (req) => {
    const e = empresaDe(req);
    const [impuestos, categorias, proveedores, listas, empresa] = await Promise.all([
      pool.query(`SELECT id, nombre, tipo, tasa::float AS tasa FROM impuestos WHERE empresa_id = $1 AND tipo = 'ITBIS' ORDER BY tasa DESC`, [e]),
      pool.query(`SELECT id, nombre, color, icono FROM categorias WHERE empresa_id = $1 ORDER BY orden, nombre`, [e]),
      pool.query(`SELECT id, nombre, rnc FROM proveedores WHERE empresa_id = $1 AND activo ORDER BY nombre`, [e]),
      pool.query(`SELECT nivel, nombre, descuento_pct::float AS "descuentoPct" FROM listas_precio WHERE empresa_id = $1 AND nivel IS NOT NULL ORDER BY nivel`, [e]),
      pool.query(`SELECT precios_por_sucursal AS "preciosPorSucursal" FROM empresas WHERE id = $1`, [e]),
    ]);
    return { impuestos: impuestos.rows, categorias: categorias.rows, proveedores: proveedores.rows, listas: listas.rows, ...empresa.rows[0] };
  });

  app.post("/central/categorias", async (req, rep) => {
    const b = z.object({ nombre: z.string().trim().min(2).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"), icono: z.string().max(20).nullable().default(null) }).parse(req.body);
    const id = uuidv7();
    await pool.query("INSERT INTO categorias (id, empresa_id, nombre, color, icono, orden) VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(orden),0)+1 FROM categorias WHERE empresa_id = $2))",
      [id, empresaDe(req), b.nombre, b.color, b.icono]);
    rep.code(201);
    return { id };
  });

  app.post("/central/proveedores", async (req, rep) => {
    const b = z.object({ nombre: z.string().trim().min(2).max(80), rnc: z.string().regex(/^\d{9}(\d{2})?$/, "RNC de 9 u 11 dígitos").nullable().default(null), telefono: z.string().max(20).nullable().default(null) }).parse(req.body);
    const id = uuidv7();
    await pool.query("INSERT INTO proveedores (id, empresa_id, nombre, rnc, telefono) VALUES ($1,$2,$3,$4,$5)", [id, empresaDe(req), b.nombre, b.rnc, b.telefono]);
    rep.code(201);
    return { id };
  });

  /** Interruptor de la empresa: precios distintos por sucursal (apagado por defecto). */
  app.put("/central/empresa/precios-por-sucursal", async (req) => {
    const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
    await pool.query("UPDATE empresas SET precios_por_sucursal = $2 WHERE id = $1", [empresaDe(req), activo]);
    return { preciosPorSucursal: activo };
  });
}
