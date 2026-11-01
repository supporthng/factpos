import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7, calcularLinea } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { enviarCorreo, correoListo } from "../correo/transporte.js";
import { marcaDe } from "../correo/envios.js";
import { correoCotizacion } from "../correo/plantillas.js";

/**
 * Cotizaciones (administración). Los precios salen del nivel de precio del cliente; los totales los
 * calcula siempre el servidor con la misma función que la caja. Se envían por correo con la conexión
 * de «Correo y envíos» y pasan a ENVIADA; luego se marcan ACEPTADA o RECHAZADA.
 */
const uuid = z.string().uuid();
const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const correo = z.string().trim().toLowerCase().email("Correo inválido").max(120);

const Cotizacion = z.object({
  clienteId: uuid.nullable().default(null),
  clienteNombre: z.string().trim().min(2, "Escriba el nombre del cliente").max(150),
  clienteDocumento: z.string().trim().max(20).nullable().default(null),
  clienteCorreo: correo.nullable().or(z.literal("").transform(() => null)).default(null),
  clienteTelefono: z.string().trim().max(30).nullable().default(null),
  fecha: fechaIso,
  vence: fechaIso,
  notas: z.string().trim().max(500).nullable().default(null),
  condiciones: z.string().trim().max(1000).nullable().default(null),
  lineas: z.array(z.object({
    presentacionId: uuid.nullable().default(null),
    descripcion: z.string().trim().min(1).max(200),
    cantidad: z.number().positive().max(1_000_000),
    precio: z.number().min(0).max(100_000_000),
    incluyeItbis: z.boolean().default(true),
    tasaItbis: z.number().min(0).max(0.99).default(0.18),
    descuento: z.number().min(0).default(0),
  })).min(1, "Agregue al menos un producto").max(300),
}).refine((c) => c.vence >= c.fecha, { message: "La validez no puede ser anterior a la fecha", path: ["vence"] });

export async function rutasCentralCotizaciones(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.safeParse(req.headers["x-usuario-id"]).data ?? null;

  const calcular = (lineas: z.infer<typeof Cotizacion>["lineas"]) => {
    const calc = lineas.map((l) => {
      try {
        return calcularLinea({ cantidad: l.cantidad, precioUnitario: l.precio, tasaItbis: l.tasaItbis, precioIncluyeItbis: l.incluyeItbis, descuento: l.descuento });
      } catch (e) { throw new ErrorNegocio(`${l.descripcion}: ${(e as Error).message}`); }
    });
    const suma = (k: "base" | "itbis" | "total" | "descuento") => calc.reduce((s, c) => s + Number(c[k]), 0);
    const descuento = suma("descuento");
    return { calc, descuento: Math.round(descuento * 100) / 100, subtotal: Math.round(suma("base") * 100) / 100, itbis: Math.round(suma("itbis") * 100) / 100, total: Math.round(suma("total") * 100) / 100 };
  };

  const cargar = async (empresaId: string, id: string) => {
    const c = (await pool.query(
      `SELECT c.id, c.numero, c.cliente_id AS "clienteId", c.cliente_nombre AS "clienteNombre", c.cliente_documento AS "clienteDocumento",
              c.cliente_correo AS "clienteCorreo", c.cliente_telefono AS "clienteTelefono", to_char(c.fecha,'YYYY-MM-DD') AS fecha, to_char(c.vence,'YYYY-MM-DD') AS vence,
              c.estado, c.notas, c.condiciones, c.subtotal::float, c.descuento::float, c.itbis::float, c.total::float,
              c.creado_en AS "creadoEn", c.enviada_en AS "enviadaEn", c.enviada_a AS "enviadaA", u.nombre AS "creadoPor",
              c.pedido_id AS "pedidoId", 'PM-' || lpad(pc.numero::text, 5, '0') AS "pedidoNumero"
         FROM cotizaciones c LEFT JOIN usuarios u ON u.id = c.creado_por LEFT JOIN pedidos_clientes pc ON pc.id = c.pedido_id WHERE c.empresa_id = $1 AND c.id = $2`, [empresaId, id])).rows[0];
    if (!c) throw new ErrorNegocio("No existe esa cotización", 404);
    c.lineas = (await pool.query(
      `SELECT presentacion_id AS "presentacionId", descripcion, cantidad::float, precio::float, incluye_itbis AS "incluyeItbis", tasa_itbis::float AS "tasaItbis",
              descuento::float, base::float, itbis::float, total::float FROM cotizacion_lineas WHERE cotizacion_id = $1 ORDER BY orden`, [id])).rows;
    return c;
  };

  app.get("/central/cotizaciones", async (req) => {
    const q = z.object({ estado: z.enum(["BORRADOR", "ENVIADA", "ACEPTADA", "RECHAZADA"]).optional(), q: z.string().trim().max(60).optional() }).parse(req.query);
    return (await pool.query(
      `SELECT c.id, c.numero, c.cliente_nombre AS "clienteNombre", c.cliente_correo AS "clienteCorreo", to_char(c.fecha,'YYYY-MM-DD') AS fecha,
              to_char(c.vence,'YYYY-MM-DD') AS vence, c.estado, c.total::float, c.enviada_en AS "enviadaEn",
              (c.estado IN ('BORRADOR','ENVIADA') AND c.vence < CURRENT_DATE) AS vencida
         FROM cotizaciones c
        WHERE c.empresa_id = $1 AND ($2::text IS NULL OR c.estado = $2)
          AND ($3::text IS NULL OR c.cliente_nombre ILIKE '%' || $3 || '%' OR c.numero::text = $3)
        ORDER BY c.numero DESC LIMIT 300`, [empresaDe(req), q.estado ?? null, q.q || null])).rows;
  });

  /** Precio de una presentación para un cliente (según su nivel), con la tasa de ITBIS del producto */
  app.get("/central/cotizaciones/precio", async (req) => {
    const q = z.object({ presentacionId: uuid, clienteId: uuid.optional() }).parse(req.query);
    const e = empresaDe(req);
    const r = (await pool.query(
      `SELECT pr.nombre AS presentacion, p.nombre, p.precio_incluye_impuesto AS "incluyeItbis", i.tasa::float AS "tasaItbis",
              (SELECT x.precio::float FROM precios x
                WHERE x.presentacion_id = pr.id AND x.activo AND x.sucursal_id IS NULL
                  AND x.lista_precio_id = COALESCE((SELECT lista_precio_id FROM clientes WHERE id = $3 AND empresa_id = $1),
                                                   (SELECT id FROM listas_precio WHERE empresa_id = $1 AND es_predeterminada LIMIT 1))
                LIMIT 1) AS precio
         FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id JOIN impuestos i ON i.id = p.impuesto_id
        WHERE pr.id = $2 AND p.empresa_id = $1`, [e, q.presentacionId, q.clienteId ?? null])).rows[0];
    if (!r) throw new ErrorNegocio("No existe esa presentación", 404);
    return { ...r, precio: r.precio ?? 0 };
  });

  app.get("/central/cotizaciones/:id", async (req) => cargar(empresaDe(req), uuid.parse((req.params as { id: string }).id)));

  const guardarLineas = async (c: { query: typeof pool.query }, id: string, b: z.infer<typeof Cotizacion>, calc: ReturnType<typeof calcular>) => {
    await c.query("DELETE FROM cotizacion_lineas WHERE cotizacion_id = $1", [id]);
    for (let i = 0; i < b.lineas.length; i++) {
      const l = b.lineas[i]!, k = calc.calc[i]!;
      await c.query(
        `INSERT INTO cotizacion_lineas (id, cotizacion_id, orden, presentacion_id, descripcion, cantidad, precio, incluye_itbis, tasa_itbis, descuento, base, itbis, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [uuidv7(), id, i + 1, l.presentacionId, l.descripcion, l.cantidad, l.precio, l.incluyeItbis, l.tasaItbis, l.descuento, k.base, k.itbis, k.total]);
    }
  };

  app.post("/central/cotizaciones", async (req) => {
    const b = Cotizacion.parse(req.body);
    const empresaId = empresaDe(req);
    const calc = calcular(b.lineas);
    const id = uuidv7();
    await enTransaccion(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cotizaciones:${empresaId}`]);
      const numero = (await c.query<{ n: number }>("SELECT COALESCE(MAX(numero),0)+1 AS n FROM cotizaciones WHERE empresa_id = $1", [empresaId])).rows[0]!.n;
      await c.query(
        `INSERT INTO cotizaciones (id, empresa_id, numero, cliente_id, cliente_nombre, cliente_documento, cliente_correo, cliente_telefono, fecha, vence, notas, condiciones,
                                   subtotal, descuento, itbis, total, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [id, empresaId, numero, b.clienteId, b.clienteNombre, b.clienteDocumento, b.clienteCorreo, b.clienteTelefono, b.fecha, b.vence, b.notas, b.condiciones,
          calc.subtotal, calc.descuento, calc.itbis, calc.total, usuarioDe(req)]);
      await guardarLineas(c, id, b, calc);
    });
    return cargar(empresaId, id);
  });

  app.put("/central/cotizaciones/:id", async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const empresaId = empresaDe(req);
    const b = Cotizacion.parse(req.body);
    const calc = calcular(b.lineas);
    await enTransaccion(async (c) => {
      const act = (await c.query<{ estado: string }>("SELECT estado FROM cotizaciones WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [id, empresaId])).rows[0];
      if (!act) throw new ErrorNegocio("No existe esa cotización", 404);
      if (act.estado === "ACEPTADA") throw new ErrorNegocio("Una cotización aceptada ya no se modifica. Haga una nueva a partir de ella.");
      await c.query(
        `UPDATE cotizaciones SET cliente_id=$3, cliente_nombre=$4, cliente_documento=$5, cliente_correo=$6, cliente_telefono=$7, fecha=$8, vence=$9, notas=$10, condiciones=$11,
                subtotal=$12, descuento=$13, itbis=$14, total=$15, actualizado_en=now() WHERE id = $1 AND empresa_id = $2`,
        [id, empresaId, b.clienteId, b.clienteNombre, b.clienteDocumento, b.clienteCorreo, b.clienteTelefono, b.fecha, b.vence, b.notas, b.condiciones,
          calc.subtotal, calc.descuento, calc.itbis, calc.total]);
      await guardarLineas(c, id, b, calc);
    });
    return cargar(empresaId, id);
  });

  app.put("/central/cotizaciones/:id/estado", async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z.object({ estado: z.enum(["BORRADOR", "ACEPTADA", "RECHAZADA"]) }).parse(req.body);
    const r = await pool.query("UPDATE cotizaciones SET estado = $3, actualizado_en = now() WHERE id = $1 AND empresa_id = $2", [id, empresaDe(req), b.estado]);
    if (!r.rowCount) throw new ErrorNegocio("No existe esa cotización", 404);
    return { ok: true };
  });

  app.delete("/central/cotizaciones/:id", async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const r = await pool.query("DELETE FROM cotizaciones WHERE id = $1 AND empresa_id = $2 AND estado = 'BORRADOR'", [id, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Solo se borran los borradores. Márquela como rechazada si ya no sirve.");
    return { ok: true };
  });

  /** Envía la cotización por correo al cliente (y, si se quiere, copia a otras direcciones) */
  app.post("/central/cotizaciones/:id/enviar", async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const empresaId = empresaDe(req);
    const b = z.object({ para: z.array(correo).min(1, "Escriba el correo del cliente").max(5), mensaje: z.string().trim().max(1000).optional() }).parse(req.body);
    if (!(await correoListo(empresaId))) throw new ErrorNegocio("Falta configurar el correo: Configuración › Correo y envíos.");
    const cot = await cargar(empresaId, id);
    const marca = await marcaDe(empresaId);
    const mail = correoCotizacion(marca, cot, b.mensaje);
    try {
      await enviarCorreo(empresaId, { para: b.para, asunto: mail.asunto, html: mail.html, texto: mail.texto });
    } catch (e) { throw new ErrorNegocio(`No se pudo enviar: ${(e as Error).message}`, 502); }
    await pool.query(
      `UPDATE cotizaciones SET estado = CASE WHEN estado = 'BORRADOR' THEN 'ENVIADA' ELSE estado END, enviada_en = now(), enviada_a = $3,
              cliente_correo = COALESCE(cliente_correo, $4), actualizado_en = now() WHERE id = $1 AND empresa_id = $2`,
      [id, empresaId, b.para, b.para[0]]);
    return { ok: true };
  });

  /** Convierte la cotización en un pedido de cliente (se alista y se factura desde la caja con los precios de ese momento) */
  app.post("/central/cotizaciones/:id/pedido", async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const empresaId = empresaDe(req);
    const b = z.object({ sucursalId: uuid, cajaId: uuid.nullable().optional() }).parse(req.body);
    const usuario = usuarioDe(req);
    if (!usuario) throw new ErrorNegocio("Falta el usuario");
    const cot = await cargar(empresaId, id);
    if (cot.pedidoId) throw new ErrorNegocio(`Esta cotización ya se convirtió en el pedido ${cot.pedidoNumero}`, 409);
    if (cot.estado === "RECHAZADA") throw new ErrorNegocio("Una cotización rechazada no se convierte en pedido. Reábrala primero.");
    const juntas = new Map<string, number>();
    let sinProducto = 0;
    for (const l of cot.lineas as { presentacionId: string | null; cantidad: number }[]) {
      if (!l.presentacionId) { sinProducto++; continue; }
      juntas.set(l.presentacionId, (juntas.get(l.presentacionId) ?? 0) + l.cantidad);
    }
    if (!juntas.size) throw new ErrorNegocio("La cotización no tiene productos del inventario para convertir");
    const s = await pool.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2 AND activo", [b.sucursalId, empresaId]);
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    if (b.cajaId) {
      const c = await pool.query("SELECT 1 FROM cajas WHERE id = $1 AND sucursal_id = $2 AND activo", [b.cajaId, b.sucursalId]);
      if (!c.rowCount) throw new ErrorNegocio("Esa caja no es de la sucursal elegida");
    }
    const pedidoId = uuidv7();
    const numero = await enTransaccion(async (c) => {
      await c.query(
        `INSERT INTO pedidos_clientes (id, empresa_id, sucursal_id, caja_id, cliente_id, cliente_nombre, telefono, nota, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [pedidoId, empresaId, b.sucursalId, b.cajaId ?? null, cot.clienteId, cot.clienteNombre, cot.clienteTelefono, `Cotización COT-${String(cot.numero).padStart(4, "0")}`, usuario]);
      let orden = 0;
      for (const [presentacionId, cantidad] of juntas) {
        await c.query("INSERT INTO pedidos_clientes_items (id, pedido_id, presentacion_id, cantidad, orden) VALUES ($1,$2,$3,$4,$5)", [uuidv7(), pedidoId, presentacionId, Math.round(cantidad * 1000) / 1000, orden++]);
      }
      await c.query("UPDATE cotizaciones SET pedido_id = $3, estado = 'ACEPTADA', actualizado_en = now() WHERE id = $1 AND empresa_id = $2", [id, empresaId, pedidoId]);
      return (await c.query<{ numero: string }>("SELECT 'PM-' || lpad(numero::text, 5, '0') AS numero FROM pedidos_clientes WHERE id = $1", [pedidoId])).rows[0]!.numero;
    });
    return { ok: true, pedidoId, numero, lineasSinProducto: sinProducto };
  });
}
