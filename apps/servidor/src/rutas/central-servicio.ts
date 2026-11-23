import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { estadoTunel } from "../tunel.js";

/**
 * Servicio técnico y reparaciones, para cualquier negocio: la orden de un artículo vendido aquí (con su serie se ve la garantía y a quién
 * se le vendió) o de un equipo que trae el cliente de otro lado (marca, modelo, accesorios). Tres tipos de garantía: TIENDA (no se cobra),
 * FABRICANTE (se envía al fabricante y se espera su regreso) y SIN (se cotiza: el cliente aprueba o rechaza antes de reparar; si rechaza,
 * la revisión se puede cobrar según la opción de la empresa). El técnico la mueve por sus estados hasta entregarla.
 * (Pide el permiso «admin.servicio».)
 */
const uuid = z.string().uuid();
const hoyRD = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const ESTADOS = ["RECIBIDO", "EN_REVISION", "COTIZADO", "EN_REPARACION", "ESPERANDO_PIEZA", "EN_FABRICANTE", "LISTO", "ENTREGADO", "SIN_REPARACION", "CANCELADO"] as const;
const FINALES = ["ENTREGADO", "SIN_REPARACION", "CANCELADO"];
const monto = z.coerce.number().min(0).max(99999999);

const huellaEnlace = (t: string) => createHash("sha256").update(t).digest("hex");
export { huellaEnlace };

/**
 * El cliente aprueba o rechaza la cotización (la registra el personal, o el propio cliente desde el enlace de WhatsApp).
 * Aprobada: la orden pasa a reparación y sus costos toman la cotización. Rechazada: se cierra sin reparación y, si la empresa lo activó,
 * se anota la revisión a cobrar. Deja constancia de quién, por qué medio y cuándo.
 */
export async function aplicarDecision(c: pg.PoolClient, o: {
  id: string; empresaId: string; resultado: "APROBADA" | "RECHAZADA"; por: string; medio: "PRESENCIAL" | "TELEFONO" | "WHATSAPP" | "ENLACE";
  cobrarRevision?: number; usuarioId: string | null; ip?: string | null;
}) {
  const t = (await c.query<{ estado: string; aprobacion: string | null; cotiz_mano_obra: string | null; cotiz_piezas: string | null }>(
    `SELECT t.estado, t.aprobacion, t.cotiz_mano_obra, t.cotiz_piezas FROM servicios_tecnicos t JOIN sucursales s ON s.id = t.sucursal_id
      WHERE t.id = $1 AND s.empresa_id = $2 FOR UPDATE OF t`, [o.id, o.empresaId])).rows[0];
  if (!t) throw new ErrorNegocio("Orden no encontrada", 404);
  if (t.aprobacion !== "PENDIENTE" || t.estado !== "COTIZADO") throw new ErrorNegocio("Esta cotización ya no está esperando respuesta", 409);
  let estado: string, nota: string, revision = 0;
  if (o.resultado === "APROBADA") {
    estado = "EN_REPARACION";
    nota = `Cotización aprobada por ${o.por} (${o.medio === "ENLACE" ? "por el enlace" : o.medio.toLowerCase()})`;
  } else {
    const cfg = (await c.query<{ cobrar_revision: boolean; monto_revision: string }>("SELECT cobrar_revision, monto_revision FROM servicio_config WHERE empresa_id = $1", [o.empresaId])).rows[0];
    revision = o.cobrarRevision ?? (cfg?.cobrar_revision ? Number(cfg.monto_revision) : 0);
    estado = "SIN_REPARACION";
    nota = `Cotización rechazada por ${o.por} (${o.medio === "ENLACE" ? "por el enlace" : o.medio.toLowerCase()})${revision > 0 ? `; se cobra la revisión: ${new Decimal(revision).toFixed(2)}` : ""}`;
  }
  await c.query(
    `UPDATE servicios_tecnicos SET aprobacion = $2::varchar(10), aprobacion_en = now(), aprobacion_por = $3, aprobacion_medio = $4::varchar(12), aprobacion_ip = $5::text, estado = $6::varchar(16),
            costo_mano_obra = CASE WHEN $2::varchar(10) = 'APROBADA' THEN COALESCE(cotiz_mano_obra, 0) ELSE costo_mano_obra END,
            costo_piezas = CASE WHEN $2::varchar(10) = 'APROBADA' THEN COALESCE(cotiz_piezas, 0) ELSE costo_piezas END,
            cobro_revision = $7, enlace_hash = NULL, enlace_vence = NULL WHERE id = $1`,
    [o.id, o.resultado, o.por, o.medio, o.ip ?? null, estado, new Decimal(revision).toFixed(2)]);
  await c.query("INSERT INTO servicio_historial (id, servicio_id, estado, nota, usuario_id) VALUES ($1,$2,$3,$4,$5)", [uuidv7(), o.id, estado, nota, o.usuarioId]);
  return { estado, revision };
}

export async function rutasCentralServicio(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  const SQL = `
    SELECT t.id, t.numero::text, 'SRV-' || s.codigo || '-' || lpad(t.numero::text, 6, '0') AS codigo, t.estado, t.descripcion, t.serie, t.falla, t.lugar, t.direccion, t.telefono, t.tecnico,
           to_char(t.garantia_hasta,'YYYY-MM-DD') AS "garantiaHasta", t.en_garantia AS "enGarantia", t.diagnostico, t.solucion,
           t.tipo_garantia AS "tipoGarantia", t.marca, t.modelo, t.accesorios, t.estado_equipo AS "estadoEquipo",
           t.cotiz_mano_obra::text AS "cotizManoObra", t.cotiz_piezas::text AS "cotizPiezas", t.cotiz_nota AS "cotizNota", t.cotiz_en AS "cotizEn",
           t.aprobacion, t.aprobacion_en AS "aprobacionEn", t.aprobacion_por AS "aprobacionPor", t.aprobacion_medio AS "aprobacionMedio", t.cobro_revision::text AS "cobroRevision",
           t.fabricante_referencia AS "fabricanteReferencia", to_char(t.fabricante_envio,'YYYY-MM-DD') AS "fabricanteEnvio", to_char(t.fabricante_regreso,'YYYY-MM-DD') AS "fabricanteRegreso",
           t.costo_mano_obra::text AS "costoManoObra", t.costo_piezas::text AS "costoPiezas", t.recibida_en AS "recibidaEn", t.lista_en AS "listaEn", t.entregada_en AS "entregadaEn",
           t.venta_id AS "ventaId", v.numero_interno AS factura, t.cliente_id AS "clienteId", cl.nombre AS cliente, cl.documento AS "clienteDocumento", s.nombre AS sucursal, u.nombre AS "creadaPor"
      FROM servicios_tecnicos t JOIN sucursales s ON s.id = t.sucursal_id LEFT JOIN clientes cl ON cl.id = t.cliente_id LEFT JOIN ventas v ON v.id = t.venta_id LEFT JOIN usuarios u ON u.id = t.creada_por`;

  /** Busca el artículo vendido por serie, factura, cliente o cédula: de ahí sale la garantía */
  app.get("/central/servicio/series", async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(40) }).parse(req.query);
    const r = await pool.query(
      `SELECT sp.id, sp.serie, p.nombre AS producto, sp.venta_id AS "ventaId", v.numero_interno AS factura, sp.vendida_en AS "vendidaEn", to_char(sp.garantia_hasta,'YYYY-MM-DD') AS "garantiaHasta",
              (sp.garantia_hasta IS NOT NULL AND sp.garantia_hasta >= $4::date) AS vigente, cl.id AS "clienteId", cl.nombre AS cliente, cl.documento AS "clienteDocumento", cl.telefono, cl.direccion
         FROM series_producto sp JOIN productos p ON p.id = sp.producto_id JOIN ventas v ON v.id = sp.venta_id JOIN sucursales s ON s.id = v.sucursal_id
         LEFT JOIN clientes cl ON cl.id = sp.cliente_id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) AND sp.devuelta_en IS NULL
          AND (sp.serie ILIKE '%' || $3 || '%' OR v.numero_interno::text = $3 OR cl.nombre ILIKE '%' || $3 || '%' OR cl.documento LIKE $3 || '%')
        ORDER BY sp.vendida_en DESC LIMIT 20`, [empresaDe(req), sucursalesDe(req), q.replace(/\s+/g, ""), hoyRD()]);
    return r.rows;
  });

  app.post("/central/servicio", async (req, rep) => {
    const empresaId = empresaDe(req);
    const b = z.object({
      serieId: uuid.optional(), descripcion: z.string().trim().min(2).max(200).optional(), clienteId: uuid.optional(), sucursalId: uuid.optional(),
      falla: z.string().trim().min(3, "Describa la falla").max(500), lugar: z.enum(["TALLER", "DOMICILIO"]).default("TALLER"),
      direccion: z.string().trim().max(300).optional(), telefono: z.string().trim().max(30).optional(), tecnico: z.string().trim().max(80).optional(),
      tipoGarantia: z.enum(["TIENDA", "FABRICANTE", "SIN"]).optional(), marca: z.string().trim().max(60).optional(), modelo: z.string().trim().max(60).optional(),
      serieLibre: z.string().trim().max(60).optional(), accesorios: z.string().trim().max(300).optional(), estadoEquipo: z.string().trim().max(300).optional(),
    }).parse(req.body);
    if (!b.serieId && !b.descripcion) throw new ErrorNegocio("Busque el artículo por su serie o escriba qué artículo es");
    if (b.lugar === "DOMICILIO" && !b.direccion) throw new ErrorNegocio("El servicio a domicilio necesita la dirección");
    const id = uuidv7();
    const out = await enTransaccion(async (c) => {
      let sucursalId = b.sucursalId, clienteId = b.clienteId ?? null, ventaId: string | null = null, productoId: string | null = null, serie: string | null = null, garantiaHasta: string | null = null;
      let descripcion = b.descripcion ?? "";
      if (!b.serieId) {
        serie = (b.serieLibre ?? "").replace(/\s+/g, " ").toUpperCase() || null;
        if (!serie || serie.length < 3) throw new ErrorNegocio("Escriba la serie del equipo: queda en su historial de servicio");
      }
      if (b.serieId) {
        const s = (await c.query<{ sucursal_id: string; producto_id: string; producto: string; serie: string; venta_id: string; cliente_id: string | null; garantia: string | null }>(
          `SELECT v.sucursal_id, sp.producto_id, p.nombre AS producto, sp.serie, sp.venta_id, sp.cliente_id, to_char(sp.garantia_hasta,'YYYY-MM-DD') AS garantia
             FROM series_producto sp JOIN productos p ON p.id = sp.producto_id JOIN ventas v ON v.id = sp.venta_id JOIN sucursales su ON su.id = v.sucursal_id
            WHERE sp.id = $1 AND su.empresa_id = $2`, [b.serieId, empresaId])).rows[0];
        if (!s) throw new ErrorNegocio("Artículo no encontrado", 404);
        sucursalId = s.sucursal_id; clienteId = s.cliente_id ?? clienteId; ventaId = s.venta_id; productoId = s.producto_id; serie = s.serie; garantiaHasta = s.garantia;
        descripcion = s.producto;
      }
      if (!sucursalId) sucursalId = (await c.query<{ id: string }>("SELECT id FROM sucursales WHERE empresa_id = $1 AND activo ORDER BY tipo = 'ALMACEN', codigo LIMIT 1", [empresaId])).rows[0]?.id;
      if (!sucursalId || !(await c.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2", [sucursalId, empresaId])).rowCount) throw new ErrorNegocio("Sucursal no válida");
      if (!clienteId) throw new ErrorNegocio("Elija el cliente de la orden: hace falta para avisarle y enviarle la cotización");
      if (!(await c.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2", [clienteId, empresaId])).rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
      const vigente = !!garantiaHasta && garantiaHasta >= hoyRD();
      const tipoGarantia = b.tipoGarantia ?? (vigente ? "TIENDA" : "SIN");
      if (tipoGarantia === "TIENDA" && !vigente) throw new ErrorNegocio("La garantía de la tienda no está vigente para este artículo: use «Sin garantía» o «Garantía del fabricante»");
      const enGarantia = tipoGarantia !== "SIN"; // cubierta: no se le cobra al cliente
      await c.query("SELECT pg_advisory_xact_lock(hashtext('servicio:' || $1))", [sucursalId]);
      const n = (await c.query<{ numero: string }>(
        `INSERT INTO servicios_tecnicos (id, sucursal_id, numero, cliente_id, venta_id, serie_id, producto_id, descripcion, serie, falla, lugar, direccion, telefono, tecnico, garantia_hasta, en_garantia, creada_por, tipo_garantia, marca, modelo, accesorios, estado_equipo, aprobacion)
         VALUES ($1,$2,(SELECT COALESCE(MAX(numero),0)+1 FROM servicios_tecnicos WHERE sucursal_id = $2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING numero::text`,
        [id, sucursalId, clienteId, ventaId, b.serieId ?? null, productoId, descripcion, serie, b.falla, b.lugar, b.direccion ?? null, b.telefono ?? null, b.tecnico ?? null, garantiaHasta, enGarantia, usuarioDe(req),
         tipoGarantia, b.marca ?? null, b.modelo ?? null, b.accesorios ?? null, b.estadoEquipo ?? null, null])).rows[0].numero;
      await c.query("INSERT INTO servicio_historial (id, servicio_id, estado, nota, usuario_id) VALUES ($1,$2,'RECIBIDO',$3,$4)", [uuidv7(), id, b.falla, usuarioDe(req)]);
      return { numero: n, enGarantia, tipoGarantia };
    });
    rep.code(201);
    return { id, ...out };
  });

  app.get("/central/servicio", async (req) => {
    const q = z.object({ estado: z.enum([...ESTADOS, "ABIERTAS"]).optional(), q: z.string().trim().max(40).optional() }).parse(req.query);
    const p: unknown[] = [empresaDe(req), sucursalesDe(req)];
    const cond = ["s.empresa_id = $1", "($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))"];
    if (q.estado === "ABIERTAS") cond.push(`t.estado NOT IN ('ENTREGADO','SIN_REPARACION','CANCELADO')`);
    else if (q.estado) { p.push(q.estado); cond.push(`t.estado = $${p.length}`); }
    if (q.q) { p.push(q.q); cond.push(`(t.serie ILIKE '%' || $${p.length} || '%' OR t.descripcion ILIKE '%' || $${p.length} || '%' OR cl.nombre ILIKE '%' || $${p.length} || '%' OR t.numero::text = $${p.length})`); }
    return (await pool.query(`${SQL} WHERE ${cond.join(" AND ")} ORDER BY t.recibida_en DESC LIMIT 300`, p)).rows;
  });

  /** Opciones del servicio: cobrar la revisión cuando el cliente rechaza la cotización (opcional) y cuánto */
  app.get("/central/servicio/config", async (req) => {
    const r = await pool.query(`SELECT cobrar_revision AS "cobrarRevision", monto_revision::text AS "montoRevision" FROM servicio_config WHERE empresa_id = $1`, [empresaDe(req)]);
    return r.rows[0] ?? { cobrarRevision: false, montoRevision: "0.00" };
  });
  app.put("/central/servicio/config", async (req) => {
    const b = z.object({ cobrarRevision: z.boolean(), montoRevision: monto }).parse(req.body);
    if (b.cobrarRevision && !(b.montoRevision > 0)) throw new ErrorNegocio("Indique cuánto se cobra por la revisión");
    await pool.query(
      `INSERT INTO servicio_config (empresa_id, cobrar_revision, monto_revision) VALUES ($1,$2,$3)
       ON CONFLICT (empresa_id) DO UPDATE SET cobrar_revision = EXCLUDED.cobrar_revision, monto_revision = EXCLUDED.monto_revision`,
      [empresaDe(req), b.cobrarRevision, new Decimal(b.montoRevision).toFixed(2)]);
    return { ok: true };
  });

  /**
   * Genera el enlace para que el cliente apruebe o rechace la cotización desde su celular (vale 7 días; uno nuevo anula el anterior)
   * y el mensaje listo para enviarlo por WhatsApp.
   */
  app.post("/central/servicio/:id/enlace", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const o = (await pool.query<{ estado: string; aprobacion: string | null; telefono: string | null; cliente: string | null; descripcion: string; total: string; empresa: string | null; codigo: string }>(
      `SELECT t.estado, t.aprobacion, COALESCE(t.telefono, cl.telefono) AS telefono, cl.nombre AS cliente, t.descripcion,
              (COALESCE(t.cotiz_mano_obra,0) + COALESCE(t.cotiz_piezas,0))::text AS total, e.nombre_comercial AS empresa,
              'SRV-' || s.codigo || '-' || lpad(t.numero::text, 6, '0') AS codigo
         FROM servicios_tecnicos t JOIN sucursales s ON s.id = t.sucursal_id JOIN empresas e ON e.id = s.empresa_id LEFT JOIN clientes cl ON cl.id = t.cliente_id
        WHERE t.id = $1 AND s.empresa_id = $2`, [id, empresaDe(req)])).rows[0];
    if (!o) throw new ErrorNegocio("Orden no encontrada", 404);
    if (o.aprobacion !== "PENDIENTE" || o.estado !== "COTIZADO") throw new ErrorNegocio("Esta orden no tiene una cotización esperando respuesta: envíe primero la cotización", 409);
    const token = randomBytes(24).toString("base64url");
    await pool.query("UPDATE servicios_tecnicos SET enlace_hash = $2, enlace_vence = now() + interval '7 days' WHERE id = $1", [id, huellaEnlace(token)]);
    const publica = estadoTunel().url ?? process.env.PUBLIC_URL?.trim() ?? null;
    const alcanzable = !!publica || !!process.env.VERCEL;
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0];
    const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0];
    const base = (publica ?? (host ? `${proto}://${host}` : "")).replace(/\/+$/, "");
    const url = `${base}/aprobar/${token}`;
    const total = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(Number(o.total));
    const mensaje = `Hola${o.cliente ? " " + o.cliente.split(" ")[0] : ""}, le enviamos la cotización de la reparación de su ${o.descripcion}: ${total}. Puede revisarla y aprobarla o rechazarla aquí: ${url}${o.empresa ? `\n${o.empresa}` : ""}`;
    const dig = (o.telefono ?? "").replace(/\D/g, "");
    const wa = dig.length >= 10 ? `https://wa.me/${dig.length === 10 ? "1" + dig : dig}?text=${encodeURIComponent(mensaje)}` : null;
    return { url, vence: new Date(Date.now() + 7 * 86400e3).toISOString(), alcanzable, wa, mensaje };
  });

  app.get("/central/servicio/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(`${SQL} WHERE t.id = $1 AND s.empresa_id = $2`, [id, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Orden no encontrada", 404);
    const h = await pool.query(`SELECT h.estado, h.nota, h.creado_en AS fecha, u.nombre AS por FROM servicio_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.servicio_id = $1 ORDER BY h.creado_en`, [id]);
    return { ...r.rows[0], historial: h.rows };
  });

  /** Mueve la orden de estado y anota diagnóstico, solución, técnico y costos */
  app.put("/central/servicio/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      estado: z.enum(ESTADOS).optional(), nota: z.string().trim().max(400).optional(), diagnostico: z.string().trim().max(600).optional(), solucion: z.string().trim().max(600).optional(),
      tecnico: z.string().trim().max(80).optional(), costoManoObra: monto.optional(), costoPiezas: monto.optional(),
      cotizar: z.object({ manoObra: monto, piezas: monto, nota: z.string().trim().max(400).optional() }).optional(),
      decision: z.object({ resultado: z.enum(["APROBADA", "RECHAZADA"]), por: z.string().trim().min(2, "Anote quién decidió (el cliente u otra persona autorizada)").max(80),
        medio: z.enum(["PRESENCIAL", "TELEFONO", "WHATSAPP"]), cobrarRevision: monto.optional() }).optional(),
      fabricanteReferencia: z.string().trim().max(80).optional(),
    }).parse(req.body);
    await enTransaccion(async (c) => {
      const t = (await c.query<{ estado: string; en_garantia: boolean; tipo_garantia: string; aprobacion: string | null; cotiz_mano_obra: string | null; cotiz_piezas: string | null; fabricante_referencia: string | null }>(
        "SELECT t.estado, t.en_garantia, t.tipo_garantia, t.aprobacion, t.cotiz_mano_obra, t.cotiz_piezas, t.fabricante_referencia FROM servicios_tecnicos t JOIN sucursales s ON s.id = t.sucursal_id WHERE t.id = $1 AND s.empresa_id = $2 FOR UPDATE OF t", [id, empresaDe(req)])).rows[0];
      if (!t) throw new ErrorNegocio("Orden no encontrada", 404);
      if (FINALES.includes(t.estado)) throw new ErrorNegocio("Esa orden ya está cerrada", 409);
      if (b.estado === "SIN_REPARACION" && !b.nota && !b.decision) throw new ErrorNegocio("Anote por qué no tiene reparación");
      const set: string[] = [], p: unknown[] = [id];
      const usadas = new Set<string>(); // una columna se asigna una sola vez (la primera manda: la decisión del cliente gana sobre los costos escritos a mano)
      const add = (col: string, v: unknown) => { if (usadas.has(col)) return; usadas.add(col); p.push(v); set.push(`${col} = $${p.length}`); };
      const hist = async (estado: string, nota: string | null) => c.query("INSERT INTO servicio_historial (id, servicio_id, estado, nota, usuario_id) VALUES ($1,$2,$3,$4,$5)", [uuidv7(), id, estado, nota, usuarioDe(req)]);
      let estadoNuevo = b.estado && b.estado !== t.estado ? b.estado : undefined;
      let notaHist = b.nota ?? null;
      // Cotización (solo sin garantía): el cliente tiene que aprobarla antes de reparar
      if (b.cotizar) {
        if (t.en_garantia) throw new ErrorNegocio("Esta orden cubre garantía: no necesita cotización");
        if (!["RECIBIDO", "EN_REVISION", "COTIZADO"].includes(t.estado)) throw new ErrorNegocio("Ya no se puede cotizar: la orden está en " + t.estado, 409);
        add("cotiz_mano_obra", new Decimal(b.cotizar.manoObra).toFixed(2)); add("cotiz_piezas", new Decimal(b.cotizar.piezas).toFixed(2));
        add("cotiz_nota", b.cotizar.nota || null); set.push("cotiz_en = now()", "aprobacion = 'PENDIENTE'", "aprobacion_en = NULL", "aprobacion_por = NULL", "aprobacion_medio = NULL", "enlace_hash = NULL", "enlace_vence = NULL"); // una cotización nueva anula el enlace anterior
        estadoNuevo = "COTIZADO";
        notaHist = `Cotización enviada: ${new Decimal(b.cotizar.manoObra).plus(b.cotizar.piezas).toFixed(2)} (mano de obra ${new Decimal(b.cotizar.manoObra).toFixed(2)} + piezas ${new Decimal(b.cotizar.piezas).toFixed(2)})`;
      }
      if (b.decision) { // la respuesta del cliente se registra sola (no se mezcla con otros cambios)
        await aplicarDecision(c, { id, empresaId: empresaDe(req), resultado: b.decision.resultado, por: b.decision.por, medio: b.decision.medio, cobrarRevision: b.decision.cobrarRevision, usuarioId: usuarioDe(req) });
        return;
      }
      // Reparar sin aprobación del cliente no se puede cuando la reparación se cobra
      if (estadoNuevo && ["EN_REPARACION", "ESPERANDO_PIEZA", "LISTO"].includes(estadoNuevo) && !t.en_garantia && t.aprobacion !== "APROBADA")
        throw new ErrorNegocio("Falta la aprobación del cliente: envíe la cotización y registre su respuesta antes de reparar");
      if (estadoNuevo === "EN_FABRICANTE") {
        if (t.tipo_garantia !== "FABRICANTE") throw new ErrorNegocio("Solo las órdenes con garantía del fabricante se envían al fabricante");
        const ref = b.fabricanteReferencia ?? t.fabricante_referencia;
        if (!ref) throw new ErrorNegocio("Anote la referencia del envío o reclamo al fabricante");
        add("fabricante_referencia", ref); set.push("fabricante_envio = (now() AT TIME ZONE 'America/Santo_Domingo')::date");
      } else if (b.fabricanteReferencia !== undefined) add("fabricante_referencia", b.fabricanteReferencia || null);
      if (t.estado === "EN_FABRICANTE" && estadoNuevo && estadoNuevo !== "EN_FABRICANTE") set.push("fabricante_regreso = (now() AT TIME ZONE 'America/Santo_Domingo')::date");
      if (b.diagnostico !== undefined) add("diagnostico", b.diagnostico || null);
      if (b.solucion !== undefined) add("solucion", b.solucion || null);
      if (b.tecnico !== undefined) add("tecnico", b.tecnico || null);
      if (b.costoManoObra !== undefined) add("costo_mano_obra", new Decimal(b.costoManoObra).toFixed(2));
      if (b.costoPiezas !== undefined) add("costo_piezas", new Decimal(b.costoPiezas).toFixed(2));
      if (estadoNuevo) {
        add("estado", estadoNuevo);
        if (estadoNuevo === "LISTO") set.push("lista_en = now()");
        if (estadoNuevo === "ENTREGADO") set.push("entregada_en = now()");
        await hist(estadoNuevo, notaHist);
      }
      if (set.length) await c.query(`UPDATE servicios_tecnicos SET ${set.join(", ")} WHERE id = $1`, p);
    });
    return { ok: true };
  });
}
