import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { tienePermiso, sucursalesDe, type SesionAdmin } from "../sesion.js";
import { estadoCuotas } from "./credito-plan.js";
import { encolarFilas } from "../sync/outbox.js";

/**
 * Mora y recuperación de mercancía (mueblería).
 *  - Mora: los planes de cuotas con cuotas vencidas, con lo que debe y la mora por cobrar.
 *  - Recuperación: el acta de lo que se recoge a un cliente que no paga. Un supervisor (permiso de anular ventas) la aplica:
 *    lo valorado se descuenta de la deuda (ajuste de cuenta) y la mercancía entra al almacén «Recuperada», aparte del piso de venta,
 *    con su serie libre para poder revenderse. No devuelve dinero. (La nota de crédito fiscal y la reventa como USADO van aparte.)
 * (El permiso de las rutas lo da el prefijo /central/cxc: admin.cxc.)
 */
type Db = Pick<PoolClient, "query">;
const uuid = z.string().uuid();
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
const hoyRD = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);

export async function rutasCentralRecuperaciones(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);
  const permisos = (req: unknown) => ((req as { sesion?: SesionAdmin }).sesion?.p ?? []) as string[];
  const clienteDe = async (empresaId: string, clienteId: string) => {
    const r = await pool.query("SELECT id, nombre FROM clientes WHERE id = $1 AND empresa_id = $2", [clienteId, empresaId]);
    if (!r.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
    return r.rows[0] as { id: string; nombre: string };
  };
  const saldoDe = async (c: Db, clienteId: string) =>
    new Decimal((await c.query("SELECT COALESCE(SUM(monto), 0) AS s FROM cxc_movimientos WHERE cliente_id = $1", [clienteId])).rows[0].s);
  const sucursalDe = async (c: Db, empresaId: string, sucursalId?: string | null): Promise<string> => {
    if (sucursalId) return sucursalId;
    const r = await c.query("SELECT id FROM sucursales WHERE empresa_id = $1 AND activo ORDER BY tipo = 'ALMACEN', codigo LIMIT 1", [empresaId]);
    if (!r.rowCount) throw new ErrorNegocio("No hay sucursal activa");
    return r.rows[0].id;
  };

  // ------------------------------------------------------------------------------------------------ Mora
  app.get("/central/cxc/mora", async (req) => {
    const empresaId = empresaDe(req);
    const permitidas = sucursalesDe(req);
    const ps = await pool.query<{ id: string; cliente_id: string; creado_en: Date; mora_pct: string; dias_gracia: number; total: string; nombre: string; cliente: string; telefono: string | null;
      documento: string | null; garante_nombre: string | null; garante_telefono: string | null; venta_id: string | null; factura: number | null; saldo: string }>(
      `SELECT p.id, p.cliente_id, p.creado_en, p.mora_pct::text, p.dias_gracia, p.total::text, p.nombre, cl.nombre AS cliente, cl.telefono, cl.documento,
              p.garante_nombre, p.garante_telefono, p.venta_id, v.numero_interno AS factura,
              COALESCE((SELECT SUM(m.monto) FROM cxc_movimientos m WHERE m.cliente_id = p.cliente_id), 0)::text AS saldo
         FROM cxc_planes p JOIN clientes cl ON cl.id = p.cliente_id LEFT JOIN ventas v ON v.id = p.venta_id
        WHERE p.empresa_id = $1 AND p.estado = 'ACTIVO'
          AND ($2::uuid[] IS NULL OR v.sucursal_id IS NULL OR v.sucursal_id = ANY($2::uuid[]))`, [empresaId, permitidas]);
    const hoy = hoyRD();
    const filas = [];
    for (const p of ps.rows) {
      const q = await pool.query(`SELECT numero, to_char(vence,'YYYY-MM-DD') AS vence, monto::text, mora_cobrada::text AS "moraCobrada" FROM cxc_cuotas WHERE plan_id = $1 ORDER BY numero`, [p.id]);
      const pagado = new Decimal((await pool.query(
        `SELECT COALESCE(-SUM(monto) FILTER (WHERE tipo = 'ABONO'), 0) + COALESCE(SUM(monto) FILTER (WHERE tipo = 'AJUSTE' AND notas LIKE 'Anulación del abono%'), 0) AS p
           FROM cxc_movimientos WHERE cliente_id = $1 AND creado_en >= $2`, [p.cliente_id, p.creado_en])).rows[0].p);
      const e = estadoCuotas(q.rows, pagado, hoy, p.mora_pct, p.dias_gracia);
      const vencidas = e.filter((x) => x.estado === "VENCIDA");
      if (!vencidas.length) continue;
      const suma = (arr: typeof e, k: "pendiente" | "moraPorCobrar") => arr.reduce((a, x) => a.plus(x[k]), new Decimal(0)).toFixed(2);
      filas.push({
        planId: p.id, clienteId: p.cliente_id, cliente: p.cliente, telefono: p.telefono, documento: p.documento, plan: p.nombre,
        garante: p.garante_nombre, garanteTelefono: p.garante_telefono, ventaId: p.venta_id, factura: p.factura, saldo: p.saldo,
        cuotasVencidas: vencidas.length, cuotas: e.length, diasAtraso: Math.max(...vencidas.map((x) => x.diasAtraso)),
        vencido: suma(vencidas, "pendiente"), moraPorCobrar: suma(e, "moraPorCobrar"),
      });
    }
    filas.sort((a, b) => b.diasAtraso - a.diasAtraso);
    return filas;
  });

  // ------------------------------------------------------------------------------------------------ Actas
  /** Qué se le puede recoger al cliente: lo de la factura financiada (con sus series vigentes) */
  app.get("/central/cxc/:clienteId/recuperables", async (req) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    await clienteDe(empresaDe(req), clienteId);
    const plan = (await pool.query<{ id: string; venta_id: string | null }>("SELECT id, venta_id FROM cxc_planes WHERE cliente_id = $1 AND estado = 'ACTIVO'", [clienteId])).rows[0];
    if (!plan?.venta_id) return { planId: plan?.id ?? null, ventaId: null, lineas: [] };
    const l = await pool.query(
      `SELECT i.id AS "itemId", i.presentacion_id AS "presentacionId", pr.producto_id AS "productoId", i.descripcion, i.cantidad::text, i.factor::text, i.total::text, p.usa_series AS "usaSeries",
              COALESCE((SELECT jsonb_agg(s.serie ORDER BY s.serie) FROM series_producto s WHERE s.venta_item_id = i.id AND s.devuelta_en IS NULL), '[]'::jsonb) AS series
         FROM venta_items i JOIN presentaciones pr ON pr.id = i.presentacion_id JOIN productos p ON p.id = pr.producto_id
        WHERE i.venta_id = $1 AND p.tipo = 'INVENTARIABLE' ORDER BY i.linea`, [plan.venta_id]);
    return { planId: plan.id, ventaId: plan.venta_id, lineas: l.rows };
  });

  const Item = z.object({
    presentacionId: uuid, serie: z.string().trim().max(60).optional(), cantidad: z.string().regex(/^\d+(\.\d{1,3})?$/).default("1"),
    estadoFisico: z.enum(["BUENO", "REGULAR", "DANADO"]), valoracion: monto, nota: z.string().trim().max(200).optional(),
  });
  const NuevaActa = z.object({
    planId: uuid.optional(), ventaId: uuid.optional(), motivo: z.string().trim().min(5, "Explique el motivo").max(300),
    fechaRecogida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), items: z.array(Item).min(1, "Agregue al menos un artículo").max(50),
  });

  app.post("/central/cxc/:clienteId/recuperaciones", async (req, rep) => {
    const { clienteId } = z.object({ clienteId: uuid }).parse(req.params);
    const b = NuevaActa.parse(req.body);
    const empresaId = empresaDe(req);
    await clienteDe(empresaId, clienteId);
    const id = uuidv7();
    const r = await enTransaccion(async (c) => {
      const plan = b.planId ? (await c.query<{ venta_id: string | null }>("SELECT venta_id FROM cxc_planes WHERE id = $1 AND cliente_id = $2 AND estado = 'ACTIVO'", [b.planId, clienteId])).rows[0] : null;
      if (b.planId && !plan) throw new ErrorNegocio("El plan ya no está activo", 404);
      const ventaId = plan?.venta_id ?? b.ventaId ?? null;
      const sucursalId = ventaId ? ((await c.query("SELECT sucursal_id FROM ventas WHERE id = $1", [ventaId])).rows[0]?.sucursal_id ?? await sucursalDe(c, empresaId)) : await sucursalDe(c, empresaId);
      await c.query("SELECT pg_advisory_xact_lock(hashtext('recuperacion:' || $1))", [sucursalId]);
      let valor = new Decimal(0);
      const filas = [];
      for (const it of b.items) {
        const p = (await c.query<{ producto_id: string; nombre: string; factor: string; tipo: string; usa_series: boolean }>(
          `SELECT pr.producto_id, p.nombre, pr.factor::text, p.tipo, p.usa_series FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id WHERE pr.id = $1 AND p.empresa_id = $2`, [it.presentacionId, empresaId])).rows[0];
        if (!p) throw new ErrorNegocio("Un artículo no existe", 404);
        if (p.tipo !== "INVENTARIABLE") throw new ErrorNegocio(`${p.nombre} no es inventariable: no se recupera`);
        const serie = it.serie ? it.serie.toUpperCase().replace(/\s+/g, "") : null;
        if (p.usa_series) {
          if (!serie) throw new ErrorNegocio(`${p.nombre}: escriba el número de serie que se recoge`);
          const s = await c.query("SELECT 1 FROM series_producto WHERE producto_id = $1 AND serie = $2 AND cliente_id = $3 AND devuelta_en IS NULL", [p.producto_id, serie, clienteId]);
          if (!s.rowCount) throw new ErrorNegocio(`La serie ${serie} no está vendida a este cliente`);
        }
        if (ventaId) {
          const enFactura = await c.query("SELECT 1 FROM venta_items WHERE venta_id = $1 AND presentacion_id = $2", [ventaId, it.presentacionId]);
          if (!enFactura.rowCount) throw new ErrorNegocio(`${p.nombre} no está en la factura financiada`);
        }
        const cantidad = new Decimal(it.cantidad).mul(p.factor);
        valor = valor.plus(it.valoracion);
        filas.push({ it, p, serie, cantidad });
      }
      const numero = (await c.query<{ numero: string }>(
        `INSERT INTO recuperaciones (id, sucursal_id, numero, cliente_id, plan_id, venta_id, motivo, fecha_recogida, valor_total, creada_por)
         VALUES ($1,$2,(SELECT COALESCE(MAX(numero),0)+1 FROM recuperaciones WHERE sucursal_id = $2),$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9) RETURNING numero::text`,
        [id, sucursalId, clienteId, b.planId ?? null, ventaId, b.motivo, b.fechaRecogida ?? null, valor.toFixed(2), usuarioDe(req)])).rows[0].numero;
      for (const f of filas) {
        await c.query(
          `INSERT INTO recuperacion_items (id, recuperacion_id, producto_id, presentacion_id, descripcion, serie, cantidad, estado_fisico, valoracion, nota)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [uuidv7(), id, f.p.producto_id, f.it.presentacionId, f.p.nombre, f.serie, f.cantidad.toFixed(3), f.it.estadoFisico, f.it.valoracion, f.it.nota ?? null]);
      }
      return numero;
    });
    rep.code(201);
    return { id, numero: r };
  });

  const SQL_ACTA = `SELECT r.id, 'RM-' || lpad(r.numero::text, 6, '0') AS acta, r.estado, r.motivo, to_char(r.fecha_recogida,'YYYY-MM-DD') AS "fechaRecogida", r.valor_total::text AS "valorTotal",
        r.saldo_antes::text AS "saldoAntes", r.saldo_despues::text AS "saldoDespues", r.creada_en AS "creadaEn", r.aplicada_en AS "aplicadaEn",
        cl.id AS "clienteId", cl.nombre AS cliente, cl.documento, s.nombre AS sucursal, u.nombre AS "creadaPor", ua.nombre AS "aplicadaPor", v.numero_interno AS factura,
        (SELECT jsonb_agg(jsonb_build_object('id', i.id, 'descripcion', i.descripcion, 'serie', i.serie, 'cantidad', i.cantidad, 'estadoFisico', i.estado_fisico, 'valoracion', i.valoracion) ORDER BY i.descripcion)
           FROM recuperacion_items i WHERE i.recuperacion_id = r.id) AS items
      FROM recuperaciones r JOIN clientes cl ON cl.id = r.cliente_id JOIN sucursales s ON s.id = r.sucursal_id
      LEFT JOIN usuarios u ON u.id = r.creada_por LEFT JOIN usuarios ua ON ua.id = r.aplicada_por LEFT JOIN ventas v ON v.id = r.venta_id`;

  app.get("/central/cxc/recuperaciones", async (req) => {
    const r = await pool.query(`${SQL_ACTA} WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) ORDER BY r.creada_en DESC LIMIT 200`, [empresaDe(req), sucursalesDe(req)]);
    return r.rows;
  });

  const cargarActa = async (c: Db, id: string, empresaId: string) => {
    const r = await c.query(`${SQL_ACTA} WHERE r.id = $1 AND s.empresa_id = $2`, [id, empresaId]);
    if (!r.rowCount) throw new ErrorNegocio("Acta no encontrada", 404);
    return r.rows[0];
  };
  app.get("/central/cxc/recuperaciones/:id", async (req) => cargarActa(pool, z.object({ id: uuid }).parse((req.params as object)).id, empresaDe(req)));

  app.post("/central/cxc/recuperaciones/:id/cancelar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      `UPDATE recuperaciones r SET estado = 'CANCELADA' FROM sucursales s WHERE r.id = $1 AND s.id = r.sucursal_id AND s.empresa_id = $2 AND r.estado = 'ABIERTA'`, [id, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("El acta no existe o ya no está abierta", 404);
    return { ok: true };
  });

  /** Almacén «Recuperada» de la sucursal (se crea la primera vez) */
  const almacenRecuperada = async (c: Db, sucursalId: string): Promise<string> => {
    const e = await c.query("SELECT id FROM almacenes WHERE sucursal_id = $1 AND nombre = 'Recuperada' LIMIT 1", [sucursalId]);
    if (e.rowCount) return e.rows[0].id;
    const id = uuidv7();
    await c.query("INSERT INTO almacenes (id, sucursal_id, nombre, es_principal) VALUES ($1,$2,'Recuperada',false)", [id, sucursalId]);
    return id;
  };

  /**
   * Aplicar el acta (supervisor): descuenta lo valorado de la deuda y manda la mercancía al almacén «Recuperada».
   * Lo valorado no puede pasar de lo que el cliente debe (no se le devuelve dinero).
   */
  app.post("/central/cxc/recuperaciones/:id/aplicar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    if (!tienePermiso(permisos(req), "venta.anular")) throw new ErrorNegocio("Aplicar una recuperación lo decide un supervisor (permiso de anular ventas).", 403);
    const empresaId = empresaDe(req);
    const usuarioId = usuarioDe(req);
    return enTransaccion(async (c) => {
      const a = (await c.query<{ id: string; numero: string; sucursal_id: string; cliente_id: string; plan_id: string | null; venta_id: string | null; estado: string; valor_total: string }>(
        `SELECT r.id, r.numero::text, r.sucursal_id, r.cliente_id, r.plan_id, r.venta_id, r.estado, r.valor_total::text
           FROM recuperaciones r JOIN sucursales s ON s.id = r.sucursal_id WHERE r.id = $1 AND s.empresa_id = $2 FOR UPDATE OF r`, [id, empresaId])).rows[0];
      if (!a) throw new ErrorNegocio("Acta no encontrada", 404);
      if (a.estado !== "ABIERTA") throw new ErrorNegocio("Esta acta ya no está abierta", 409);
      await c.query("SELECT 1 FROM clientes WHERE id = $1 FOR UPDATE", [a.cliente_id]);
      const saldo = await saldoDe(c, a.cliente_id);
      const valor = new Decimal(a.valor_total);
      if (valor.lte(0)) throw new ErrorNegocio("La valoración total debe ser mayor que cero");
      if (valor.gt(saldo)) throw new ErrorNegocio(`Lo valorado (RD$ ${valor.toFixed(2)}) pasa de lo que el cliente debe (RD$ ${saldo.toFixed(2)}): baje la valoración`);
      const acta = `RM-${a.numero.padStart(6, "0")}`;
      const items = (await c.query<{ id: string; producto_id: string; presentacion_id: string | null; descripcion: string; serie: string | null; cantidad: string; valoracion: string }>(
        "SELECT id, producto_id, presentacion_id, descripcion, serie, cantidad::text, valoracion::text FROM recuperacion_items WHERE recuperacion_id = $1", [id])).rows;
      const almacenId = await almacenRecuperada(c, a.sucursal_id);
      for (const it of items) {
        // Entra a «Recuperada» al costo reconocido al cliente (lo que le costó recuperarla)
        const costo = new Decimal(it.valoracion).div(it.cantidad).toDecimalPlaces(4);
        await c.query(
          `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, documento_tipo, documento_id, motivo, usuario_id)
           VALUES ($1,$2,$3,$4,'AJUSTE_ENTRADA',$5,$6,'recuperacion',$7,$8,$9)`,
          [uuidv7(), a.sucursal_id, almacenId, it.producto_id, it.cantidad, costo.toFixed(4), id, `Mercancía recuperada ${acta}${it.serie ? ` · serie ${it.serie}` : ""}`, usuarioId]);
        if (it.serie) await c.query("UPDATE series_producto SET devuelta_en = now() WHERE producto_id = $1 AND serie = $2 AND cliente_id = $3 AND devuelta_en IS NULL", [it.producto_id, it.serie, a.cliente_id]);
      }
      // Ajuste de cuenta: baja la deuda; si cabe en la factura financiada se le aplica a ella
      let ventaMov: string | null = null;
      if (a.venta_id) {
        const f = (await c.query<{ pendiente: string }>("SELECT pendiente FROM rpt_cxc_facturas WHERE cliente_id = $1 AND venta_id = $2", [a.cliente_id, a.venta_id])).rows[0];
        if (f && new Decimal(f.pendiente).gte(valor)) ventaMov = a.venta_id;
      }
      const mov = uuidv7();
      await c.query(
        `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, venta_id, usuario_id, notas, autorizado_por)
         VALUES ($1,$2,$3,'AJUSTE',$4,$5,$6,$7,$6)`,
        [mov, a.sucursal_id, a.cliente_id, valor.neg().toFixed(2), ventaMov, usuarioId, `Mercancía recuperada ${acta}: se descuenta de la deuda`]);
      await encolarFilas(c as PoolClient, "cxc_movimientos", [mov]);
      const despues = saldo.minus(valor);
      await c.query(
        "UPDATE recuperaciones SET estado = 'APLICADA', saldo_antes = $2, saldo_despues = $3, ajuste_id = $4, aplicada_por = $5, aplicada_en = now() WHERE id = $1",
        [id, saldo.toFixed(2), despues.toFixed(2), mov, usuarioId]);
      if (a.plan_id && despues.lte(0)) await c.query("UPDATE cxc_planes SET estado = 'PAGADO', cerrado_en = now(), notas = COALESCE(notas || ' · ', '') || $2 WHERE id = $1 AND estado = 'ACTIVO'", [a.plan_id, `Saldado con la recuperación ${acta}`]);
      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
         VALUES ($1,$2,$3,$3,'cxc.recuperacion','recuperacion',$4,$5)`,
        [uuidv7(), a.sucursal_id, usuarioId, id, JSON.stringify({ acta, valor: valor.toFixed(2), saldoAntes: saldo.toFixed(2), saldoDespues: despues.toFixed(2), articulos: items.length })]);
      return { acta, saldoAntes: saldo.toFixed(2), saldoDespues: despues.toFixed(2), planSaldado: !!a.plan_id && despues.lte(0) };
    });
  });

  // ------------------------------------------------------------------------------------------------ Mercancía recuperada
  app.get("/central/cxc/recuperada", async (req) => {
    const r = await pool.query(
      `SELECT i.id, i.descripcion, i.serie, i.cantidad::text, i.estado_fisico AS "estadoFisico", i.valoracion::text, i.costo_reparacion::text AS "costoReparacion",
              i.precio_usado::text AS "precioUsado", i.garantia_meses AS "garantiaMeses", i.producto_usado_id AS "productoUsadoId", pu.sku AS "skuUsado",
              CASE WHEN i.proceso = 'VENDIDA' OR (i.producto_usado_id IS NOT NULL AND EXISTS (SELECT 1 FROM kardex_movimientos k WHERE k.producto_id = i.producto_usado_id AND k.tipo = 'VENTA')) THEN 'VENDIDA' ELSE i.proceso END AS proceso, i.nota, 'RM-' || lpad(r.numero::text, 6, '0') AS acta, to_char(r.fecha_recogida,'YYYY-MM-DD') AS "fechaRecogida",
              cl.nombre AS cliente, s.nombre AS sucursal
         FROM recuperacion_items i JOIN recuperaciones r ON r.id = i.recuperacion_id JOIN clientes cl ON cl.id = r.cliente_id JOIN sucursales s ON s.id = r.sucursal_id
         LEFT JOIN productos pu ON pu.id = i.producto_usado_id
        WHERE r.estado = 'APLICADA' AND s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))
        ORDER BY (i.proceso = 'VENDIDA'), r.aplicada_en DESC, i.descripcion LIMIT 500`, [empresaDe(req), sucursalesDe(req)]);
    return r.rows;
  });
  /**
   * Cambiar un artículo recuperado. Al pasarlo a «Lista» se publica como producto USADO: sale de «Recuperada», entra al piso de venta
   * con su precio de usado y garantía reducida, y se factura como cualquier artículo (con su serie).
   */
  app.put("/central/cxc/recuperada/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      proceso: z.enum(["EN_REVISION", "EN_REPARACION", "LISTA"]).optional(), estadoFisico: z.enum(["BUENO", "REGULAR", "DANADO"]).optional(),
      costoReparacion: monto.optional(), precioUsado: monto.nullable().optional(), garantiaMeses: z.number().int().min(0).max(60).optional(), nota: z.string().trim().max(200).optional(),
    }).parse(req.body);
    const empresaId = empresaDe(req);
    const usuarioId = usuarioDe(req);
    return enTransaccion(async (c) => {
      const it = (await c.query<{ id: string; recuperacion_id: string; producto_id: string; descripcion: string; serie: string | null; cantidad: string; valoracion: string; costo_reparacion: string;
        precio_usado: string | null; proceso: string; producto_usado_id: string | null; sucursal_id: string; numero: string; garantia_meses: number }>(
        `SELECT i.id, i.recuperacion_id, i.producto_id, i.descripcion, i.serie, i.cantidad::text, i.valoracion::text, i.costo_reparacion::text, i.precio_usado::text, i.proceso, i.producto_usado_id,
                r.sucursal_id, r.numero::text, i.garantia_meses
           FROM recuperacion_items i JOIN recuperaciones r ON r.id = i.recuperacion_id JOIN sucursales s ON s.id = r.sucursal_id
          WHERE i.id = $1 AND s.empresa_id = $2 AND r.estado = 'APLICADA' FOR UPDATE OF i`, [id, empresaId])).rows[0];
      if (!it) throw new ErrorNegocio("El artículo no existe", 404);
      const vendida = it.proceso === "VENDIDA" || (it.producto_usado_id && (await c.query("SELECT 1 FROM kardex_movimientos WHERE producto_id = $1 AND tipo = 'VENTA' LIMIT 1", [it.producto_usado_id])).rowCount);
      if (vendida) throw new ErrorNegocio("Ese artículo ya se vendió", 409);
      const precio = b.precioUsado === undefined ? it.precio_usado : b.precioUsado;
      const repar = b.costoReparacion ?? it.costo_reparacion;
      const garantia = b.garantiaMeses ?? it.garantia_meses;
      const proceso = b.proceso ?? it.proceso;
      if (it.producto_usado_id && b.proceso && b.proceso !== "LISTA") throw new ErrorNegocio("Ya está en el piso de venta: no se puede regresar a revisión. Si no se va a vender, ajuste su existencia en inventario.", 409);
      let productoUsadoId = it.producto_usado_id;
      if (proceso === "LISTA" && !productoUsadoId) {
        if (!precio || Number(precio) <= 0) throw new ErrorNegocio("Para marcarla lista ponga el precio de usado");
        productoUsadoId = uuidv7();
        const sku = `USADO-${it.id.slice(-8).toUpperCase()}`;
        const nombre = `${it.descripcion} (USADO)${it.serie ? ` · ${it.serie}` : ""}`.slice(0, 200);
        const ins = await c.query(
          `INSERT INTO productos (id, empresa_id, categoria_id, sku, nombre, unidad_base, es_pesable, controla_stock, impuesto_id, isc_id, precio_incluye_impuesto, tipo, nombre_corto, marca,
                                  permite_sin_existencia, usa_series, garantia_meses)
           SELECT $1, empresa_id, categoria_id, $2, $3, unidad_base, false, true, impuesto_id, isc_id, precio_incluye_impuesto, 'INVENTARIABLE', LEFT($3, 32), marca, false, (SELECT $6::text IS NOT NULL), $5
             FROM productos WHERE id = $4 AND empresa_id = $7`,
          [productoUsadoId, sku, nombre, it.producto_id, garantia, it.serie, empresaId]);
        if (!ins.rowCount) throw new ErrorNegocio("El producto original ya no existe", 404);
        const presId = uuidv7();
        await c.query("INSERT INTO presentaciones (id, producto_id, nombre, factor, es_principal) VALUES ($1,$2,'Unidad',1,true)", [presId, productoUsadoId]);
        await c.query(
          "INSERT INTO precios (id, lista_precio_id, presentacion_id, sucursal_id, precio) SELECT gen_random_uuid(), l.id, $1, NULL, $2 FROM listas_precio l WHERE l.empresa_id = $3",
          [presId, precio, empresaId]);
        // La mercancía sale de «Recuperada» y entra al piso de venta con su costo (lo reconocido al cliente más la reparación)
        const costo = new Decimal(it.valoracion).plus(repar).div(it.cantidad).toDecimalPlaces(4);
        const rec = await almacenRecuperada(c, it.sucursal_id);
        const piso = (await c.query<{ id: string }>("SELECT id FROM almacenes WHERE sucursal_id = $1 AND es_principal ORDER BY nombre LIMIT 1", [it.sucursal_id])).rows[0]?.id;
        if (!piso) throw new ErrorNegocio("La sucursal no tiene almacén principal");
        const doc = `Reventa como USADO · acta RM-${it.numero.padStart(6, "0")}`;
        await c.query(
          `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, documento_tipo, documento_id, motivo, usuario_id)
           VALUES ($1,$2,$3,$4,'AJUSTE_SALIDA',$5,0,'recuperacion',$6,$7,$8)`,
          [uuidv7(), it.sucursal_id, rec, it.producto_id, new Decimal(it.cantidad).neg().toFixed(3), it.recuperacion_id, doc, usuarioId]);
        await c.query(
          `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, documento_tipo, documento_id, motivo, usuario_id)
           VALUES ($1,$2,$3,$4,'AJUSTE_ENTRADA',$5,$6,'recuperacion',$7,$8,$9)`,
          [uuidv7(), it.sucursal_id, piso, productoUsadoId, it.cantidad, costo.toFixed(4), it.recuperacion_id, doc, usuarioId]);
      } else if (productoUsadoId && b.precioUsado && Number(b.precioUsado) > 0) {
        // Ya publicado: cambiar el precio de usado actualiza el precio de venta
        await c.query("UPDATE precios SET precio = $2 WHERE presentacion_id IN (SELECT id FROM presentaciones WHERE producto_id = $1)", [productoUsadoId, b.precioUsado]);
      }
      await c.query(
        `UPDATE recuperacion_items SET proceso = $2, estado_fisico = COALESCE($3, estado_fisico), costo_reparacion = $4, precio_usado = $5, garantia_meses = $6, nota = COALESCE($7, nota), producto_usado_id = $8 WHERE id = $1`,
        [id, proceso, b.estadoFisico ?? null, repar, precio ?? null, garantia, b.nota ?? null, productoUsadoId]);
      return { ok: true, publicado: !!productoUsadoId && !it.producto_usado_id };
    });
  });
}
