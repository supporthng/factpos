import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { syncActiva } from "../sync/sucursal.js";
import { config } from "../config.js";

const cantidad = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida");

/**
 * Traspasos entre almacenes o sucursales, SIEMPRE al costo:
 *  - Al enviar, la mercancía sale del origen a su costo promedio vigente,
 *    y ese costo queda congelado en el traspaso.
 *  - Al recibir, entra al destino con ese mismo costo y se recalcula el
 *    costo promedio del destino. No se genera utilidad entre sucursales.
 *
 * Todas las sucursales están bajo el mismo RNC: un traspaso no es una venta
 * ni lleva comprobante fiscal; se acompaña con un conduce (documento interno).
 *
 * Con un servidor por sucursal, el traspaso se registra en la central y la
 * sincronización baja los movimientos de inventario a los dos servidores:
 * la salida al de origen y, al recibir, la entrada al de destino.
 */
export const esquemaTraspaso = z
  .object({
    origenAlmacenId: z.string().uuid(),
    destinoAlmacenId: z.string().uuid(),
    usuarioId: z.string().uuid(),
    notas: z.string().max(300).optional(),
    chofer: z.string().trim().max(80).optional(),
    vehiculo: z.string().trim().max(40).optional(),
    pedidoId: z.string().uuid().optional(),
    items: z.array(z.object({ productoId: z.string().uuid(), cantidad, cantidadPedida: cantidad.optional() })).min(1).max(1000),
  })
  .refine((b) => b.origenAlmacenId !== b.destinoAlmacenId, "El origen y el destino deben ser distintos");
export type DatosTraspaso = z.infer<typeof esquemaTraspaso>;

export const esquemaRecepcion = z.object({
  usuarioId: z.string().uuid(),
  notas: z.string().max(300).optional(),
  items: z.array(z.object({ productoId: z.string().uuid(), cantidadRecibida: cantidad })).optional(), // omitido = llegó todo
});
export type DatosRecepcion = z.infer<typeof esquemaRecepcion>;

export async function crearTraspaso(c: PoolClient, body: DatosTraspaso) {
  const alm = await c.query<{ id: string; sucursal_id: string }>(
    "SELECT id, sucursal_id FROM almacenes WHERE id = ANY($1::uuid[])",
    [[body.origenAlmacenId, body.destinoAlmacenId]],
  );
  const origen = alm.rows.find((a) => a.id === body.origenAlmacenId);
  const destino = alm.rows.find((a) => a.id === body.destinoAlmacenId);
  if (!origen || !destino) throw new ErrorNegocio("Almacén de origen o destino no existe");

  // Un producto una sola vez por traspaso
  const vistos = new Set<string>();
  for (const it of body.items) {
    if (vistos.has(it.productoId)) throw new ErrorNegocio("Hay un producto repetido en el traspaso: sume las cantidades en una sola línea");
    vistos.add(it.productoId);
    if (new Decimal(it.cantidad).lte(0)) throw new ErrorNegocio("Las cantidades deben ser mayores que cero");
  }

  // Numeración por sucursal de origen (bloqueo para que no se repita)
  await c.query("SELECT 1 FROM sucursales WHERE id = $1 FOR UPDATE", [origen.sucursal_id]);
  const n = await c.query<{ n: string }>(
    "SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM transferencias WHERE origen_sucursal_id = $1",
    [origen.sucursal_id],
  );
  const id = uuidv7();
  await c.query(
    `INSERT INTO transferencias (id, numero, origen_almacen_id, destino_almacen_id, origen_sucursal_id,
                                 destino_sucursal_id, enviado_por, notas, chofer, vehiculo, pedido_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, n.rows[0].n, origen.id, destino.id, origen.sucursal_id, destino.sucursal_id, body.usuarioId,
     body.notas ?? null, body.chofer || null, body.vehiculo || null, body.pedidoId ?? null],
  );

  let valor = new Decimal(0);
  for (const it of body.items) {
    const ex = await c.query<{ cantidad: string; nombre: string; tipo: string }>(
      `SELECT COALESCE(e.cantidad, 0) AS cantidad, p.nombre, p.tipo
         FROM productos p LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = $2
        WHERE p.id = $1`,
      [it.productoId, origen.id],
    );
    if (!ex.rowCount) throw new ErrorNegocio("Producto no existe");
    if (ex.rows[0].tipo !== "INVENTARIABLE") throw new ErrorNegocio(`${ex.rows[0].nombre} no lleva inventario: no se traspasa`);
    if (new Decimal(ex.rows[0].cantidad).lt(it.cantidad)) {
      throw new ErrorNegocio(`Existencia insuficiente de ${ex.rows[0].nombre}: hay ${Number(ex.rows[0].cantidad)}`);
    }
    // El trigger del kardex fija el costo de salida al promedio vigente del origen
    const k = await c.query<{ costo_unitario: string }>(
      `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario,
                                       documento_tipo, documento_id, usuario_id)
       VALUES ($1,$2,$3,$4,'TRANSFERENCIA_SALIDA',$5,0,'transferencia',$6,$7)
       RETURNING costo_unitario`,
      [uuidv7(), origen.sucursal_id, origen.id, it.productoId, new Decimal(it.cantidad).neg().toFixed(3), id, body.usuarioId],
    );
    const costo = k.rows[0].costo_unitario;
    await c.query(
      `INSERT INTO transferencia_items (id, transferencia_id, producto_id, cantidad_enviada, costo_unitario, cantidad_pedida)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [uuidv7(), id, it.productoId, it.cantidad, costo, it.cantidadPedida ?? null],
    );
    valor = valor.plus(new Decimal(costo).mul(it.cantidad));
  }

  await registrarSync(c, id);
  return { id, numero: n.rows[0].n, estado: "EN_TRANSITO", valorAlCosto: valor.toFixed(2) };
}

/** Recepción: se cuenta lo que llegó; si falta algo queda marcado CON_DIFERENCIA. */
export async function recibirTraspaso(c: PoolClient, id: string, body: DatosRecepcion) {
  const t = await c.query("SELECT * FROM transferencias WHERE id = $1 FOR UPDATE", [id]);
  if (!t.rowCount) throw new ErrorNegocio("Traspaso no encontrado", 404);
  if (t.rows[0].estado !== "EN_TRANSITO") throw new ErrorNegocio("Este traspaso ya fue recibido", 409);
  const tr = t.rows[0];

  const items = await c.query("SELECT * FROM transferencia_items WHERE transferencia_id = $1", [id]);
  const recibido = new Map(body.items?.map((i) => [i.productoId, i.cantidadRecibida]));
  for (const pid of recibido.keys()) {
    if (!items.rows.some((i) => i.producto_id === pid)) throw new ErrorNegocio("Se contó un producto que no viene en este traspaso");
  }
  let conDiferencia = false;

  for (const it of items.rows) {
    const cant = new Decimal(recibido.get(it.producto_id) ?? it.cantidad_enviada);
    if (cant.gt(it.cantidad_enviada)) throw new ErrorNegocio("No se puede recibir más de lo enviado: si llegó de más, avise al almacén");
    if (!cant.eq(it.cantidad_enviada)) conDiferencia = true;
    await c.query("UPDATE transferencia_items SET cantidad_recibida = $1 WHERE id = $2", [cant.toFixed(3), it.id]);
    if (cant.gt(0)) {
      // Entra al costo de origen; el trigger recalcula el promedio del destino
      await c.query(
        `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario,
                                         documento_tipo, documento_id, usuario_id)
         VALUES ($1,$2,$3,$4,'TRANSFERENCIA_ENTRADA',$5,$6,'transferencia',$7,$8)`,
        [uuidv7(), tr.destino_sucursal_id, tr.destino_almacen_id, it.producto_id, cant.toFixed(3), it.costo_unitario, id, body.usuarioId],
      );
    }
  }

  const estado = conDiferencia ? "CON_DIFERENCIA" : "RECIBIDA";
  await c.query(
    `UPDATE transferencias SET estado = $2, recibido_por = $3, recibido_en = now(), notas_recepcion = $4 WHERE id = $1`,
    [id, estado, body.usuarioId, body.notas ?? null],
  );
  await registrarSync(c, id);
  const r = await c.query("SELECT * FROM rpt_traspasos WHERE id = $1", [id]);
  return r.rows[0];
}

export async function rutasTraspasos(app: FastifyInstance) {
  // Con un servidor por sucursal conectado a la nube, los traspasos se registran
  // en la central (así los dos lados reciben los mismos movimientos).
  const soloCentral = () => {
    if (config.modo === "sucursal" && syncActiva()) {
      throw new ErrorNegocio("Los traspasos se registran en la administración central: allí se despachan y se reciben", 409);
    }
  };

  app.post("/traspasos", async (req, rep) => {
    soloCentral();
    const body = esquemaTraspaso.parse(req.body);
    const res = await enTransaccion((c) => crearTraspaso(c, body));
    rep.code(201);
    return res;
  });

  app.post("/traspasos/:id/recibir", async (req) => {
    soloCentral();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = esquemaRecepcion.parse(req.body);
    return enTransaccion((c) => recibirTraspaso(c, id, body));
  });

  app.get("/traspasos", async (req) => {
    const f = z
      .object({ estado: z.enum(["EN_TRANSITO", "RECIBIDA", "CON_DIFERENCIA"]).optional(), sucursalId: z.string().uuid().optional() })
      .parse(req.query);
    const r = await pool.query(
      `SELECT r.* FROM rpt_traspasos r JOIN transferencias t ON t.id = r.id
        WHERE ($1::text IS NULL OR r.estado = $1)
          AND ($2::uuid IS NULL OR t.origen_sucursal_id = $2 OR t.destino_sucursal_id = $2)
        ORDER BY r.enviado_en DESC LIMIT 200`,
      [f.estado ?? null, f.sucursalId ?? null],
    );
    return r.rows;
  });
}

/**
 * En un servidor de sucursal sin nube (tienda única o pruebas) el traspaso
 * queda en la cola de subida. En la central no hace falta: los movimientos
 * bajan a cada sucursal por la sincronización.
 */
async function registrarSync(c: PoolClient, id: string) {
  if (config.modo === "central") return;
  await c.query(
    `INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
     SELECT 'transferencias', t.id, 'UPSERT', jsonb_build_object(
              'transferencia', to_jsonb(t),
              'items', (SELECT jsonb_agg(to_jsonb(i)) FROM transferencia_items i WHERE i.transferencia_id = t.id),
              'kardex', (SELECT jsonb_agg(to_jsonb(k)) FROM kardex_movimientos k
                          WHERE k.documento_tipo = 'transferencia' AND k.documento_id = t.id))
       FROM transferencias t WHERE t.id = $1`,
    [id],
  );
}
