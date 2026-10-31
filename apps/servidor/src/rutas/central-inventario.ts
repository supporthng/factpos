import { sucursalesDe } from "../sesion.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { repartirPorLotes } from "../lotes.js";
import { exigirFuncion } from "./central-seguridad.js";

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
const REPORTES: Record<string, { vista: string; fecha?: boolean; sucursal?: boolean; orden?: string }> = {
  "ventas-diarias": { vista: "rpt_ventas_diarias", fecha: true, sucursal: true, orden: "fecha DESC" },
  "utilidad-productos": { vista: "rpt_utilidad_producto", fecha: true, sucursal: true, orden: "utilidad DESC" },
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
  "sucursales": { vista: "rpt_resumen_sucursales", sucursal: true, orden: "sucursal" },
  "ventas-sucursal": { vista: "rpt_ventas_sucursal", fecha: true, sucursal: true, orden: "fecha DESC, venta_total DESC" },
  "ventas-comprobante": { vista: "rpt_ventas_comprobante", fecha: true, sucursal: true, orden: "fecha DESC, prefijo, tipo" },
  "cierres-caja": { vista: "rpt_cierres_caja", fecha: true, sucursal: true, orden: "cerrado_en DESC" },
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
  // Ajustes de inventario
  // -------------------------------------------------------------------
  /**
   * Existencia desde la pantalla de Productos (al crear, al editar o al importar): entrada al kardex como ajuste.
   * Solo si un administrador activó «agregar_existencia» en Configuración › Seguridad.
   */
  app.post("/central/productos-existencia", async (req, rep) => {
    const e = empresaDe(req);
    await exigirFuncion(e, "agregar_existencia");
    const b = z.object({
      sucursalId: uuid, almacenId: uuid.optional(),
      motivo: z.string().trim().min(3).max(200).default("Existencia agregada desde Productos"),
      items: z.array(z.object({
        productoId: uuid, cantidad: cant.refine((v) => Number(v) > 0, "La cantidad debe ser mayor que cero"),
        costoUnitario: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(), nota: z.string().max(200).optional(),
      })).min(1).max(2000),
    }).parse(req.body);
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
      .object({ sucursalId: uuid.optional(), desde: fecha.optional(), hasta: fecha.optional(), formato: z.enum(["json", "csv"]).default("json") })
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
    if (def.fecha && f.desde) { params.push(f.desde); cond.push(`fecha >= $${params.length}::date`); }
    if (def.fecha && f.hasta) { params.push(f.hasta); cond.push(`fecha <= $${params.length}::date`); }

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
