import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { config } from "../config.js";
import { sucursalesDe, tienePermiso, type SesionAdmin } from "../sesion.js";
import { anularVenta, devolverParcial, datosTicket } from "./facturas.js";
import { registrarVenta, cotizar, resumen, exigirSinComprobante, exigirSeriesPresentes } from "./ventas.js";
import { contextoCaja, sucursalPropia } from "../contexto.js";
import { exigirLicenciaParaVender } from "../licencia/cliente.js";
import { autorizacionDirecta } from "../autorizacion.js";
import { enviarCorreo, correoListo } from "../correo/transporte.js";
import { marcaDe } from "../correo/envios.js";
import { correoFactura } from "../correo/plantillas.js";

/**
 * Facturas (administración): buscar cualquier factura, reimprimirla, modificarla o anularla.
 *  - Ver / reimprimir / modificar: permiso «admin.facturas».
 *  - Anular: además el permiso de supervisor «venta.anular». Deja nota de crédito (e-CF) o anulación interna,
 *    regresa la mercancía al inventario y registra la devolución en un turno abierto de la sucursal.
 *  - Modificar: una factura con comprobante fiscal no se edita (la DGII ya la conoce): solo se le puede cambiar la nota.
 *    En una factura interna (sin comprobante) también se puede cambiar el cliente.
 */
const uuid = z.string().uuid();
const TIPOS_FACTURA = ["E31", "E32", "B01", "B02", "B14", "B15", "B16", "SIN"];

export async function rutasCentralFacturas(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);
  const permisos = (req: unknown) => ((req as { sesion?: SesionAdmin }).sesion?.p ?? []) as string[];

  /** La factura debe ser de esta empresa y de una sucursal a la que el usuario tiene acceso. */
  const cargar = async (req: { headers: Record<string, unknown> }, id: string) => {
    const r = await pool.query(
      `SELECT v.id, v.sucursal_id, v.caja_id, v.tipo_documento, v.cliente_id FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id
        WHERE v.id = $1 AND s.empresa_id = $2 AND v.tipo_documento = ANY($3::text[])`,
      [id, empresaDe(req), TIPOS_FACTURA],
    );
    if (!r.rowCount) throw new ErrorNegocio("Factura no encontrada", 404);
    const permitidas = sucursalesDe(req);
    if (permitidas && !permitidas.includes(r.rows[0].sucursal_id)) throw new ErrorNegocio("No tiene acceso a esa sucursal", 403);
    return r.rows[0] as { id: string; sucursal_id: string; caja_id: string; tipo_documento: string; cliente_id: string | null };
  };

  app.get("/central/facturas", async (req) => {
    const f = z.object({
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      sucursalId: uuid.optional(), familia: z.enum(["E", "B", "SIN"]).optional(), estado: z.enum(["EMITIDA", "ANULADA"]).optional(),
      q: z.string().trim().max(60).optional(),
    }).parse(req.query);
    const params: unknown[] = [empresaDe(req), TIPOS_FACTURA];
    const cond = ["s.empresa_id = $1", "v.tipo_documento = ANY($2::text[])"];
    const add = (sql: string, v: unknown) => { params.push(v); cond.push(sql.replace("?", `$${params.length}`)); };
    const permitidas = sucursalesDe(req);
    if (permitidas) add("v.sucursal_id = ANY(?::uuid[])", permitidas);
    if (f.sucursalId) add("v.sucursal_id = ?", f.sucursalId);
    if (f.desde) add("(v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date >= ?::date", f.desde);
    if (f.hasta) add("(v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date <= ?::date", f.hasta);
    if (f.familia === "E") cond.push("v.tipo_documento LIKE 'E%'");
    if (f.familia === "B") cond.push("v.tipo_documento LIKE 'B%'");
    if (f.familia === "SIN") cond.push("v.tipo_documento = 'SIN'");
    if (f.estado === "ANULADA") cond.push("EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = v.id AND NOT n.parcial AND n.tipo_documento IN ('E34','ANU'))");
    if (f.estado === "EMITIDA") cond.push("NOT EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = v.id AND NOT n.parcial AND n.tipo_documento IN ('E34','ANU'))");
    if (f.q) {
      params.push(`%${f.q}%`);
      const n = params.length;
      cond.push(`(v.numero_documento ILIKE $${n} OR d.encf ILIKE $${n} OR cl.nombre ILIKE $${n} OR cl.documento ILIKE $${n} OR v.numero_interno::text = trim(both '%' from $${n}))`);
    }
    const r = await pool.query(
      `SELECT v.id, v.numero_interno AS numero, v.tipo_documento AS tipo, COALESCE(d.encf, v.numero_documento) AS comprobante,
              v.total, v.creado_en AS fecha, s.nombre AS sucursal, c.nombre AS caja, u.nombre AS cajero, cl.nombre AS cliente,
              EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = v.id AND NOT n.parcial AND n.tipo_documento IN ('E34','ANU')) AS anulada
         FROM ventas v
         JOIN sucursales s ON s.id = v.sucursal_id
         LEFT JOIN cajas c ON c.id = v.caja_id
         LEFT JOIN usuarios u ON u.id = v.usuario_id
         LEFT JOIN ecf_documentos d ON d.venta_id = v.id
         LEFT JOIN clientes cl ON cl.id = v.cliente_id
        WHERE ${cond.join(" AND ")}
        ORDER BY v.creado_en DESC LIMIT 300`,
      params,
    );
    return r.rows;
  });

  app.get("/central/facturas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await cargar(req, id);
    const t = await datosTicket(pool, id);
    const x = await pool.query(
      `SELECT s.nombre AS sucursal, s.id AS "sucursalId", c.nombre AS caja, u.nombre AS cajero, cl.correo AS "clienteCorreo", cl.telefono AS "clienteTelefono",
              (SELECT jsonb_agg(jsonb_build_object('linea', i.linea, 'cantidad', i.cantidad, 'devuelta',
                  COALESCE((SELECT SUM(ni.cantidad) FROM venta_items ni JOIN ventas n ON n.id = ni.venta_id WHERE n.venta_origen_id = v.id AND n.parcial AND ni.linea = i.linea), 0)) ORDER BY i.linea)
                 FROM venta_items i WHERE i.venta_id = v.id) AS "lineasDevolucion",
              (SELECT COUNT(*)::int FROM ventas n WHERE n.venta_origen_id = v.id AND n.parcial) AS "devolucionesParciales",
              (SELECT jsonb_build_object('numero', n.numero_interno, 'fecha', n.creado_en, 'motivo', n.motivo, 'por', ua.nombre)
                 FROM ventas n LEFT JOIN usuarios ua ON ua.id = n.usuario_id
                WHERE n.venta_origen_id = v.id AND NOT n.parcial AND n.tipo_documento IN ('E34','ANU') LIMIT 1) AS anulacion
         FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id LEFT JOIN cajas c ON c.id = v.caja_id LEFT JOIN usuarios u ON u.id = v.usuario_id
         LEFT JOIN clientes cl ON cl.id = v.cliente_id
        WHERE v.id = $1`, [id]);
    return { ...t, ...x.rows[0], anulada: !!x.rows[0].anulacion };
  });

  /** Envía la factura al cliente por correo (detalle de la factura; el PDF se obtiene con «Imprimir carta» › Guardar como PDF) */
  app.post("/central/facturas/:id/enviar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ para: z.array(z.string().trim().toLowerCase().email("Correo inválido").max(120)).min(1, "Escriba el correo del cliente").max(5), mensaje: z.string().trim().max(1000).optional() }).parse(req.body);
    await cargar(req, id);
    const empresaId = empresaDe(req);
    if (!(await correoListo(empresaId))) throw new ErrorNegocio("Falta configurar el correo: Negocio › Correo y envíos.");
    const t = (await datosTicket(pool, id)) as Record<string, any>;
    const NOMBRES: Record<string, string> = { E31: "Factura de crédito fiscal", E32: "Factura de consumo", B01: "Factura de crédito fiscal", B02: "Factura de consumo", B14: "Factura", B15: "Factura", B16: "Factura de exportación", SIN: "Factura" };
    const mail = correoFactura(await marcaDe(empresaId), {
      titulo: NOMBRES[t.tipoDocumento] ?? "Factura", numero: t.fiscal?.encf ?? t.numeroDocumento ?? `Nº ${t.numero}`,
      fecha: new Date(t.fecha).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" }),
      cliente: t.cliente?.nombre ?? null, subtotal: Number(t.subtotal), descuento: Number(t.descuento ?? 0), itbis: Number(t.itbis), total: Number(t.total),
      notas: t.notas ?? null, pagos: (t.pagos ?? []).map((p: { formaPago: string; monto: string }) => `${p.formaPago} ${Number(p.monto).toFixed(2)}`).join(" · ") || null,
      fiscal: t.fiscal ? { encf: t.fiscal.encf, codigoSeguridad: t.fiscal.codigoSeguridad ?? null } : null,
      lineas: (t.lineas ?? []).map((l: { descripcion: string; cantidad: string; precio: string; total: string }) => ({ descripcion: l.descripcion, cantidad: Number(l.cantidad), precio: Number(l.precio), total: Number(l.total) })),
    }, b.mensaje);
    try { await enviarCorreo(empresaId, { para: b.para, asunto: mail.asunto, html: mail.html, texto: mail.texto }); }
    catch (e) { throw new ErrorNegocio(`No se pudo enviar: ${(e as Error).message}`, 502); }
    return { ok: true };
  });

  /** Modificar: solo la nota y, en facturas internas, el cliente. Siempre con motivo y en auditoría. */
  app.put("/central/facturas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      motivo: z.string().trim().min(10, "Explique el motivo (mínimo 10 caracteres)").max(200),
      notas: z.string().trim().max(300).nullable().optional(),
      clienteId: uuid.nullable().optional(),
    }).parse(req.body);
    const v = await cargar(req, id);
    if (b.notas === undefined && b.clienteId === undefined) throw new ErrorNegocio("No hay nada que modificar");
    if (b.clienteId !== undefined && v.tipo_documento !== "SIN") {
      throw new ErrorNegocio("El cliente de una factura con comprobante fiscal no se cambia: anule la factura y emita otra.", 409);
    }
    await enTransaccion(async (c) => {
      const ant = (await c.query("SELECT notas, cliente_id FROM ventas WHERE id = $1 FOR UPDATE", [id])).rows[0];
      const ya = await c.query("SELECT 1 FROM ventas WHERE venta_origen_id = $1 AND NOT parcial AND tipo_documento IN ('E34','ANU')", [id]);
      if (ya.rowCount) throw new ErrorNegocio("La factura está anulada y no se puede modificar", 409);
      if (b.clienteId) {
        const ok = await c.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2", [b.clienteId, empresaDe(req)]);
        if (!ok.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
      }
      await c.query(
        "UPDATE ventas SET notas = CASE WHEN $2::boolean THEN $3 ELSE notas END, cliente_id = CASE WHEN $4::boolean THEN $5::uuid ELSE cliente_id END WHERE id = $1",
        [id, b.notas !== undefined, b.notas ?? null, b.clienteId !== undefined, b.clienteId ?? null],
      );
      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
         VALUES ($1,$2,$3,$3,'venta.modificar','venta',$4,$5)`,
        [uuidv7(), v.sucursal_id, usuarioDe(req), id, JSON.stringify({ motivo: b.motivo, antes: ant, despues: { notas: b.notas, clienteId: b.clienteId } })],
      );
    });
    return datosTicket(pool, id);
  });

  /** Productos que se pueden agregar al corregir una factura. */
  app.get("/central/facturas/buscar-producto", async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    return (await pool.query(
      `SELECT pr.id AS "presentacionId", TRIM(p.nombre || ' ' || pr.nombre) AS nombre,
              (SELECT x.precio FROM precios x JOIN listas_precio lp ON lp.id = x.lista_precio_id AND lp.es_predeterminada
                WHERE x.presentacion_id = pr.id AND x.activo AND x.sucursal_id IS NULL LIMIT 1) AS precio
         FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id
        WHERE p.empresa_id = $1 AND p.activo AND (p.nombre ILIKE '%' || $2 || '%' OR p.sku ILIKE $2 || '%'
              OR EXISTS (SELECT 1 FROM codigos_barra cb WHERE cb.presentacion_id = pr.id AND cb.codigo = $2))
        ORDER BY p.nombre LIMIT 15`, [empresaDe(req), q])).rows;
  });

  /**
   * Corregir una factura sin comprobante (líneas, cantidades, descuentos, cliente, nota).
   * Por el diseño inmutable del sistema se hace así, todo en una sola transacción: la factura original queda anulada
   * («Corregida») con su devolución al inventario y la nueva sale con los cambios y un número nuevo.
   * Solo mientras el turno de la factura siga abierto (el cuadre de un turno cerrado no se toca).
   */
  app.post("/central/facturas/:id/corregir", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      motivo: z.string().trim().min(10, "Explique el motivo (mínimo 10 caracteres)").max(200),
      items: z.array(z.object({
        presentacionId: uuid, cantidad: z.string().regex(/^\d+(\.\d{1,3})?$/), descuentoManual: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      })).min(1, "La factura necesita al menos un producto").max(200),
      clienteId: uuid.nullable().optional(),
      notas: z.string().trim().max(300).nullable().optional(),
    }).parse(req.body);
    if (!tienePermiso(permisos(req), "venta.anular")) throw new ErrorNegocio("Corregir una factura requiere permiso de supervisor", 403);
    const v = await cargar(req, id);
    // El servidor principal que además atiende las cajas de una tienda (SUCURSAL_LOCAL) opera las facturas de ESA sucursal
    if (config.modo !== "sucursal" && v.sucursal_id !== sucursalPropia()) throw new ErrorNegocio("La corrección se hace en la administración de la sucursal (su servidor): allí están la caja y el inventario de esa factura.", 409);
    if (v.tipo_documento !== "SIN") throw new ErrorNegocio("Solo se corrigen las facturas sin comprobante. Las fiscales se anulan y se emite una nueva.", 409);
    const usuarioId = usuarioDe(req);
    return enTransaccion(async (c) => {
      const o = (await c.query(
        `SELECT v.*, t.estado AS turno_estado, u.nombre AS supervisor FROM ventas v JOIN turnos t ON t.id = v.turno_id, usuarios u
          WHERE v.id = $1 AND u.id = $2 FOR UPDATE OF v`, [id, usuarioId])).rows[0];
      if (o.turno_estado !== "ABIERTO") throw new ErrorNegocio("El turno de esta factura ya está cerrado: su cuadre no se modifica. Anule la factura y emita una nueva en un turno abierto.", 409);
      const pagos = (await c.query("SELECT forma_pago, monto, referencia FROM venta_pagos WHERE venta_id = $1", [id])).rows;
      if (pagos.length !== 1) throw new ErrorNegocio("Esta factura tiene varios pagos: anúlela y emita una nueva con las formas de pago correctas.", 409);
      const clienteId = b.clienteId === undefined ? o.cliente_id : b.clienteId;
      const hayDescuento = b.items.some((i) => Number(i.descuentoManual ?? 0) > 0);

      await anularVenta(c, { cajaId: o.caja_id, ventaId: id, usuarioId, supervisorId: usuarioId, motivo: `Corregida: ${b.motivo}`, corregir: true });

      const nueva = await registrarVenta(c, o.caja_id, {
        usuarioId: o.usuario_id, tipoDocumento: "SIN", clienteId: clienteId ?? undefined,
        notas: (b.notas === undefined ? o.notas : b.notas) ?? undefined,
        items: b.items.map((i) => ({ presentacionId: i.presentacionId, cantidad: i.cantidad, descuentoManual: i.descuentoManual })),
        ...(hayDescuento ? { autorizacionDescuento: autorizacionDirecta(usuarioId, o.supervisor, "venta.descuento", o.caja_id), motivoDescuento: b.motivo } : {}),
        // El mismo medio de pago, por el nuevo total
        pagos: [{ formaPago: pagos[0].forma_pago, monto: "0", referencia: pagos[0].referencia ?? undefined }],
      } as never, { pagarTodoCon: pagos[0].forma_pago });

      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
         VALUES ($1,$2,$3,$3,'venta.corregir.nueva','venta',$4,$5)`,
        [uuidv7(), v.sucursal_id, usuarioId, id, JSON.stringify({ motivo: b.motivo, reemplazadaPor: (nueva as { id?: string }).id ?? null })],
      );
      return nueva;
    });
  });

  /** Anular desde la administración de la sucursal (donde están las cajas y el inventario). */
  app.post("/central/facturas/:id/anular", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ motivo: z.string().trim().min(10, "Explique el motivo (mínimo 10 caracteres)").max(200) }).parse(req.body);
    if (!tienePermiso(permisos(req), "venta.anular")) throw new ErrorNegocio("Anular una factura requiere permiso de supervisor", 403);
    const v = await cargar(req, id);
    if (config.modo !== "sucursal" && v.sucursal_id !== sucursalPropia()) {
      throw new ErrorNegocio("La anulación se hace en la administración de la sucursal (su servidor): allí están la caja y el inventario de esa factura.", 409);
    }
    const usuarioId = usuarioDe(req);
    return enTransaccion(async (c) => {
      // La devolución del dinero se registra en un turno abierto: el de la caja de la factura o, si no, el de otra caja de la sucursal
      const t = await c.query<{ caja_id: string }>(
        `SELECT caja_id FROM turnos WHERE sucursal_id = $1 AND estado = 'ABIERTO' ORDER BY (caja_id = $2) DESC, abierto_en LIMIT 1`,
        [v.sucursal_id, v.caja_id],
      );
      if (!t.rowCount) throw new ErrorNegocio("No hay un turno abierto en la sucursal para registrar la devolución: abra una caja e intente de nuevo.", 409);
      const r = await anularVenta(c, { cajaId: t.rows[0].caja_id, ventaId: id, usuarioId, supervisorId: usuarioId, motivo: b.motivo, corregir: false });
      return r;
    });
  });
  /** Devolución parcial: una nota de crédito por las líneas y cantidades indicadas; la factura sigue vigente. */
  app.post("/central/facturas/:id/devolver", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      motivo: z.string().trim().min(10, "Explique el motivo (mínimo 10 caracteres)").max(200),
      lineas: z.array(z.object({ linea: z.number().int().positive(), cantidad: z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida") })).min(1, "Indique qué se devuelve").max(200),
    }).parse(req.body);
    if (!tienePermiso(permisos(req), "venta.anular")) throw new ErrorNegocio("Una devolución requiere permiso de supervisor", 403);
    const v = await cargar(req, id);
    if (config.modo !== "sucursal" && v.sucursal_id !== sucursalPropia()) {
      throw new ErrorNegocio("La devolución se hace en la administración de la sucursal (su servidor): allí están la caja y el inventario de esa factura.", 409);
    }
    const usuarioId = usuarioDe(req);
    return enTransaccion(async (c) => {
      const t = await c.query<{ caja_id: string }>(
        `SELECT caja_id FROM turnos WHERE sucursal_id = $1 AND estado = 'ABIERTO' ORDER BY (caja_id = $2) DESC, abierto_en LIMIT 1`, [v.sucursal_id, v.caja_id]);
      if (!t.rowCount) throw new ErrorNegocio("No hay un turno abierto en la sucursal para registrar la devolución: abra una caja e intente de nuevo.", 409);
      return devolverParcial(c, { cajaId: t.rows[0].caja_id, ventaId: id, usuarioId, supervisorId: usuarioId, motivo: b.motivo, lineas: b.lineas });
    });
  });

  // ================= Crear facturas desde la administración =================
  // Se factura contra una caja con el turno abierto (ahí entran el dinero y el cuadre); el inventario sale de su almacén.
  const soloSucursal = () => {
    if (config.modo !== "sucursal" && !sucursalPropia()) throw new ErrorNegocio("Las facturas se crean en la administración de la sucursal (su servidor): allí están la caja, el inventario y la firma del e-CF.", 409);
  };
  /** La caja debe ser de esta empresa y de una sucursal permitida al usuario */
  const cajaPermitida = async (req: { headers: Record<string, unknown> }, cajaId: string) => {
    const ctx = await contextoCaja(cajaId);
    if (ctx.empresaId !== empresaDe(req)) throw new ErrorNegocio("Caja no encontrada", 404);
    const permitidas = sucursalesDe(req);
    if (permitidas && !permitidas.includes(ctx.sucursalId)) throw new ErrorNegocio("No tiene acceso a esa sucursal", 403);
    return ctx;
  };
  const ItemsSchema = z.array(z.object({ presentacionId: uuid, cantidad: z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida"), descuentoManual: z.string().regex(/^\d+(\.\d{1,2})?$/, "Descuento inválido").optional(), precioVariable: z.string().regex(/^\d+(\.\d{1,2})?$/, "Precio inválido").optional(), precioLibre: z.string().regex(/^\d+(\.\d{1,2})?$/, "Precio inválido").optional(), series: z.array(z.string().trim().min(1).max(60)).max(500).optional() })).min(1, "La factura necesita al menos un producto").max(200);

  /** Verifica descuentos y precios libres de una venta (permiso + motivo) y devuelve la autorización de descuento si hace falta */
  const exigirPermisosItems = async (req: { headers: Record<string, unknown> }, cajaId: string, items: z.infer<typeof ItemsSchema>, motivoDescuento?: string, motivoPrecio?: string) => {
    let autorizacion: string | undefined;
    if (items.some((i) => Number(i.descuentoManual ?? 0) > 0)) {
      if (!tienePermiso(permisos(req), "venta.descuento")) throw new ErrorNegocio("Los descuentos requieren el permiso de aprobar descuentos (supervisor).", 403);
      if (!motivoDescuento || motivoDescuento.length < 5) throw new ErrorNegocio("Indique el motivo del descuento (mínimo 5 caracteres).");
      const yo = (await pool.query<{ nombre: string }>("SELECT nombre FROM usuarios WHERE id = $1", [usuarioDe(req)])).rows[0];
      autorizacion = autorizacionDirecta(usuarioDe(req), yo?.nombre ?? "Administración", "venta.descuento", cajaId);
    }
    if (items.some((i) => i.precioLibre)) {
      if (!tienePermiso(permisos(req), "venta.precio_libre")) throw new ErrorNegocio("Cambiar el precio de una línea requiere el permiso «Facturar con precio libre».", 403);
      if (!motivoPrecio || motivoPrecio.length < 5) throw new ErrorNegocio("Indique el motivo del cambio de precio (mínimo 5 caracteres).");
    }
    return autorizacion;
  };

  /** Ventas por cobrar: se arman aquí y se envían a una caja, que las cobra (el e-CF sale al cobrar) */
  app.post("/central/por-cobrar", async (req, rep) => {
    soloSucursal();
    const b = z.object({
      cajaId: uuid, clienteId: uuid.optional(), items: ItemsSchema, notas: z.string().trim().max(300).optional(),
      motivoDescuento: z.string().trim().max(200).optional(), motivoPrecio: z.string().trim().max(200).optional(),
    }).parse(req.body);
    const ctx = await cajaPermitida(req, b.cajaId);
    await exigirLicenciaParaVender();
    await exigirPermisosItems(req, b.cajaId, b.items, b.motivoDescuento, b.motivoPrecio);
    await exigirSeriesPresentes(pool, b.items);
    const q = resumen(await cotizar(pool, ctx, { clienteId: b.clienteId, items: b.items }, false)); // valida precios, existencia y cliente
    const id = uuidv7();
    const numero = await enTransaccion(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('por_cobrar:' || $1))", [ctx.sucursalId]);
      const r = await c.query<{ numero: string }>(
        `INSERT INTO ventas_por_cobrar (id, sucursal_id, numero, caja_id, cliente_id, items, total, notas, motivo_descuento, motivo_precio, creada_por)
         VALUES ($1,$2,(SELECT COALESCE(MAX(numero),0)+1 FROM ventas_por_cobrar WHERE sucursal_id = $2),$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING numero::text`,
        [id, ctx.sucursalId, b.cajaId, b.clienteId ?? null, JSON.stringify(b.items), (q as { total: string }).total, b.notas ?? null, b.motivoDescuento ?? null, b.motivoPrecio ?? null, usuarioDe(req)]);
      return r.rows[0].numero;
    });
    rep.code(201);
    return { id, numero, total: (q as { total: string }).total };
  });

  const listarPorCobrar = async (req: any, soloMias: boolean) => {
    const permitidas = sucursalesDe(req);
    const mias = soloMias;
    const r = await pool.query(
      `SELECT v.id, v.numero::text, v.total::text, v.estado, v.creada_en AS "creadaEn", ca.nombre AS caja, s.nombre AS sucursal,
              cl.nombre AS cliente, u.nombre AS vendedor, jsonb_array_length(v.items) AS lineas, ed.encf
         FROM ventas_por_cobrar v JOIN cajas ca ON ca.id = v.caja_id JOIN sucursales s ON s.id = v.sucursal_id
         LEFT JOIN clientes cl ON cl.id = v.cliente_id LEFT JOIN usuarios u ON u.id = v.creada_por
         LEFT JOIN ecf_documentos ed ON ed.venta_id = v.venta_id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) AND (v.estado = 'PENDIENTE' OR v.cerrada_en > now() - interval '2 days')
          AND ($3::uuid IS NULL OR v.creada_por = $3)
        ORDER BY (v.estado = 'PENDIENTE') DESC, v.creada_en DESC LIMIT 200`, [empresaDe(req), permitidas, mias ? usuarioDe(req) : null]);
    return r.rows;
  };
  // El vendedor solo ve las suyas; la supervisión (admin.facturas) ve todas en su propia pantalla
  app.get("/central/por-cobrar", async (req) => listarPorCobrar(req, true));
  app.get("/central/por-cobrar-todas", async (req) => listarPorCobrar(req, false));

  const anularPorCobrar = async (req: any) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const permitidas = sucursalesDe(req);
    const r = await pool.query(
      `UPDATE ventas_por_cobrar v SET estado = 'ANULADA', cerrada_en = now(), cerrada_por = $4
        FROM sucursales s WHERE v.id = $1 AND s.id = v.sucursal_id AND s.empresa_id = $2 AND ($3::uuid[] IS NULL OR s.id = ANY($3::uuid[])) AND v.estado = 'PENDIENTE'
         AND ($5::boolean OR v.creada_por = $4)`,
      [id, empresaDe(req), permitidas, usuarioDe(req), tienePermiso(permisos(req), "admin.facturas")]);
    if (!r.rowCount) throw new ErrorNegocio("La venta no existe o ya no está pendiente", 404);
    return { ok: true };
  };
  for (const u of ["/central/por-cobrar/:id/anular", "/central/por-cobrar-todas/:id/anular"]) app.post(u, anularPorCobrar);

  /** Cajas con turno abierto: dónde se puede facturar */
  const cajasAbiertas = async (req: any) => {
    const permitidas = sucursalesDe(req);
    const r = await pool.query(
      `SELECT ca.id AS "cajaId", ca.nombre AS caja, ca.tipo, s.id AS "sucursalId", s.nombre AS sucursal, u.nombre AS cajero, t.abierto_en AS "abiertoEn"
         FROM cajas ca JOIN sucursales s ON s.id = ca.sucursal_id
         LEFT JOIN turnos t ON t.caja_id = ca.id AND t.estado = 'ABIERTO' LEFT JOIN usuarios u ON u.id = t.usuario_id
        WHERE ca.activo AND NOT ca.eliminada AND s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))
          AND (t.id IS NOT NULL OR ca.tipo = 'FACTURACION')  -- la de facturación no necesita turno abierto: se abre sola al facturar
        ORDER BY (ca.tipo = 'FACTURACION') DESC, s.nombre, ca.nombre`, [empresaDe(req), permitidas]);
    return r.rows;
  };
  for (const u of ["/central/facturas/cajas-abiertas", "/central/ventas/cajas-abiertas"]) app.get(u, cajasAbiertas);

  /** Precios, ofertas e ITBIS de lo que se va a facturar (con los precios del nivel del cliente) */
  const cotizarFactura = async (req: any) => {
    const b = z.object({ cajaId: uuid, clienteId: uuid.optional(), cuponCodigo: z.string().trim().min(1).max(30).optional(), items: ItemsSchema }).parse(req.body);
    const ctx = await cajaPermitida(req, b.cajaId);
    if (b.items.some((i) => i.precioLibre) && !tienePermiso(permisos(req), "venta.precio_libre")) throw new ErrorNegocio("Cambiar el precio de una línea requiere el permiso «Facturar con precio libre».", 403);
    return resumen(await cotizar(pool, ctx, { clienteId: b.clienteId, cuponCodigo: b.cuponCodigo, items: b.items }, false));
  };
  for (const u of ["/central/facturas/cotizar", "/central/ventas/cotizar"]) app.post(u, cotizarFactura);

  app.post("/central/facturas", async (req, rep) => {
    soloSucursal();
    const b = z.object({
      cajaId: uuid, clienteId: uuid.optional(), tipoDocumento: z.enum(["E32", "E31", "B01", "B02", "B14", "B15", "B16", "SIN"]),
      notas: z.string().trim().max(300).optional(), ventaId: uuid.optional(), items: ItemsSchema, motivoPrecio: z.string().trim().max(200).optional(),
      cuponCodigo: z.string().trim().min(1).max(30).optional(), motivoDescuento: z.string().trim().max(200).optional(),
      pagos: z.array(z.object({
        formaPago: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO", "OTRO"]),
        monto: z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido"), recibido: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), referencia: z.string().max(60).optional(),
      })).min(1, "Falta la forma de pago"),
    }).parse(req.body);
    await cajaPermitida(req, b.cajaId);
    await exigirLicenciaParaVender();
    const usuarioId = usuarioDe(req);
    if (b.tipoDocumento === "SIN") await exigirSinComprobante(b.cajaId);
    // Descuentos manuales: solo con el permiso de aprobar descuentos (la persona que factura es quien los autoriza) y con motivo
    const hayDescuento = b.items.some((i) => Number(i.descuentoManual ?? 0) > 0);
    let autorizacion: string | undefined;
    if (hayDescuento) {
      if (!tienePermiso(permisos(req), "venta.descuento")) throw new ErrorNegocio("Los descuentos requieren el permiso de aprobar descuentos (supervisor).", 403);
      if (!b.motivoDescuento || b.motivoDescuento.length < 5) throw new ErrorNegocio("Indique el motivo del descuento (mínimo 5 caracteres).");
      const yo = (await pool.query<{ nombre: string }>("SELECT nombre FROM usuarios WHERE id = $1", [usuarioId])).rows[0];
      autorizacion = autorizacionDirecta(usuarioId, yo?.nombre ?? "Administración", "venta.descuento", b.cajaId);
    }
    // Precio libre: solo con el permiso y con motivo; queda en la auditoría
    const libres = b.items.filter((i) => i.precioLibre);
    if (libres.length) {
      if (!tienePermiso(permisos(req), "venta.precio_libre")) throw new ErrorNegocio("Cambiar el precio de una línea requiere el permiso «Facturar con precio libre».", 403);
      if (!b.motivoPrecio || b.motivoPrecio.length < 5) throw new ErrorNegocio("Indique el motivo del cambio de precio (mínimo 5 caracteres).");
    }
    const r = await enTransaccion(async (c) => {
      // Caja de «Facturación» (tienda sin punto de venta): su turno se abre solo, sin fondo, la primera vez que se factura
      if ((await c.query("SELECT 1 FROM cajas WHERE id = $1 AND tipo = 'FACTURACION'", [b.cajaId])).rowCount) {
        await c.query("SELECT 1 FROM cajas WHERE id = $1 FOR UPDATE", [b.cajaId]);
        await c.query(
          `INSERT INTO turnos (id, sucursal_id, caja_id, usuario_id, abierto_en, fondo_inicial)
           SELECT $1, ca.sucursal_id, ca.id, $3, now(), 0 FROM cajas ca WHERE ca.id = $2
              AND NOT EXISTS (SELECT 1 FROM turnos t WHERE t.caja_id = ca.id AND t.estado = 'ABIERTO')`, [uuidv7(), b.cajaId, usuarioId]);
      }
      return registrarVenta(c, b.cajaId, {
      usuarioId, ventaId: b.ventaId, clienteId: b.clienteId, tipoDocumento: b.tipoDocumento, notas: b.notas, items: b.items, pagos: b.pagos,
      cuponCodigo: b.cuponCodigo, ...(hayDescuento ? { autorizacionDescuento: autorizacion, motivoDescuento: b.motivoDescuento } : {}),
      }, { exigirSeries: true });
    });
    await pool.query(
      `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
       VALUES ($1,(SELECT sucursal_id FROM cajas WHERE id = $2),$3,$3,'venta.admin','venta',$4,$5)`,
      [uuidv7(), b.cajaId, usuarioId, (r as { id: string }).id, JSON.stringify({ origen: "administración", tipo: b.tipoDocumento, ...(libres.length ? { precioLibre: libres.map((i) => ({ presentacionId: i.presentacionId, precio: i.precioLibre })), motivoPrecio: b.motivoPrecio } : {}) })]).catch(() => undefined);
    rep.code(201);
    return r;
  });
}
