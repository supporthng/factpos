import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";

/**
 * Compras (entrada de mercancía con la factura del proveedor).
 *
 * Cada línea puede marcarse "comprada en oferta del proveedor" con su costo
 * normal. Así el sistema sabe a cuánto se compró en oferta y lo muestra al
 * comprar de nuevo y al crear ofertas de venta ("¿hasta dónde puedo bajar?").
 *
 * Al registrar: entra al inventario de la sucursal por el kardex (el trigger
 * recalcula el costo promedio) y se actualiza el último costo del proveedor.
 * Las compras no se editan; se corrigen con un ajuste.
 */
const uuid = z.string().uuid();
const cant = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida").refine((v) => Number(v) > 0, "La cantidad debe ser mayor que cero");
const costo = z.string().regex(/^\d+(\.\d{1,4})?$/, "Costo inválido");

const CompraSchema = z.object({
  sucursalId: uuid,
  proveedorId: uuid,
  numeroFactura: z.string().trim().max(30).nullable().default(null),
  ncfProveedor: z.string().trim().regex(/^[BE]\d{10,12}$/, "NCF inválido (ej. B0100000001 o E310000000001)").nullable().default(null),
  fechaFactura: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  condicion: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
  venceEn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  notas: z.string().trim().max(300).nullable().default(null),
  items: z.array(z.object({
    presentacionId: uuid,
    cantidad: cant,
    /** Costo por presentación, SIN ITBIS, tal como vino en la factura */
    costoUnitario: costo.refine((v) => Number(v) > 0, "El costo debe ser mayor que cero"),
    enOferta: z.boolean().default(false),
    /** Costo normal cuando vino en oferta (para saber cuánto se ahorró) */
    costoRegular: costo.nullable().default(null),
  })).min(1, "Agregue al menos un producto").max(500),
}).refine((c) => c.condicion === "CONTADO" || !!c.venceEn, "Indique el vencimiento de la factura a crédito")
  .refine((c) => c.items.every((i) => !i.enOferta || !i.costoRegular || Number(i.costoRegular) >= Number(i.costoUnitario)),
    "El costo normal no puede ser menor que el costo en oferta");

export async function rutasCentralCompras(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => {
    const u = uuid.safeParse(req.headers["x-usuario-id"]);
    if (!u.success) throw new ErrorNegocio("Falta el usuario que registra la compra");
    return u.data;
  };

  app.get("/central/compras", async (req) => {
    const f = z.object({ sucursalId: uuid.optional(), desde: z.string().optional(), hasta: z.string().optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT c.id, c.fecha_factura AS fecha, c.numero_factura AS "numeroFactura", c.ncf_proveedor AS ncf, c.condicion,
              c.subtotal, c.itbis, c.total, s.nombre AS sucursal, pv.nombre AS proveedor, u.nombre AS usuario, c.creado_en AS "creadoEn",
              (SELECT COUNT(*) FROM compra_items ci WHERE ci.compra_id = c.id) AS lineas,
              (SELECT COUNT(*) FROM compra_items ci WHERE ci.compra_id = c.id AND ci.en_oferta) AS "lineasEnOferta",
              (SELECT COALESCE(SUM((ci.costo_regular - ci.costo_unitario) * ci.cantidad), 0)::numeric(14,2)
                 FROM compra_items ci WHERE ci.compra_id = c.id AND ci.en_oferta AND ci.costo_regular IS NOT NULL) AS ahorro
         FROM compras c JOIN sucursales s ON s.id = c.sucursal_id JOIN proveedores pv ON pv.id = c.proveedor_id
         JOIN usuarios u ON u.id = c.usuario_id
        WHERE s.empresa_id = $1 AND ($2::uuid IS NULL OR c.sucursal_id = $2)
          AND ($3::date IS NULL OR c.fecha_factura >= $3) AND ($4::date IS NULL OR c.fecha_factura <= $4)
        ORDER BY c.fecha_factura DESC, c.creado_en DESC LIMIT 300`,
      [empresaDe(req), f.sucursalId ?? null, f.desde || null, f.hasta || null],
    );
    return r.rows;
  });

  app.get("/central/compras/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = (await pool.query(
      `SELECT c.*, s.nombre AS sucursal, pv.nombre AS proveedor, pv.rnc
         FROM compras c JOIN sucursales s ON s.id = c.sucursal_id JOIN proveedores pv ON pv.id = c.proveedor_id
        WHERE c.id = $1 AND s.empresa_id = $2`, [id, empresaDe(req)],
    )).rows[0];
    if (!c) throw new ErrorNegocio("Compra no encontrada", 404);
    const items = await pool.query(
      `SELECT ci.linea, p.nombre, pr.nombre AS presentacion, ci.cantidad, ci.factor, ci.costo_unitario AS "costoUnitario",
              ci.itbis, ci.total, ci.en_oferta AS "enOferta", ci.costo_regular AS "costoRegular"
         FROM compra_items ci JOIN presentaciones pr ON pr.id = ci.presentacion_id JOIN productos p ON p.id = pr.producto_id
        WHERE ci.compra_id = $1 ORDER BY ci.linea`, [id],
    );
    return { ...c, items: items.rows };
  });

  app.post("/central/compras", async (req, rep) => {
    const b = CompraSchema.parse(req.body);
    const empresaId = empresaDe(req);
    const usuarioId = usuarioDe(req);
    const id = uuidv7();

    const r = await enTransaccion(async (c) => {
      const suc = (await c.query(
        `SELECT s.id, (SELECT a.id FROM almacenes a WHERE a.sucursal_id = s.id AND a.es_principal) AS almacen
           FROM sucursales s WHERE s.id = $1 AND s.empresa_id = $2`, [b.sucursalId, empresaId],
      )).rows[0];
      if (!suc?.almacen) throw new ErrorNegocio("Sucursal no encontrada o sin almacén principal");
      const prov = await c.query("SELECT 1 FROM proveedores WHERE id = $1 AND empresa_id = $2", [b.proveedorId, empresaId]);
      if (!prov.rowCount) throw new ErrorNegocio("Proveedor no encontrado");
      if (b.ncfProveedor) {
        const dup = await c.query("SELECT 1 FROM compras WHERE proveedor_id = $1 AND ncf_proveedor = $2", [b.proveedorId, b.ncfProveedor]);
        if (dup.rowCount) throw new ErrorNegocio(`Ya se registró una compra con el NCF ${b.ncfProveedor} de este proveedor`, 409);
      }

      const pres = new Map((await c.query<{ id: string; productoId: string; nombre: string; tipo: string; factor: string; tasa: string }>(
        `SELECT pr.id, p.id AS "productoId", p.nombre || ' ' || pr.nombre AS nombre, p.tipo, pr.factor::text AS factor, i.tasa::text AS tasa
           FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id JOIN impuestos i ON i.id = p.impuesto_id
          WHERE pr.id = ANY($1::uuid[]) AND p.empresa_id = $2`,
        [b.items.map((i) => i.presentacionId), empresaId],
      )).rows.map((x) => [x.id, x]));

      let subtotal = new Decimal(0), itbis = new Decimal(0);
      const lineas = b.items.map((it, n) => {
        const p = pres.get(it.presentacionId);
        if (!p) throw new ErrorNegocio(`Producto de la línea ${n + 1} no encontrado`);
        if (p.tipo !== "INVENTARIABLE") throw new ErrorNegocio(`${p.nombre} no lleva inventario (${p.tipo.toLowerCase()}); no se compra`);
        const base = new Decimal(it.cantidad).mul(it.costoUnitario).toDecimalPlaces(2);
        const imp = base.mul(p.tasa).toDecimalPlaces(2);
        subtotal = subtotal.plus(base);
        itbis = itbis.plus(imp);
        return { it, p, base, imp, linea: n + 1 };
      });
      const total = subtotal.plus(itbis);

      await c.query(
        `INSERT INTO compras (id, sucursal_id, almacen_id, proveedor_id, ncf_proveedor, numero_factura, fecha_factura, condicion,
                              vence_en, subtotal, itbis, total, usuario_id, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, b.sucursalId, suc.almacen, b.proveedorId, b.ncfProveedor, b.numeroFactura, b.fechaFactura, b.condicion,
         b.venceEn, subtotal.toFixed(2), itbis.toFixed(2), total.toFixed(2), usuarioId, b.notas],
      );
      await c.query(
        `INSERT INTO compra_items (id, compra_id, linea, presentacion_id, cantidad, factor, costo_unitario, itbis, total, en_oferta, costo_regular)
         SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::smallint[], $4::uuid[], $5::numeric[], $6::numeric[], $7::numeric[],
                              $8::numeric[], $9::numeric[], $10::boolean[], $11::numeric[])`,
        [lineas.map(() => uuidv7()), lineas.map(() => id), lineas.map((l) => l.linea), lineas.map((l) => l.it.presentacionId),
         lineas.map((l) => l.it.cantidad), lineas.map((l) => l.p.factor), lineas.map((l) => l.it.costoUnitario),
         lineas.map((l) => l.imp.toFixed(2)), lineas.map((l) => l.base.plus(l.imp).toFixed(2)),
         lineas.map((l) => l.it.enOferta), lineas.map((l) => (l.it.enOferta ? l.it.costoRegular : null))],
      );
      // Entrada al inventario: unidades base y costo por unidad base (el trigger recalcula el promedio)
      await c.query(
        `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario,
                                         documento_tipo, documento_id, motivo, usuario_id)
         SELECT x.id, $2, $3, x.producto, 'COMPRA', x.cantidad, x.costo, 'compra', $4, $5, $6
           FROM unnest($1::uuid[], $7::uuid[], $8::numeric[], $9::numeric[]) AS x(id, producto, cantidad, costo)`,
        [lineas.map(() => uuidv7()), b.sucursalId, suc.almacen, id,
         `Compra${b.numeroFactura ? ` factura ${b.numeroFactura}` : ""}${b.ncfProveedor ? ` NCF ${b.ncfProveedor}` : ""}`, usuarioId,
         lineas.map((l) => l.p.productoId), lineas.map((l) => new Decimal(l.it.cantidad).mul(l.p.factor).toString()),
         lineas.map((l) => new Decimal(l.it.costoUnitario).div(l.p.factor).toDecimalPlaces(4).toString())],
      );
      // Último costo NORMAL del proveedor (la oferta no cambia su precio de lista)
      for (const l of lineas) {
        const normal = new Decimal(l.it.enOferta && l.it.costoRegular ? l.it.costoRegular : l.it.costoUnitario).div(l.p.factor).toDecimalPlaces(4);
        if (l.it.enOferta && !l.it.costoRegular) continue;
        await c.query(
          `INSERT INTO producto_proveedores (producto_id, proveedor_id, ultimo_costo, principal)
           VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM producto_proveedores WHERE producto_id = $1 AND principal AND activo))
           ON CONFLICT (producto_id, proveedor_id) DO UPDATE SET ultimo_costo = EXCLUDED.ultimo_costo, activo = true`,
          [l.p.productoId, b.proveedorId, normal.toString()],
        );
      }
      return { id, subtotal: subtotal.toFixed(2), itbis: itbis.toFixed(2), total: total.toFixed(2), lineas: lineas.length };
    });
    rep.code(201);
    return r;
  });
}
