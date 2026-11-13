import { sucursalesDe } from "../sesion.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { repartirPorLotes } from "../lotes.js";
import { exigirFuncion } from "./central-seguridad.js";
import { verificarClave } from "../sesion.js";

/**
 * Administración central: ajustes de inventario, conteos físicos, reportes,
 * kardex, módulos por sucursal y repartidores. Solo con MODO=central.
 */
const uuid = z.string().uuid();
const cant = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida");
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");

const TIPOS_SALIDA = ["AJUSTE_SALIDA", "MERMA", "VENCIMIENTO", "CONSUMO_INTERNO"] as const;

async function almacenDe(c: Pick<PoolClient, "query">, sucursalId: string, almacenId?: string) {
  const r = await c.query<{ id: string }>(
    almacenId
      ? "SELECT id FROM almacenes WHERE id = $2 AND sucursal_id = $1"
      : "SELECT id FROM almacenes WHERE sucursal_id = $1 AND es_principal",
    almacenId ? [sucursalId, almacenId] : [sucursalId],
  );
  if (!r.rowCount) throw new ErrorNegocio("Almacén no encontrado en esa sucursal");
  return r.rows[0].id;
}

interface LineaAjuste {
  productoId: string;
  tipo: "AJUSTE_ENTRADA" | (typeof TIPOS_SALIDA)[number] | "CONTEO_FISICO";
  cantidad: Decimal; // con signo
  costoUnitario?: string;
  nota?: string;
}

/** Crea el documento de ajuste y aplica cada línea al kardex (mismo id que viajará a la sucursal). */
async function crearAjuste(
  c: PoolClient,
  d: { sucursalId: string; almacenId: string; usuarioId: string; motivo: string; origen: "MANUAL" | "CONTEO"; conteoId?: string; lineas: LineaAjuste[] },
) {
  await c.query("SELECT 1 FROM sucursales WHERE id = $1 FOR UPDATE", [d.sucursalId]);
  const id = uuidv7();
  const a = await c.query<{ numero: string }>(
    `INSERT INTO ajustes_inventario (id, sucursal_id, almacen_id, numero, origen, conteo_id, motivo, usuario_id)
     VALUES ($1,$2,$3,(SELECT COALESCE(MAX(numero),0)+1 FROM ajustes_inventario WHERE sucursal_id = $2),$4,$5,$6,$7)
     RETURNING numero`,
    [id, d.sucursalId, d.almacenId, d.origen, d.conteoId ?? null, d.motivo, d.usuarioId],
  );
  let valor = new Decimal(0);
  for (const l of d.lineas) {
    // Las salidas se reparten por lotes: primero lo que vence antes; si es por VENCIMIENTO, primero lo ya vencido.
    // (El documento guarda la línea completa; el kardex puede llevar una fila por lote.)
    const piezas = l.cantidad.lt(0) && l.tipo !== "CONTEO_FISICO"
      ? await repartirPorLotes(c, d.almacenId, [{ productoId: l.productoId, cantidad: l.cantidad.toFixed(3) }], { vencidosPrimero: l.tipo === "VENCIMIENTO" })
      : [{ productoId: l.productoId, cantidad: l.cantidad.toFixed(3), loteId: null, indice: 0 }];
    let kardexId = "";
    let k = { rows: [{ costo_unitario: "0" }] };
    for (const pieza of piezas) {
      const kid = uuidv7();
      if (!kardexId) kardexId = kid;
      k = await c.query<{ costo_unitario: string }>(
        `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario,
                                         documento_tipo, documento_id, motivo, usuario_id, lote_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ajuste',$8,$9,$10,$11) RETURNING costo_unitario`,
        [kid, d.sucursalId, d.almacenId, l.productoId, l.tipo, pieza.cantidad, l.costoUnitario ?? 0, id, l.nota ?? d.motivo, d.usuarioId, pieza.loteId],
      );
    }
    await c.query(
      `INSERT INTO ajuste_items (id, ajuste_id, producto_id, tipo, cantidad, costo_unitario, kardex_id, nota)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuidv7(), id, l.productoId, l.tipo, l.cantidad.toFixed(3), k.rows[0].costo_unitario, kardexId, l.nota ?? null],
    );
    valor = valor.plus(l.cantidad.mul(k.rows[0].costo_unitario));
  }
  return { id, numero: a.rows[0].numero, lineas: d.lineas.length, valor: valor.toFixed(2) };
}

// Reportes disponibles: nombre → vista y filtros que admite
const REPORTES: Record<string, { vista: string; fecha?: boolean; sucursal?: boolean; empresa?: boolean; orden?: string }> = {
  "ventas-diarias": { vista: "rpt_ventas_diarias", fecha: true, sucursal: true, orden: "fecha DESC" },
  "utilidad-productos": { vista: "rpt_utilidad_producto", fecha: true, sucursal: true, orden: "utilidad DESC" },
  // Unidades vendidas de cada producto por día o por mes (la consulta propia está en el manejador de abajo)
  "ventas-producto": { vista: "rpt_utilidad_producto", fecha: true, sucursal: true },
  // Los más vendidos del período (ranking por unidades) y lo que está en cero en el almacén principal
  "mas-vendidos": { vista: "rpt_utilidad_producto", fecha: true, sucursal: true },
  "sin-stock": { vista: "rpt_sin_stock", sucursal: true, orden: "vendido_30d DESC, nombre" },
  "formas-pago": { vista: "rpt_formas_pago", fecha: true, sucursal: true, orden: "fecha DESC" },
  "niveles-precio": { vista: "rpt_ventas_nivel_precio", fecha: true, sucursal: true, orden: "fecha DESC, nivel" },
  "valorizacion": { vista: "rpt_valorizacion_inventario", sucursal: true, orden: "valor DESC" },
  "bajo-minimo": { vista: "rpt_bajo_minimo", sucursal: true, orden: "nombre" },
  "por-vencer": { vista: "rpt_proximos_vencer", sucursal: true, orden: "vence_en" },
  "reposicion": { vista: "rpt_reposicion", sucursal: true, orden: "dias_de_inventario NULLS LAST, sugerido_comprar DESC" },
  "perdidas": { vista: "rpt_perdidas", fecha: true, sucursal: true, orden: "fecha DESC" },
  "ajustes": { vista: "rpt_ajustes", fecha: true, sucursal: true, orden: "fecha DESC, numero DESC" },
  "ofertas": { vista: "rpt_ofertas", fecha: true, sucursal: true, orden: "fecha DESC" },
  "cupones": { vista: "rpt_cupones", orden: "usos DESC" },
  "traspasos": { vista: "rpt_traspasos", orden: "enviado_en DESC" },
  "delivery": { vista: "rpt_delivery", fecha: true, sucursal: true, orden: "fecha DESC" },
  "saldo-clientes": { vista: "rpt_saldo_clientes", orden: "saldo DESC" },
  "historial-ventas": { vista: "rpt_historial_ventas", fecha: true, sucursal: true, orden: "fecha DESC, hora DESC" },
  "historial-ventas-producto": { vista: "rpt_historial_ventas_producto", fecha: true, sucursal: true, orden: "fecha DESC, importe DESC" },
  "sucursales": { vista: "rpt_resumen_sucursales", sucursal: true, orden: "sucursal" },
  "ventas-sucursal": { vista: "rpt_ventas_sucursal", fecha: true, sucursal: true, orden: "fecha DESC, venta_total DESC" },
  "ventas-comprobante": { vista: "rpt_ventas_comprobante", fecha: true, sucursal: true, orden: "fecha DESC, prefijo, tipo" },
  "entradas-noche": { vista: "rpt_entradas_noche", fecha: true, sucursal: true, orden: "fecha DESC, cantidad DESC" },
  "cortesias": { vista: "rpt_control_cuentas", fecha: true, sucursal: true, orden: "fecha DESC, hora DESC" },
  "anulaciones": { vista: "rpt_control_anulaciones", fecha: true, sucursal: true, orden: "hora DESC" },
  "anulaciones-cajero": { vista: "rpt_control_anulaciones_cajero", fecha: true, sucursal: true, orden: "fecha DESC, anulaciones DESC" },
  "cierres-caja": { vista: "rpt_cierres_caja", fecha: true, sucursal: true, orden: "cerrado_en DESC" },
  "rotacion-abc": { vista: "rpt_rotacion_abc", sucursal: true, orden: "venta_neta_90d DESC" },
  "stock-muerto": { vista: "rpt_stock_muerto", sucursal: true, orden: "valor DESC" },
  // Se agrupan en el manejador de abajo (por categoría o por proveedor, y por insumo)
  "margen-categoria": { vista: "rpt_margen_base", fecha: true, sucursal: true },
  "margen-proveedor": { vista: "rpt_margen_base", fecha: true, sucursal: true },
  "consumo-insumos": { vista: "rpt_consumo_insumos", fecha: true, sucursal: true },
  "cartera": { vista: "rpt_cartera", empresa: true, orden: "cartera DESC" },
  "cobros": { vista: "rpt_cobros", fecha: true, sucursal: true, orden: "fecha DESC, cobrado DESC" },
};

function enviarCsv(rep: FastifyReply, nombre: string, filas: Record<string, unknown>[]) {
  const cols = filas.length ? Object.keys(filas[0]) : [];
  const celda = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [cols.join(","), ...filas.map((f) => cols.map((c) => celda(f[c])).join(","))].join("\r\n");
  rep.header("content-type", "text/csv; charset=utf-8");
  rep.header("content-disposition", `attachment; filename="${nombre}.csv"`);
  return csv;
}

export async function rutasCentralInventario(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  // -------------------------------------------------------------------
  // Historial de ventas de otro sistema (solo consulta y reportes; no es fiscal ni mueve inventario)
  // -------------------------------------------------------------------
  app.post("/central/historial-ventas/importar", async (req, rep) => {
    const e = empresaDe(req);
    const dec = z.union([z.string(), z.number()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v), "Número inválido").transform((v) => Math.round(v * 100) / 100);
    const b = z.object({
      sucursalId: uuid, origen: z.string().trim().min(2).max(30),
      ventas: z.array(z.object({
        origenId: z.union([z.string(), z.number()]).transform(String), fecha: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida"),
        cliente: z.string().max(160).default(""), metodo: z.string().max(40).default(""), estado: z.string().max(40).default(""),
        descuento: dec.default(0), itbis: dec.default(0), total: dec.default(0),
        lineas: z.array(z.object({ producto: z.string().max(200), cantidad: z.union([z.string(), z.number()]), precio: z.union([z.string(), z.number()]).nullish(), subtotal: z.union([z.string(), z.number()]).nullish() })).max(500).default([]),
      })).min(1).max(500),
    }).parse(req.body);
    const ok = await pool.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2", [b.sucursalId, e]);
    if (!ok.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    const r = await pool.query(
      `INSERT INTO ventas_historicas (id, empresa_id, sucursal_id, origen, origen_id, fecha, cliente, metodo, estado, descuento, itbis, total, lineas)
       SELECT uuidv7_id, $1, $2, $3, x.origen_id, x.fecha::timestamptz, COALESCE(x.cliente,''), COALESCE(x.metodo,''), COALESCE(x.estado,''), COALESCE(x.descuento,0), COALESCE(x.itbis,0), COALESCE(x.total,0), COALESCE(x.lineas,'[]')
         FROM jsonb_to_recordset($4::jsonb) AS x(uuidv7_id uuid, origen_id text, fecha text, cliente text, metodo text, estado text, descuento numeric, itbis numeric, total numeric, lineas jsonb)
       ON CONFLICT (empresa_id, origen, origen_id) DO NOTHING`,
      [e, b.sucursalId, b.origen, JSON.stringify(b.ventas.map((v) => ({ uuidv7_id: uuidv7(), origen_id: v.origenId, fecha: v.fecha, cliente: v.cliente, metodo: v.metodo, estado: v.estado, descuento: v.descuento, itbis: v.itbis, total: v.total, lineas: v.lineas })))]);
    rep.code(201);
    return { nuevas: r.rowCount ?? 0, existentes: b.ventas.length - (r.rowCount ?? 0) };
  });

  /** Borra el historial importado de un sistema (para cargarlo completo otra vez desde un backup nuevo). */
  app.post("/central/historial-ventas/vaciar", async (req) => {
    const e = empresaDe(req);
    const b = z.object({ origen: z.string().trim().min(2).max(30) }).parse(req.body);
    const r = await pool.query("DELETE FROM ventas_historicas WHERE empresa_id = $1 AND origen = $2", [e, b.origen]);
    return { borradas: r.rowCount ?? 0 };
  });

  /**
   * Lo que una importación anterior dejó en FactPOS (productos por prefijo de SKU y clientes con documento) con su existencia
   * en la sucursal: el importador lo usa para ACTUALIZAR en vez de duplicar al cargar un backup nuevo (sin el tope de 500 de las listas).
   */
  app.get("/central/importacion/existentes", async (req) => {
    const e = empresaDe(req);
    const f = z.object({ prefijo: z.string().trim().min(2).max(10), sucursalId: uuid }).parse(req.query);
    const productos = await pool.query(
      `SELECT p.id, p.sku, p.activo, p.tipo,
              COALESCE((SELECT SUM(x.cantidad) FROM existencias x JOIN almacenes a ON a.id = x.almacen_id WHERE x.producto_id = p.id AND a.sucursal_id = $3), 0)::text AS existencia
         FROM productos p WHERE p.empresa_id = $1 AND p.sku LIKE $2 || '%'`, [e, f.prefijo.replace(/[%_]/g, ""), f.sucursalId]);
    const clientes = await pool.query(
      `SELECT c.id, c.documento, c.activo, COALESCE(lp.nivel, 1) AS nivel, c.limite_credito::text AS "limiteCredito", c.dias_credito AS "diasCredito"
         FROM clientes c LEFT JOIN listas_precio lp ON lp.id = c.lista_precio_id WHERE c.empresa_id = $1 AND c.documento IS NOT NULL`, [e]);
    return { productos: productos.rows, clientes: clientes.rows };
  });

  // -------------------------------------------------------------------
  // Ajustes de inventario
  // -------------------------------------------------------------------
  /**
   * Existencia desde la pantalla de Productos (al crear, al editar o al importar): entrada al kardex como ajuste.
   * Solo si un administrador activó «agregar_existencia» en Sistema › Seguridad.
   */
  app.post("/central/productos-existencia", async (req, rep) => {
    const e = empresaDe(req);
    const b = z.object({
      sucursalId: uuid, almacenId: uuid.optional(),
      motivo: z.string().trim().min(3).max(200).default("Existencia agregada desde Productos"),
      items: z.array(z.object({
        productoId: uuid, cantidad: cant.refine((v) => Number(v) > 0, "La cantidad debe ser mayor que cero"),
        costoUnitario: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(), nota: z.string().max(200).optional(),
      })).min(1).max(2000),
    }).parse(req.body);
    // La existencia inicial de un producto recién creado (sin ningún movimiento en el kardex) no necesita la función de Seguridad;
    // sumarle existencia a un producto que ya tiene historial sí.
    const conHistorial = await pool.query("SELECT 1 FROM kardex_movimientos WHERE producto_id = ANY($1::uuid[]) LIMIT 1", [[...new Set(b.items.map((i) => i.productoId))]]);
    if (conHistorial.rowCount) await exigirFuncion(e, "agregar_existencia");
    const usuarioId = uuid.parse(req.headers["x-usuario-id"]);
    const r = await enTransaccion(async (c) => {
      const ok = await c.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM productos WHERE empresa_id = $1 AND tipo = 'INVENTARIABLE' AND id = ANY($2::uuid[])", [e, [...new Set(b.items.map((i) => i.productoId))]]);
      if (ok.rows[0].n !== new Set(b.items.map((i) => i.productoId)).size) throw new ErrorNegocio("Solo los productos inventariables llevan existencia");
      const almacenId = await almacenDe(c, b.sucursalId, b.almacenId);
      return crearAjuste(c, {
        sucursalId: b.sucursalId, almacenId, usuarioId, motivo: b.motivo, origen: "MANUAL",
        lineas: b.items.map((i) => ({ productoId: i.productoId, tipo: "AJUSTE_ENTRADA" as const, cantidad: new Decimal(i.cantidad), costoUnitario: i.costoUnitario, nota: i.nota })),
      });
    });
    rep.code(201);
    return r;
  });


  // -------------------------------------------------------------------
  // Actualizar el inventario con Excel (existencia contada o ajuste)
  // -------------------------------------------------------------------
  const cuerpoExcel = z.object({
    sucursalId: uuid, almacenId: uuid.optional(),
    modo: z.enum(["FIJAR", "SUMAR"]),
    filas: z.array(z.object({
      fila: z.number().int(), sku: z.string().trim().max(60).optional(), codigo: z.string().trim().max(30).optional(),
      cantidad: z.number().finite().min(-1e9).max(1e9), costo: z.number().finite().min(0).max(1e9).optional(),
      precio: z.number().finite().min(0).max(1e9).optional(),
    })).min(1).max(5000),
  });
  const accesoSucursal = (req: { headers: Record<string, unknown> }, sucursalId: string) => {
    const p = sucursalesDe(req);
    if (p && !p.includes(sucursalId)) throw new ErrorNegocio("No tiene acceso a esa sucursal", 403);
  };
  interface Resuelta { fila: number; productoId?: string; sku?: string; nombre?: string; actual: number; nuevo: number; diferencia: number; costo?: number; precio?: number; precioActual?: number; presentacionId?: string; error?: string }
  /** Cada fila se busca por SKU o código de barras; la diferencia contra la existencia actual es lo que se ajusta. */
  const resolverExcel = async (c: Pick<PoolClient, "query">, empresaId: string, almacenId: string, b: z.infer<typeof cuerpoExcel>): Promise<Resuelta[]> => {
    const vistos = new Set<string>();
    const salida: Resuelta[] = [];
    for (const f of b.filas) {
      const clave = (f.sku || f.codigo || "").trim();
      if (!clave) { salida.push({ fila: f.fila, actual: 0, nuevo: 0, diferencia: 0, error: "Sin SKU ni código de barras" }); continue; }
      const r = await c.query<{ id: string; sku: string; nombre: string; actual: string; presentacion_id: string | null; precio_actual: string | null }>(
        `SELECT p.id, p.sku, p.nombre, COALESCE(e.cantidad, 0)::text AS actual,
                pp.id AS presentacion_id,
                (SELECT pr1.precio::text FROM precios pr1 JOIN listas_precio l1 ON l1.id = pr1.lista_precio_id AND l1.nivel = 1
                  WHERE pr1.presentacion_id = pp.id AND pr1.sucursal_id IS NULL AND pr1.activo LIMIT 1) AS precio_actual
           FROM productos p LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = $2
          LEFT JOIN LATERAL (SELECT id FROM presentaciones WHERE producto_id = p.id ORDER BY es_principal DESC, factor LIMIT 1) pp ON true
          WHERE p.empresa_id = $1 AND p.activo AND p.controla_stock AND (
                ($3 <> '' AND lower(p.sku) = lower($3))
             OR ($4 <> '' AND p.id IN (SELECT pr.producto_id FROM codigos_barra cb JOIN presentaciones pr ON pr.id = cb.presentacion_id WHERE cb.empresa_id = $1 AND cb.codigo = $4)))
          LIMIT 1`,
        [empresaId, almacenId, f.sku ?? "", f.codigo ?? ""],
      );
      if (!r.rowCount) { salida.push({ fila: f.fila, actual: 0, nuevo: 0, diferencia: 0, error: `No se encontró «${clave}» (o no lleva inventario)` }); continue; }
      const p = r.rows[0];
      if (vistos.has(p.id)) { salida.push({ fila: f.fila, sku: p.sku, nombre: p.nombre, actual: Number(p.actual), nuevo: 0, diferencia: 0, error: "Producto repetido en el archivo: se usa la primera fila" }); continue; }
      vistos.add(p.id);
      const actual = Number(p.actual);
      const nuevo = b.modo === "FIJAR" ? f.cantidad : actual + f.cantidad;
      if (nuevo < 0) { salida.push({ fila: f.fila, productoId: p.id, sku: p.sku, nombre: p.nombre, actual, nuevo, diferencia: 0, error: "La existencia no puede quedar negativa" }); continue; }
      salida.push({ fila: f.fila, productoId: p.id, sku: p.sku, nombre: p.nombre, actual, nuevo, diferencia: Math.round((nuevo - actual) * 1000) / 1000, costo: f.costo,
        presentacionId: p.presentacion_id ?? undefined, precioActual: p.precio_actual == null ? undefined : Number(p.precio_actual), precio: f.precio && f.precio > 0 ? f.precio : undefined });
    }
    return salida;
  };

  app.post("/central/inventario/excel/vista", async (req) => {
    const b = cuerpoExcel.parse(req.body);
    accesoSucursal(req, b.sucursalId);
    const almacenId = await almacenDe(pool, b.sucursalId, b.almacenId);
    return { filas: await resolverExcel(pool, empresaDe(req), almacenId, b) };
  });

  app.post("/central/inventario/excel/aplicar", async (req, rep) => {
    const b = cuerpoExcel.extend({ motivo: z.string().trim().min(3).max(200) }).parse(req.body);
    accesoSucursal(req, b.sucursalId);
    const usuarioId = uuid.parse(req.headers["x-usuario-id"]);
    const r = await enTransaccion(async (c) => {
      const almacenId = await almacenDe(c, b.sucursalId, b.almacenId);
      const todas = (await resolverExcel(c, empresaDe(req), almacenId, b)).filter((f) => !f.error && f.productoId);
      const cambiaPrecio = (f: Resuelta) => !!f.precio && !!f.presentacionId && f.precio !== f.precioActual;
      const filas = todas.filter((f) => f.diferencia !== 0);
      const preciosNuevos = todas.filter(cambiaPrecio);
      if (!filas.length && !preciosNuevos.length) throw new ErrorNegocio("No hay diferencias que aplicar: la existencia y los precios ya coinciden con el archivo.");
      // Precio de venta (nivel 1): queda en el historial de precios
      if (preciosNuevos.length) {
        const lista = (await c.query<{ id: string }>("SELECT id FROM listas_precio WHERE empresa_id = $1 AND nivel = 1", [empresaDe(req)])).rows[0];
        if (!lista) throw new ErrorNegocio("No hay lista de Precio 1 configurada");
        for (const f of preciosNuevos) {
          await c.query(
            `INSERT INTO precios (id, lista_precio_id, presentacion_id, precio, porcentaje, base) VALUES ($1,$2,$3,$4,NULL,'COSTO')
             ON CONFLICT (lista_precio_id, presentacion_id, COALESCE(sucursal_id, '00000000-0000-0000-0000-000000000000'))
             DO UPDATE SET precio = EXCLUDED.precio, porcentaje = NULL, base = 'COSTO', activo = true`,
            [uuidv7(), lista.id, f.presentacionId, f.precio!.toFixed(2)],
          );
          await c.query(
            `INSERT INTO historial_precios (id, presentacion_id, lista_precio_id, precio_anterior, precio_nuevo, usuario_id) VALUES ($1,$2,$3,$4,$5,$6)`,
            [uuidv7(), f.presentacionId, lista.id, f.precioActual ?? null, f.precio!.toFixed(2), usuarioId],
          );
        }
      }
      const ajuste = filas.length ? await crearAjuste(c, {
        sucursalId: b.sucursalId, almacenId, usuarioId, motivo: `Actualización por Excel: ${b.motivo}`, origen: "MANUAL",
        lineas: filas.map((f) => ({
          productoId: f.productoId!, tipo: f.diferencia > 0 ? "AJUSTE_ENTRADA" as const : "AJUSTE_SALIDA" as const,
          cantidad: new Decimal(f.diferencia), costoUnitario: f.diferencia > 0 && f.costo ? f.costo.toFixed(4) : undefined, nota: `Excel fila ${f.fila}`,
        })),
      }) : { numero: "—" };
      return { ...ajuste, productos: filas.length, precios: preciosNuevos.length };
    });
    rep.code(201);
    return r;
  });

  /** Archivo base para editar y volver a subir: SKU, código de barras, nombre y existencia actual. */
  app.get("/central/inventario/plantilla", async (req, rep) => {
    const f = z.object({ sucursalId: uuid, almacenId: uuid.optional() }).parse(req.query);
    accesoSucursal(req, f.sucursalId);
    const almacenId = await almacenDe(pool, f.sucursalId, f.almacenId);
    const r = await pool.query(
      `SELECT p.sku AS "SKU",
              (SELECT string_agg(cb.codigo, ' ') FROM codigos_barra cb JOIN presentaciones pr ON pr.id = cb.presentacion_id WHERE pr.producto_id = p.id AND cb.empresa_id = p.empresa_id) AS "Código de barras",
              p.nombre AS "Producto", COALESCE(e.cantidad, 0)::text AS "Existencia"
         FROM productos p LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = $2
        WHERE p.empresa_id = $1 AND p.activo AND p.controla_stock ORDER BY p.nombre`,
      [empresaDe(req), almacenId],
    );
    return enviarCsv(rep, "inventario-plantilla", r.rows);
  });

  /**
   * Borrar inventario (deja en cero el almacén). Está en Sistema › Seguridad: la función debe estar activada,
   * el usuario debe ser administrador (la ruta exige «*»), escribir su contraseña y la frase de confirmación.
   * No borra productos ni historial: genera ajustes que quedan en el kardex.
   */
  app.post("/central/seguridad/borrar-inventario", async (req, rep) => {
    const e = empresaDe(req);
    await exigirFuncion(e, "borrar_inventario");
    const b = z.object({
      sucursalId: uuid, almacenId: uuid.optional(), clave: z.string().min(1).max(200),
      alcance: z.enum(["EXISTENCIAS", "HISTORIAL", "PRODUCTOS", "CATALOGO"]).default("EXISTENCIAS"),
      frase: z.string().trim(),
      motivo: z.string().trim().min(10, "Explique el motivo (mínimo 10 caracteres)").max(180),
    }).parse(req.body);
    const FRASES = { EXISTENCIAS: "BORRAR INVENTARIO", HISTORIAL: "BORRAR HISTORIAL", PRODUCTOS: "BORRAR PRODUCTOS", CATALOGO: "BORRAR CATALOGO" } as const;
    if (b.frase !== FRASES[b.alcance]) throw new ErrorNegocio(`Escriba exactamente ${FRASES[b.alcance]}`);
    accesoSucursal(req, b.sucursalId);
    const usuarioId = uuid.parse(req.headers["x-usuario-id"]);
    const u = await pool.query<{ clave_hash: string }>("SELECT clave_hash FROM usuarios WHERE id = $1", [usuarioId]);
    if (!(await verificarClave(b.clave, u.rows[0]?.clave_hash))) throw new ErrorNegocio("La contraseña no es correcta", 403);
    if (b.alcance !== "EXISTENCIAS") {
      const r2 = await enTransaccion(async (c) => borrarProfundo(c, e, b.sucursalId, b.alcance as "HISTORIAL" | "PRODUCTOS" | "CATALOGO", usuarioId, b.motivo));
      rep.code(201);
      return r2;
    }
    const r = await enTransaccion(async (c) => {
      const s = await c.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2", [b.sucursalId, e]);
      if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
      const almacenId = await almacenDe(c, b.sucursalId, b.almacenId);
      const filas = await c.query<{ producto_id: string; cantidad: string }>(
        "SELECT x.producto_id, x.cantidad FROM existencias x JOIN productos p ON p.id = x.producto_id WHERE x.almacen_id = $1 AND p.empresa_id = $2 AND x.cantidad <> 0", [almacenId, e]);
      if (!filas.rowCount) throw new ErrorNegocio("El inventario de ese almacén ya está en cero.");
      const ajuste = await crearAjuste(c, {
        sucursalId: b.sucursalId, almacenId, usuarioId, motivo: `Borrado de inventario: ${b.motivo}`, origen: "MANUAL",
        lineas: filas.rows.map((x) => {
          const q = new Decimal(x.cantidad);
          return { productoId: x.producto_id, tipo: q.gt(0) ? "AJUSTE_SALIDA" as const : "AJUSTE_ENTRADA" as const, cantidad: q.neg(), nota: "Borrado de inventario" };
        }),
      });
      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
         VALUES ($1,$2,$3,$3,'inventario.borrar','ajuste',$4,$5)`,
        [uuidv7(), b.sucursalId, usuarioId, ajuste.id, JSON.stringify({ motivo: b.motivo, productos: filas.rowCount })]);
      return { ...ajuste, productos: filas.rowCount };
    });
    rep.code(201);
    return r;
  });

  app.post("/central/ajustes", async (req, rep) => {
    const b = z
      .object({
        sucursalId: uuid,
        almacenId: uuid.optional(),
        usuarioId: uuid,
        motivo: z.string().trim().min(3).max(200),
        items: z
          .array(z.object({
            productoId: uuid,
            tipo: z.enum(["AJUSTE_ENTRADA", ...TIPOS_SALIDA]),
            cantidad: cant.refine((v) => Number(v) > 0, "La cantidad debe ser mayor que cero"),
            costoUnitario: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(), // solo entradas sin costo previo
            nota: z.string().max(200).optional(),
          }))
          .min(1).max(2000),
      })
      .parse(req.body);

    const r = await enTransaccion(async (c) => {
      const almacenId = await almacenDe(c, b.sucursalId, b.almacenId);
      return crearAjuste(c, {
        sucursalId: b.sucursalId, almacenId, usuarioId: b.usuarioId, motivo: b.motivo, origen: "MANUAL",
        lineas: b.items.map((i) => ({
          productoId: i.productoId,
          tipo: i.tipo,
          cantidad: i.tipo === "AJUSTE_ENTRADA" ? new Decimal(i.cantidad) : new Decimal(i.cantidad).neg(),
          costoUnitario: i.costoUnitario,
          nota: i.nota,
        })),
      });
    });
    rep.code(201);
    return r;
  });

  app.get("/central/ajustes", async (req) => {
    const f = z.object({ sucursalId: uuid.optional(), desde: fecha.optional(), hasta: fecha.optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT a.id, a.numero, s.nombre AS sucursal, al.nombre AS almacen, a.origen, a.motivo, u.nombre AS usuario, a.creado_en AS "creadoEn",
              COUNT(i.id) AS lineas, ROUND(SUM(i.cantidad * i.costo_unitario), 2) AS valor,
              a.aplicado_en_sucursal AS "aplicadoEnSucursal"
         FROM ajustes_inventario a
         JOIN sucursales s ON s.id = a.sucursal_id AND s.empresa_id = $1
         JOIN almacenes al ON al.id = a.almacen_id
         JOIN usuarios u ON u.id = a.usuario_id
         JOIN ajuste_items i ON i.ajuste_id = a.id
        WHERE ($2::uuid IS NULL OR a.sucursal_id = $2)
          AND ($3::date IS NULL OR a.creado_en >= $3::date)
          AND ($4::date IS NULL OR a.creado_en < $4::date + 1)
          AND ($5::uuid[] IS NULL OR a.sucursal_id = ANY($5))
        GROUP BY a.id, s.nombre, al.nombre, u.nombre ORDER BY a.creado_en DESC LIMIT 300`,
      [empresaDe(req), f.sucursalId ?? null, f.desde ?? null, f.hasta ?? null, sucursalesDe(req)],
    );
    return r.rows;
  });

  // -------------------------------------------------------------------
  // Conteos físicos
  // -------------------------------------------------------------------
  /** Abre un conteo: toma la "foto" de la existencia del sistema en ese momento. */
  app.post("/central/conteos", async (req, rep) => {
    const b = z
      .object({
        sucursalId: uuid, almacenId: uuid.optional(), usuarioId: uuid,
        tipo: z.enum(["TOTAL", "CICLICO"]),
        categoriaId: uuid.optional(),
        productoIds: z.array(uuid).max(5000).optional(),
        alcance: z.string().max(100).optional(),
      })
      .parse(req.body);
    const r = await enTransaccion(async (c) => {
      const almacenId = await almacenDe(c, b.sucursalId, b.almacenId);
      const id = uuidv7();
      await c.query(
        "INSERT INTO conteos_fisicos (id, almacen_id, tipo, alcance, creado_por) VALUES ($1,$2,$3,$4,$5)",
        [id, almacenId, b.tipo, b.alcance ?? (b.tipo === "TOTAL" ? "Inventario completo" : "Conteo cíclico"), b.usuarioId],
      );
      const items = await c.query(
        `INSERT INTO conteo_items (id, conteo_id, producto_id, cantidad_sistema, costo_promedio)
         SELECT gen_random_uuid(), $1, p.id, COALESCE(e.cantidad, 0), COALESCE(e.costo_promedio, p.costo_promedio)
           FROM productos p
           JOIN sucursales s ON s.empresa_id = p.empresa_id AND s.id = $3
           LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = $2
          WHERE p.activo AND p.controla_stock
            AND ($4::uuid IS NULL OR p.categoria_id = $4)
            AND ($5::uuid[] IS NULL OR p.id = ANY($5))`,
        [id, almacenId, b.sucursalId, b.categoriaId ?? null, b.productoIds ?? null],
      );
      return { id, productos: items.rowCount };
    });
    rep.code(201);
    return r;
  });

  app.get("/central/conteos", async (req) => {
    const r = await pool.query(
      `SELECT c.id, c.tipo, c.alcance, c.estado, c.creado_en AS "creadoEn", s.nombre AS sucursal,
              COUNT(i.id) AS productos, COUNT(i.cantidad_contada) AS contados
         FROM conteos_fisicos c
         JOIN almacenes a ON a.id = c.almacen_id
         JOIN sucursales s ON s.id = a.sucursal_id AND s.empresa_id = $1
         LEFT JOIN conteo_items i ON i.conteo_id = c.id
        WHERE ($2::uuid[] IS NULL OR s.id = ANY($2))
        GROUP BY c.id, s.nombre ORDER BY c.creado_en DESC LIMIT 100`,
      [empresaDe(req), sucursalesDe(req)],
    );
    return r.rows;
  });

  app.get("/central/conteos/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const cab = await pool.query(
      `SELECT c.*, a.sucursal_id FROM conteos_fisicos c JOIN almacenes a ON a.id = c.almacen_id WHERE c.id = $1`,
      [id],
    );
    if (!cab.rowCount) throw new ErrorNegocio("Conteo no encontrado", 404);
    const items = await pool.query(
      `SELECT i.producto_id AS "productoId", p.sku, p.nombre, i.cantidad_sistema AS "sistema",
              i.cantidad_contada AS "contada",
              i.cantidad_contada - i.cantidad_sistema AS diferencia,
              ROUND((i.cantidad_contada - i.cantidad_sistema) * i.costo_promedio, 2) AS "valorDiferencia"
         FROM conteo_items i JOIN productos p ON p.id = i.producto_id
        WHERE i.conteo_id = $1 ORDER BY p.nombre`,
      [id],
    );
    const pendientes = items.rows.filter((i) => i.contada === null).length;
    return { conteo: cab.rows[0], pendientes, items: items.rows };
  });

  /** Registrar lo contado (desde una tablet o lector, por partes). */
  app.put("/central/conteos/:id/items", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ usuarioId: uuid, items: z.array(z.object({ productoId: uuid, cantidadContada: cant })).min(1).max(5000) }).parse(req.body);
    return enTransaccion(async (c) => {
      const cab = await c.query("SELECT estado, almacen_id FROM conteos_fisicos WHERE id = $1 FOR UPDATE", [id]);
      if (!cab.rowCount) throw new ErrorNegocio("Conteo no encontrado", 404);
      if (cab.rows[0].estado !== "ABIERTO") throw new ErrorNegocio("El conteo ya no está abierto", 409);
      for (const i of b.items) {
        // Si el producto no estaba en la foto (ej. apareció mercancía), se agrega con sistema = existencia actual
        await c.query(
          `INSERT INTO conteo_items (id, conteo_id, producto_id, cantidad_sistema, costo_promedio, cantidad_contada, contado_por, contado_en)
           SELECT $1, $2, p.id, COALESCE(e.cantidad, 0), COALESCE(e.costo_promedio, p.costo_promedio), $4, $5, now()
             FROM productos p LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = $6
            WHERE p.id = $3
           ON CONFLICT (conteo_id, producto_id) DO UPDATE
             SET cantidad_contada = EXCLUDED.cantidad_contada, contado_por = EXCLUDED.contado_por, contado_en = now()`,
          [uuidv7(), id, i.productoId, i.cantidadContada, b.usuarioId, cab.rows[0].almacen_id],
        );
      }
      return { registrados: b.items.length };
    });
  });

  /**
   * Aplica el conteo: por cada producto contado se ajusta la DIFERENCIA contra
   * la foto inicial. Las ventas hechas durante el conteo ya están en el
   * kardex, así que no se pierden.
   */
  app.post("/central/conteos/:id/aplicar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ usuarioId: uuid, ceroSiNoContado: z.boolean().default(false) }).parse(req.body);
    return enTransaccion(async (c) => {
      const cab = await c.query(
        `SELECT c.*, a.sucursal_id FROM conteos_fisicos c JOIN almacenes a ON a.id = c.almacen_id WHERE c.id = $1 FOR UPDATE OF c`,
        [id],
      );
      if (!cab.rowCount) throw new ErrorNegocio("Conteo no encontrado", 404);
      const ct = cab.rows[0];
      if (ct.estado !== "ABIERTO" && ct.estado !== "EN_REVISION") throw new ErrorNegocio("El conteo ya fue aplicado o anulado", 409);

      const items = await c.query(
        `SELECT producto_id, cantidad_sistema, COALESCE(cantidad_contada, CASE WHEN $2 THEN 0 END) AS contada, costo_promedio
           FROM conteo_items WHERE conteo_id = $1`,
        [id, b.ceroSiNoContado],
      );
      const lineas: LineaAjuste[] = items.rows
        .filter((i) => i.contada !== null && !new Decimal(i.contada).eq(i.cantidad_sistema))
        .map((i) => ({
          productoId: i.producto_id,
          tipo: "CONTEO_FISICO" as const,
          cantidad: new Decimal(i.contada).minus(i.cantidad_sistema),
          costoUnitario: i.costo_promedio,
        }));

      const ajuste = lineas.length
        ? await crearAjuste(c, {
            sucursalId: ct.sucursal_id, almacenId: ct.almacen_id, usuarioId: b.usuarioId,
            motivo: `Conteo físico: ${ct.alcance}`, origen: "CONTEO", conteoId: id, lineas,
          })
        : null;
      await c.query("UPDATE conteos_fisicos SET estado = 'APLICADO', aplicado_por = $2, aplicado_en = now() WHERE id = $1", [id, b.usuarioId]);
      return { productosConDiferencia: lineas.length, ajuste };
    });
  });

  // -------------------------------------------------------------------
  // Reportes
  // -------------------------------------------------------------------
  app.get("/central/reportes", async () => Object.keys(REPORTES));

  app.get("/central/reportes/:nombre", async (req, rep) => {
    const { nombre } = z.object({ nombre: z.string() }).parse(req.params);
    const def = REPORTES[nombre];
    if (!def) throw new ErrorNegocio("Reporte no existe", 404);
    const f = z
      .object({ sucursalId: uuid.optional(), desde: fecha.optional(), hasta: fecha.optional(), formato: z.enum(["json", "csv"]).default("json"),
        producto: z.string().trim().max(80).optional(), agrupar: z.enum(["dia", "mes"]).default("dia") })
      .parse(req.query);

    const cond: string[] = [];
    const params: unknown[] = [];
    if (def.sucursal) {
      params.push(empresaDe(req));
      cond.push(`sucursal_id IN (SELECT id FROM sucursales WHERE empresa_id = $${params.length})`);
      if (f.sucursalId) {
        params.push(f.sucursalId);
        cond.push(`sucursal_id = $${params.length}`);
      }
      const permitidas = sucursalesDe(req);
      if (permitidas) {
        params.push(permitidas);
        cond.push(`sucursal_id = ANY($${params.length}::uuid[])`);
      }
    }
    if (def.empresa) { params.push(empresaDe(req)); cond.push(`empresa_id = $${params.length}`); }
    if (def.fecha && f.desde) { params.push(f.desde); cond.push(`fecha >= $${params.length}::date`); }
    if (def.fecha && f.hasta) { params.push(f.hasta); cond.push(`fecha <= $${params.length}::date`); }

    if (nombre === "mas-vendidos") {
      const v = await pool.query(
        `SELECT ROW_NUMBER() OVER (ORDER BY SUM(unidades) DESC, nombre)::int AS puesto, sku, nombre,
                SUM(unidades) AS unidades, SUM(venta_neta) AS venta_neta
           FROM ${def.vista} ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
          GROUP BY sku, nombre HAVING SUM(unidades) > 0 ORDER BY 1 LIMIT 200`,
        params,
      );
      return f.formato === "csv" ? enviarCsv(rep, nombre, v.rows) : v.rows;
    }
    if (nombre === "margen-categoria" || nombre === "margen-proveedor") {
      const g = nombre === "margen-categoria" ? "categoria" : "proveedor";
      const v = await pool.query(
        `SELECT ${g}, SUM(unidades) AS unidades, SUM(venta_neta) AS venta_neta, SUM(costo) AS costo, SUM(utilidad) AS utilidad,
                CASE WHEN SUM(venta_neta) = 0 THEN NULL ELSE ROUND(100 * SUM(utilidad) / SUM(venta_neta), 2) END AS margen_pct
           FROM ${def.vista} ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
          GROUP BY 1 HAVING SUM(venta_neta) <> 0 ORDER BY SUM(utilidad) DESC`,
        params,
      );
      return f.formato === "csv" ? enviarCsv(rep, nombre, v.rows) : v.rows;
    }
    if (nombre === "consumo-insumos") {
      const v = await pool.query(
        `SELECT sku, nombre, unidad, SUM(consumo_teorico) AS consumo_teorico, SUM(mermas) AS mermas,
                SUM(faltante_sobrante) AS faltante_sobrante, SUM(costo_consumo) AS costo_consumo
           FROM ${def.vista} ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
          GROUP BY sku, nombre, unidad ORDER BY SUM(costo_consumo) DESC, nombre LIMIT 5000`,
        params,
      );
      return f.formato === "csv" ? enviarCsv(rep, nombre, v.rows) : v.rows;
    }
    if (nombre === "ventas-producto") {
      if (f.producto) {
        params.push(`%${f.producto.replace(/[%_\\]/g, (c) => "\\" + c)}%`);
        cond.push(`(nombre ILIKE $${params.length} OR sku ILIKE $${params.length})`);
      }
      const periodo = f.agrupar === "mes" ? "to_char(fecha, 'YYYY-MM')" : "fecha";
      const v = await pool.query(
        `SELECT ${periodo} AS periodo, sku, nombre, SUM(unidades) AS unidades, SUM(venta_neta) AS venta_neta
           FROM ${def.vista} ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
          GROUP BY 1, 2, 3 HAVING SUM(unidades) <> 0 ORDER BY 1 DESC, SUM(unidades) DESC, 3 LIMIT 20000`,
        params,
      );
      return f.formato === "csv" ? enviarCsv(rep, nombre, v.rows) : v.rows;
    }
    const r = await pool.query(
      `SELECT * FROM ${def.vista} ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY ${def.orden ?? "1"} LIMIT 20000`,
      params,
    );
    return f.formato === "csv" ? enviarCsv(rep, nombre, r.rows) : r.rows;
  });

  /** Kardex de un producto en una sucursal, con saldo y costo después de cada movimiento. */
  app.get("/central/kardex", async (req, rep) => {
    const f = z
      .object({ productoId: uuid, sucursalId: uuid, desde: fecha.optional(), hasta: fecha.optional(), formato: z.enum(["json", "csv"]).default("json") })
      .parse(req.query);
    const r = await pool.query(
      `SELECT k.creado_en AS fecha, k.tipo, k.documento_tipo AS documento, k.cantidad,
              k.costo_unitario AS costo, k.saldo_cantidad AS saldo, k.saldo_costo_promedio AS "costoPromedio",
              k.saldo_valor AS "valorSaldo", u.nombre AS usuario, k.motivo, a.nombre AS almacen
         FROM kardex_movimientos k
         JOIN usuarios u ON u.id = k.usuario_id
         JOIN almacenes a ON a.id = k.almacen_id
        WHERE k.producto_id = $1 AND k.sucursal_id = $2
          AND ($3::date IS NULL OR k.creado_en >= $3::date)
          AND ($4::date IS NULL OR k.creado_en < $4::date + 1)
        ORDER BY k.almacen_id, k.creado_en, k.id`,
      [f.productoId, f.sucursalId, f.desde ?? null, f.hasta ?? null],
    );
    return f.formato === "csv" ? enviarCsv(rep, "kardex", r.rows) : r.rows;
  });

  // -------------------------------------------------------------------
  // Módulos por sucursal y repartidores
  // -------------------------------------------------------------------
  app.get("/central/sucursales/:id/modulos", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query("SELECT modulos FROM configuracion_sucursal WHERE sucursal_id = $1", [id]);
    return { delivery: { activo: false }, ...(r.rows[0]?.modulos ?? {}) };
  });

  app.put("/central/sucursales/:id/modulos", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z
      .object({
        delivery: z
          .object({
            activo: z.boolean(),
            cargoEnvio: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
            productoEnvioId: uuid.optional(),
            tiempoEstimadoMin: z.number().int().min(5).max(240).optional(),
          })
          .optional(),
      })
      .parse(req.body);
    const r = await pool.query(
      `INSERT INTO configuracion_sucursal (sucursal_id, modulos) VALUES ($1, $2)
       ON CONFLICT (sucursal_id) DO UPDATE SET modulos = configuracion_sucursal.modulos || (
         -- Mezcla por módulo: cambiar solo "activo" no borra el cargo de envío ni lo demás
         SELECT COALESCE(jsonb_object_agg(k, COALESCE(configuracion_sucursal.modulos -> k, '{}'::jsonb) || v), '{}'::jsonb)
           FROM jsonb_each(EXCLUDED.modulos) AS m(k, v))
       RETURNING modulos`,
      [id, JSON.stringify(b)],
    );
    return r.rows[0].modulos;
  });

  app.get("/central/sucursales/:id/repartidores", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      `SELECT r.*, COALESCE(p.monto_pendiente, 0) AS monto_pendiente
         FROM repartidores r LEFT JOIN rpt_delivery_pendiente p ON p.repartidor_id = r.id
        WHERE r.sucursal_id = $1 ORDER BY r.activo DESC, r.nombre`,
      [id],
    );
    return r.rows;
  });

  app.post("/central/sucursales/:id/repartidores", async (req, rep) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nombre: z.string().trim().min(2).max(80), telefono: z.string().max(20).optional(), vehiculo: z.string().max(30).optional() }).parse(req.body);
    const nuevo = uuidv7();
    await pool.query("INSERT INTO repartidores (id, sucursal_id, nombre, telefono, vehiculo) VALUES ($1,$2,$3,$4,$5)", [
      nuevo, id, b.nombre, b.telefono ?? null, b.vehiculo ?? null,
    ]);
    rep.code(201);
    return { id: nuevo };
  });

  app.patch("/central/repartidores/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ activo: z.boolean() }).parse(req.body);
    const r = await pool.query("UPDATE repartidores SET activo = $2 WHERE id = $1 RETURNING id, nombre, activo", [id, b.activo]);
    if (!r.rowCount) throw new ErrorNegocio("Repartidor no encontrado", 404);
    return r.rows[0];
  });

  // Catálogo básico para los formularios de la administración
  app.get("/central/catalogo", async (req) => {
    const e = empresaDe(req);
    const [sucursales, productos, categorias, usuarios] = await Promise.all([
      pool.query(
        `SELECT s.id, s.codigo, s.nombre, s.tipo,
                (SELECT a.id FROM almacenes a WHERE a.sucursal_id = s.id AND a.es_principal) AS "almacenId",
                COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'principal', a.es_principal)
                                           ORDER BY a.es_principal DESC, a.nombre)
                            FROM almacenes a WHERE a.sucursal_id = s.id), '[]') AS almacenes
           FROM sucursales s WHERE s.empresa_id = $1 AND s.activo AND ($2::uuid[] IS NULL OR s.id = ANY($2)) ORDER BY s.nombre`,
        [e, sucursalesDe(req)],
      ),
      pool.query(
        `SELECT p.id, p.sku, p.nombre, p.categoria_id AS "categoriaId",
                (SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'nombre', pr.nombre, 'factor', pr.factor) ORDER BY pr.factor)
                   FROM presentaciones pr WHERE pr.producto_id = p.id) AS presentaciones
           FROM productos p WHERE p.empresa_id = $1 AND p.activo ORDER BY p.nombre`,
        [e],
      ),
      pool.query("SELECT id, nombre FROM categorias WHERE empresa_id = $1 ORDER BY nombre", [e]),
      pool.query("SELECT id, nombre FROM usuarios WHERE empresa_id = $1 AND activo ORDER BY nombre", [e]),
    ]);
    return { sucursales: sucursales.rows, productos: productos.rows, categorias: categorias.rows, usuarios: usuarios.rows };
  });
}


/**
 * Borrados profundos de Seguridad. Nunca tocan facturas, ventas, e-CF ni secuencias NCF.
 *  HISTORIAL: existencias en cero y borra el kardex de la sucursal (el trigger de inmutabilidad se suspende solo dentro de esta transacción).
 *  PRODUCTOS: además borra los productos sin ventas, compras, pedidos ni cotizaciones; los que sí tienen se dan de baja (inactivos).
 *  CATALOGO: además borra categorías, ofertas y conteos/transferencias/ajustes de esos productos.
 */
async function borrarProfundo(c: PoolClient, empresa: string, sucursalId: string, alcance: "HISTORIAL" | "PRODUCTOS" | "CATALOGO", usuarioId: string, motivo: string) {
  const s = await c.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2", [sucursalId, empresa]);
  if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
  const out: Record<string, number> = {};
  const n = async (k: string, sql: string, par: unknown[] = []) => { out[k] = (await c.query(sql, par)).rowCount ?? 0; };
  // Existencias en cero y kardex de la sucursal
  await c.query(`UPDATE existencias SET cantidad = 0 WHERE almacen_id IN (SELECT id FROM almacenes WHERE sucursal_id = $1)`, [sucursalId]);
  await c.query(`DELETE FROM existencias_lote WHERE almacen_id IN (SELECT id FROM almacenes WHERE sucursal_id = $1)`, [sucursalId]);
  await c.query("ALTER TABLE kardex_movimientos DISABLE TRIGGER tr_kardex_inmutable");
  await n("movimientos", "DELETE FROM kardex_movimientos WHERE sucursal_id = $1", [sucursalId]);
  await c.query("ALTER TABLE kardex_movimientos ENABLE TRIGGER tr_kardex_inmutable");
  if (alcance !== "HISTORIAL") {
    const ids = `SELECT p.id FROM productos p WHERE p.empresa_id = $1
      AND NOT EXISTS (SELECT 1 FROM presentaciones pr JOIN venta_items vi ON vi.presentacion_id = pr.id WHERE pr.producto_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM presentaciones pr JOIN compra_items ci ON ci.presentacion_id = pr.id WHERE pr.producto_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM presentaciones pr JOIN pedidos_clientes_items x ON x.presentacion_id = pr.id WHERE pr.producto_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM presentaciones pr JOIN cotizacion_lineas x ON x.presentacion_id = pr.id WHERE pr.producto_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM kardex_movimientos k WHERE k.producto_id = p.id)`;
    const q = async (sql: string) => c.query(sql, [empresa]);
    const pres = `SELECT id FROM presentaciones WHERE producto_id IN (${ids})`;
    for (const t of ["existencias_lote", "lotes", "existencias", "producto_sucursal", "producto_proveedores", "conteo_items", "ajuste_items", "transferencia_items", "pedido_sucursal_items"]) {
      await q(`DELETE FROM ${t} WHERE producto_id IN (${ids})`);
    }
    await q(`DELETE FROM producto_componentes WHERE combo_id IN (${ids}) OR componente_id IN (${ids})`);
    await q(`DELETE FROM oferta_alcance WHERE producto_id IN (${ids}) OR presentacion_id IN (${pres})`);
    for (const t of ["codigos_barra", "precios", "historial_precios"]) await q(`DELETE FROM ${t} WHERE presentacion_id IN (${pres})`);
    await q(`DELETE FROM presentaciones WHERE producto_id IN (${ids})`);
    const del = await q(`DELETE FROM productos WHERE id IN (${ids})`);
    out.productosBorrados = del.rowCount ?? 0;
    const baja = await c.query("UPDATE productos SET activo = FALSE WHERE empresa_id = $1 AND activo", [empresa]);
    out.productosDadosDeBaja = baja.rowCount ?? 0;
    if (alcance === "CATALOGO") {
      await c.query("DELETE FROM oferta_alcance WHERE categoria_id IN (SELECT id FROM categorias WHERE empresa_id = $1)", [empresa]);
      await c.query("UPDATE productos SET categoria_id = NULL WHERE empresa_id = $1", [empresa]);
      await c.query("UPDATE categorias SET padre_id = NULL WHERE empresa_id = $1", [empresa]);
      const cat = await c.query("DELETE FROM categorias WHERE empresa_id = $1", [empresa]);
      out.categorias = cat.rowCount ?? 0;
    }
  }
  await c.query(
    `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
     VALUES ($1,$2,$3,$3,$4,'inventario',$2,$5)`,
    [uuidv7(), sucursalId, usuarioId, `inventario.borrar.${alcance.toLowerCase()}`, JSON.stringify({ motivo, ...out })]);
  return { alcance, ...out };
}
