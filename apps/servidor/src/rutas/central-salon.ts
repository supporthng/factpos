import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import type { PoolClient } from "pg";
import { uuidv7, tieneModulo, VARIANTES_SERVICIO } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";
import { almacenDe, crearAjuste } from "./central-inventario.js";

/**
 * Peluquerías, barberías, salones de uñas y spa (módulo SALON): servicios con duración y precio (único o por largo del cabello),
 * estilistas, sillas, citas con hora y turnos sin cita, y la comisión que gana el estilista (monto fijo o % de lo facturado).
 * El precio y la factura salen del catálogo de productos: cada variante de un servicio apunta a una presentación.
 * Una cita: PROGRAMADA → EN_ESPERA (llegó) → EN_SERVICIO (necesita estilista) → TERMINADA → COBRADA (con su factura) · CANCELADA / NO_LLEGO.
 * Pide el permiso «admin.salon» y que la empresa tenga el módulo encendido (Datos de la empresa).
 */
const uuid = z.string().uuid();
const VARIANTES = VARIANTES_SERVICIO.map((v) => v.id) as [string, ...string[]];
const nombreVariante = (id: string) => VARIANTES_SERVICIO.find((v) => v.id === id)?.nombre ?? id;
const dinero = z.coerce.number().min(0).max(99999999);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ZONA = "America/Santo_Domingo";

interface Linea {
  servicioId: string; servicio: string; variante: string; presentacionId: string; cantidad: number; duracion: number;
  comisionTipo: "MONTO" | "PORCIENTO"; comision: string; insumos?: { productoId: string; cantidad: number }[];
}
/** Estados en los que la cita ocupa al estilista (para no encimar dos clientes a la misma hora) */
const OCUPA = ["PROGRAMADA", "EN_ESPERA", "EN_SERVICIO"];

export async function rutasCentralSalon(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  // Sin el módulo encendido, nada de esto responde
  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/central/salon")) return;
    const r = (await pool.query<{ t: string; m: string[] }>("SELECT tipo_negocio AS t, modulos_extra AS m FROM empresas WHERE id = $1", [empresaDe(req)])).rows[0];
    if (!r || !tieneModulo("SALON", r.t, r.m)) throw new ErrorNegocio("El módulo de salón (citas y servicios) no está activado: se enciende en Datos de la empresa", 409);
  });

  const sucursalValida = async (req: { headers: Record<string, unknown> }, sucursalId: string | undefined) => {
    const permitidas = sucursalesDe(req);
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM sucursales WHERE empresa_id = $1 AND activo AND ($2::uuid IS NULL OR id = $2) AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
        ORDER BY tipo = 'ALMACEN', codigo LIMIT 1`, [empresaDe(req), sucursalId ?? null, permitidas]);
    if (!r.rows[0]) throw new ErrorNegocio("Sucursal no válida");
    return r.rows[0].id;
  };
  const codigo = (e: unknown) => (e as { code?: string }).code;

  // ------------------------------------------------------------------------------------------------ Servicios
  app.get("/central/salon/servicios", async (req) =>
    (await pool.query(
      `SELECT id, nombre, descripcion, duracion_min AS "duracionMin", presentaciones, comision_tipo AS "comisionTipo", comision::text, insumos, activo
         FROM salon_servicios WHERE empresa_id = $1 ORDER BY activo DESC, nombre`, [empresaDe(req)])).rows);
  const Servicio = z.object({
    nombre: z.string().trim().min(2, "Escriba el nombre del servicio").max(80), descripcion: z.string().trim().max(300).nullish(),
    duracionMin: z.coerce.number().int().min(5, "La duración mínima es de 5 minutos").max(600),
    presentaciones: z.record(z.enum(VARIANTES), uuid).default({}),
    comisionTipo: z.enum(["MONTO", "PORCIENTO"]).default("PORCIENTO"), comision: dinero.default(0), activo: z.boolean().default(true),
    /** Lo que gasta cada servicio (se descuenta del inventario al terminarlo): tinte, crema… */
    insumos: z.array(z.object({ productoId: uuid, cantidad: z.coerce.number().positive().max(9999) })).max(20).default([]),
  }).refine((s) => s.comisionTipo !== "PORCIENTO" || s.comision <= 100, { message: "El porcentaje de comisión no puede pasar de 100" });
  const validarServicio = async (empresaId: string, b: z.infer<typeof Servicio>) => {
    const ids = [...new Set(Object.values(b.presentaciones))];
    if (ids.length) {
      const n = (await pool.query("SELECT 1 FROM presentaciones pr JOIN productos po ON po.id = pr.producto_id WHERE pr.id = ANY($1::uuid[]) AND po.empresa_id = $2", [ids, empresaId])).rowCount;
      if (n !== ids.length) throw new ErrorNegocio("Una de las presentaciones elegidas no existe en el catálogo");
    }
    const ins = [...new Set(b.insumos.map((i) => i.productoId))];
    if (ins.length !== b.insumos.length) throw new ErrorNegocio("Un insumo está repetido");
    if (ins.length && (await pool.query("SELECT 1 FROM productos WHERE id = ANY($1::uuid[]) AND empresa_id = $2 AND controla_stock", [ins, empresaId])).rowCount !== ins.length)
      throw new ErrorNegocio("Los insumos deben ser productos del inventario (no servicios)");
  };
  app.post("/central/salon/servicios", async (req, rep) => {
    const b = Servicio.parse(req.body);
    await validarServicio(empresaDe(req), b);
    const id = uuidv7();
    try {
      await pool.query(
        `INSERT INTO salon_servicios (id, empresa_id, nombre, descripcion, duracion_min, presentaciones, comision_tipo, comision, insumos, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, empresaDe(req), b.nombre, b.descripcion ?? null, b.duracionMin, JSON.stringify(b.presentaciones), b.comisionTipo, new Decimal(b.comision).toFixed(2), JSON.stringify(b.insumos), b.activo]);
    } catch (e) { if (codigo(e) === "23505") throw new ErrorNegocio("Ya existe un servicio con ese nombre"); throw e; }
    rep.code(201);
    return { id };
  });
  app.put("/central/salon/servicios/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = Servicio.parse(req.body);
    await validarServicio(empresaDe(req), b);
    let r;
    try {
      r = await pool.query(
        `UPDATE salon_servicios SET nombre = $3, descripcion = $4, duracion_min = $5, presentaciones = $6, comision_tipo = $7, comision = $8, insumos = $9, activo = $10
          WHERE id = $1 AND empresa_id = $2`,
        [id, empresaDe(req), b.nombre, b.descripcion ?? null, b.duracionMin, JSON.stringify(b.presentaciones), b.comisionTipo, new Decimal(b.comision).toFixed(2), JSON.stringify(b.insumos), b.activo]);
    } catch (e) { if (codigo(e) === "23505") throw new ErrorNegocio("Ya existe un servicio con ese nombre"); throw e; }
    if (!r.rowCount) throw new ErrorNegocio("Servicio no encontrado", 404);
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------------ Estilistas y sillas
  app.get("/central/salon/estilistas", async (req) =>
    (await pool.query("SELECT id, nombre, telefono, activo FROM salon_estilistas WHERE empresa_id = $1 ORDER BY activo DESC, nombre", [empresaDe(req)])).rows);
  const Estilista = z.object({ nombre: z.string().trim().min(2, "Escriba el nombre").max(80), telefono: z.string().trim().max(30).nullish(), activo: z.boolean().default(true) });
  app.post("/central/salon/estilistas", async (req, rep) => {
    const b = Estilista.parse(req.body);
    const id = uuidv7();
    try { await pool.query("INSERT INTO salon_estilistas (id, empresa_id, nombre, telefono, activo) VALUES ($1,$2,$3,$4,$5)", [id, empresaDe(req), b.nombre, b.telefono ?? null, b.activo]); }
    catch (e) { if (codigo(e) === "23505") throw new ErrorNegocio("Ya hay alguien con ese nombre"); throw e; }
    rep.code(201);
    return { id };
  });
  app.put("/central/salon/estilistas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = Estilista.parse(req.body);
    const r = await pool.query("UPDATE salon_estilistas SET nombre = $3, telefono = $4, activo = $5 WHERE id = $1 AND empresa_id = $2", [id, empresaDe(req), b.nombre, b.telefono ?? null, b.activo]);
    if (!r.rowCount) throw new ErrorNegocio("Estilista no encontrado", 404);
    return { ok: true };
  });

  app.get("/central/salon/sillas", async (req) =>
    (await pool.query(
      `SELECT b.id, b.nombre, b.activa, b.sucursal_id AS "sucursalId", s.nombre AS sucursal FROM salon_sillas b JOIN sucursales s ON s.id = b.sucursal_id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) ORDER BY s.nombre, b.nombre`, [empresaDe(req), sucursalesDe(req)])).rows);
  app.post("/central/salon/sillas", async (req, rep) => {
    const b = z.object({ nombre: z.string().trim().min(1, "Escriba el nombre de la silla").max(40), sucursalId: uuid.optional() }).parse(req.body);
    const sucursalId = await sucursalValida(req, b.sucursalId);
    const id = uuidv7();
    try { await pool.query("INSERT INTO salon_sillas (id, sucursal_id, nombre) VALUES ($1,$2,$3)", [id, sucursalId, b.nombre]); }
    catch (e) { if (codigo(e) === "23505") throw new ErrorNegocio("Ya hay una silla con ese nombre"); throw e; }
    rep.code(201);
    return { id };
  });
  app.put("/central/salon/sillas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nombre: z.string().trim().min(1).max(40), activa: z.boolean() }).parse(req.body);
    const r = await pool.query(
      `UPDATE salon_sillas SET nombre = $3, activa = $4 WHERE id = $1 AND sucursal_id IN (SELECT id FROM sucursales WHERE empresa_id = $2)`, [id, empresaDe(req), b.nombre, b.activa]);
    if (!r.rowCount) throw new ErrorNegocio("Silla no encontrada", 404);
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------------ Citas y turnos
  const SQL_CITA = `
    SELECT c.id, c.numero::text, c.origen, c.estado, c.nombre, c.telefono, c.notas, c.lineas, c.venta_id AS "ventaId", c.cliente_id AS "clienteId",
           c.sucursal_id AS "sucursalId", c.estilista_id AS "estilistaId", e.nombre AS estilista, c.silla_id AS "sillaId", si.nombre AS silla,
           c.inicio_en AS "inicioEn", c.duracion_min AS "duracionMin", (c.inicio_en + make_interval(mins => c.duracion_min)) AS "finEn",
           c.llego_en AS "llegoEn", c.servicio_inicio_en AS "servicioInicioEn", c.servicio_fin_en AS "servicioFinEn",
           CASE WHEN cl.id IS NULL THEN NULL ELSE jsonb_build_object('id', cl.id, 'nombre', cl.nombre, 'documento', cl.documento, 'tipoDocumento', cl.tipo_documento, 'telefono', cl.telefono, 'correo', cl.correo) END AS "clienteDatos",
           (SELECT m.monto::text FROM salon_comisiones m WHERE m.cita_id = c.id) AS comision,
           (SELECT COUNT(*) FROM salon_citas h WHERE h.telefono IS NOT NULL AND h.telefono = c.telefono AND h.estado = 'COBRADA' AND h.id <> c.id)::int AS visitas
      FROM salon_citas c JOIN sucursales s ON s.id = c.sucursal_id LEFT JOIN clientes cl ON cl.id = c.cliente_id
      LEFT JOIN salon_estilistas e ON e.id = c.estilista_id LEFT JOIN salon_sillas si ON si.id = c.silla_id`;

  /**
   * vista=hoy: lo de hoy (programadas, en espera, en servicio, por cobrar) y lo que quedó abierto de días anteriores.
   * vista=dia&fecha=AAAA-MM-DD: todas las citas de ese día (la agenda). vista=historial&q=: citas cobradas de un cliente (por teléfono o nombre).
   */
  app.get("/central/salon/citas", async (req) => {
    const { vista, fecha: dia, sucursalId, q } = z.object({
      vista: z.enum(["hoy", "dia", "historial"]).default("hoy"), fecha: fecha.optional(), sucursalId: uuid.optional(), q: z.string().trim().max(60).optional(),
    }).parse(req.query);
    const base = [empresaDe(req), sucursalesDe(req), sucursalId ?? null];
    if (vista === "historial") {
      if (!q || q.length < 3) return [];
      const r = await pool.query(
        `${SQL_CITA} WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR s.id = $3)
           AND c.estado = 'COBRADA' AND (c.telefono LIKE $4 OR c.nombre ILIKE $5) ORDER BY c.inicio_en DESC LIMIT 40`, [...base, `%${q.replace(/\D/g, "") || "~"}%`, `%${q}%`]);
      return r.rows;
    }
    const hoy = vista === "hoy";
    const r = await pool.query(
      `${SQL_CITA} WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR s.id = $3)
         AND (CASE WHEN $4::boolean THEN (c.estado IN ('EN_ESPERA','EN_SERVICIO','TERMINADA')
                                 OR (c.estado = 'PROGRAMADA' AND (c.inicio_en AT TIME ZONE '${ZONA}')::date = (now() AT TIME ZONE '${ZONA}')::date))
                   ELSE (c.inicio_en AT TIME ZONE '${ZONA}')::date = COALESCE($5::date, (now() AT TIME ZONE '${ZONA}')::date) END)
        ORDER BY c.inicio_en LIMIT 400`, [...base, hoy, dia ?? null]);
    return r.rows;
  });

  /** ¿El estilista ya tiene a alguien en ese rato? (una cita con hora no se encima con otra) */
  const hayChoque = async (c: Pick<PoolClient, "query">, estilistaId: string, inicio: Date, minutos: number, excluir?: string) =>
    !!(await c.query(
      `SELECT 1 FROM salon_citas WHERE estilista_id = $1 AND estado = ANY($2::text[]) AND origen = 'CITA' AND ($5::uuid IS NULL OR id <> $5)
          AND inicio_en < ($3::timestamptz + make_interval(mins => $4)) AND (inicio_en + make_interval(mins => duracion_min)) > $3::timestamptz LIMIT 1`,
      [estilistaId, OCUPA, inicio.toISOString(), minutos, excluir ?? null])).rowCount;

  app.post("/central/salon/citas", async (req, rep) => {
    const b = z.object({
      origen: z.enum(["CITA", "TURNO"]).default("CITA"), nombre: z.string().trim().min(2, "Escriba el nombre del cliente").max(80),
      telefono: z.string().trim().max(30).nullish(), clienteId: uuid.nullish(),
      servicios: z.array(z.object({ servicioId: uuid, variante: z.enum(VARIANTES).default("UNICO"), cantidad: z.coerce.number().int().min(1).max(10).default(1) })).min(1, "Elija al menos un servicio"),
      estilistaId: uuid.nullish(), sillaId: uuid.nullish(), inicioEn: z.string().datetime({ offset: true }).optional(), sucursalId: uuid.optional(), notas: z.string().trim().max(500).nullish(),
    }).parse(req.body);
    const empresaId = empresaDe(req);
    const sucursalId = await sucursalValida(req, b.sucursalId);
    if (b.origen === "CITA" && !b.inicioEn) throw new ErrorNegocio("Elija el día y la hora de la cita");
    const inicio = b.origen === "TURNO" ? new Date() : new Date(b.inicioEn!);
    if (b.origen === "CITA" && inicio.getTime() < Date.now() - 6 * 3600e3) throw new ErrorNegocio("La hora de la cita ya pasó");
    const out = await enTransaccion(async (c) => {
      if (b.clienteId && !(await c.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2", [b.clienteId, empresaId])).rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
      const serv = (await c.query<{ id: string; nombre: string; duracion_min: number; presentaciones: Record<string, string>; comision_tipo: "MONTO" | "PORCIENTO"; comision: string; insumos: { productoId: string; cantidad: number }[] }>(
        "SELECT id, nombre, duracion_min, presentaciones, comision_tipo, comision::text, insumos FROM salon_servicios WHERE empresa_id = $1 AND activo AND id = ANY($2::uuid[])",
        [empresaId, b.servicios.map((s) => s.servicioId)])).rows;
      const lineas: Linea[] = b.servicios.map((s) => {
        const d = serv.find((x) => x.id === s.servicioId);
        if (!d) throw new ErrorNegocio("Uno de los servicios ya no está disponible");
        // Si el servicio tiene un solo precio, sirve para cualquier variante
        const variante = d.presentaciones[s.variante] ? s.variante : d.presentaciones.UNICO ? "UNICO" : s.variante;
        const presentacionId = d.presentaciones[variante];
        if (!presentacionId) throw new ErrorNegocio(`«${d.nombre}» no tiene precio para «${nombreVariante(s.variante).toLowerCase()}»: configúrelo en Servicios`);
        return { servicioId: d.id, servicio: d.nombre, variante, presentacionId, cantidad: s.cantidad, duracion: d.duracion_min, comisionTipo: d.comision_tipo, comision: d.comision, insumos: d.insumos };
      });
      const minutos = lineas.reduce((a, l) => a + l.duracion * l.cantidad, 0);
      if (b.estilistaId && !(await c.query("SELECT 1 FROM salon_estilistas WHERE id = $1 AND empresa_id = $2 AND activo", [b.estilistaId, empresaId])).rowCount) throw new ErrorNegocio("Estilista no válido");
      if (b.sillaId && !(await c.query("SELECT 1 FROM salon_sillas WHERE id = $1 AND sucursal_id = $2 AND activa", [b.sillaId, sucursalId])).rowCount) throw new ErrorNegocio("Silla no válida");
      await c.query("SELECT pg_advisory_xact_lock(hashtext('salon:' || $1))", [sucursalId]);
      if (b.origen === "CITA" && b.estilistaId && (await hayChoque(c, b.estilistaId, inicio, minutos))) throw new ErrorNegocio("Esa persona ya tiene una cita en ese horario: elija otra hora u otro estilista");
      const id = uuidv7();
      const tel = b.telefono || null;
      const n = (await c.query<{ numero: string }>(
        `INSERT INTO salon_citas (id, sucursal_id, numero, origen, estado, cliente_id, nombre, telefono, estilista_id, silla_id, inicio_en, duracion_min, lineas, notas, llego_en, creada_por)
         VALUES ($1,$2,(SELECT COALESCE(MAX(numero),0)+1 FROM salon_citas WHERE sucursal_id = $2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15) RETURNING numero::text`,
        [id, sucursalId, b.origen, b.origen === "TURNO" ? "EN_ESPERA" : "PROGRAMADA", b.clienteId ?? null, b.nombre, tel, b.estilistaId ?? null, b.sillaId ?? null,
         inicio.toISOString(), minutos, JSON.stringify(lineas), b.notas ?? null, b.origen === "TURNO" ? new Date().toISOString() : null, usuarioDe(req)])).rows[0].numero;
      return { id, numero: n };
    });
    rep.code(201);
    return out;
  });

  const cargar = async (c: PoolClient, id: string, empresaId: string) => {
    const o = (await c.query(
      `SELECT c.id, c.estado, c.origen, c.estilista_id, c.lineas, c.sucursal_id, c.nombre, c.numero::text, c.inicio_en, c.duracion_min FROM salon_citas c JOIN sucursales s ON s.id = c.sucursal_id
        WHERE c.id = $1 AND s.empresa_id = $2 FOR UPDATE OF c`, [id, empresaId])).rows[0];
    if (!o) throw new ErrorNegocio("Cita no encontrada", 404);
    return o as { id: string; estado: string; origen: string; estilista_id: string | null; lineas: Linea[]; sucursal_id: string; nombre: string; numero: string; inicio_en: Date; duracion_min: number };
  };

  /** Cambia el estilista y la silla mientras la cita siga abierta */
  app.post("/central/salon/citas/:id/asignar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ estilistaId: uuid.nullish(), sillaId: uuid.nullish() }).parse(req.body);
    await enTransaccion(async (c) => {
      const o = await cargar(c, id, empresaDe(req));
      if (!OCUPA.includes(o.estado)) throw new ErrorNegocio("La cita ya no admite cambios");
      if (b.estilistaId && !(await c.query("SELECT 1 FROM salon_estilistas WHERE id = $1 AND empresa_id = $2 AND activo", [b.estilistaId, empresaDe(req)])).rowCount) throw new ErrorNegocio("Estilista no válido");
      if (b.sillaId && !(await c.query("SELECT 1 FROM salon_sillas WHERE id = $1 AND sucursal_id = $2 AND activa", [b.sillaId, o.sucursal_id])).rowCount) throw new ErrorNegocio("Silla no válida");
      if (b.estilistaId && o.origen === "CITA" && o.estado === "PROGRAMADA" && (await hayChoque(c, b.estilistaId, new Date(o.inicio_en), o.duracion_min, id)))
        throw new ErrorNegocio("Esa persona ya tiene una cita en ese horario");
      await c.query("UPDATE salon_citas SET estilista_id = $2, silla_id = $3 WHERE id = $1", [id, b.estilistaId ?? null, b.sillaId ?? null]);
    });
    return { ok: true };
  });

  /** Cambia el día y la hora de una cita que todavía no llega */
  app.post("/central/salon/citas/:id/reprogramar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ inicioEn: z.string().datetime({ offset: true }) }).parse(req.body);
    await enTransaccion(async (c) => {
      const o = await cargar(c, id, empresaDe(req));
      if (o.estado !== "PROGRAMADA") throw new ErrorNegocio("Solo se cambia la hora de una cita que todavía no llega");
      const inicio = new Date(b.inicioEn);
      if (o.estilista_id && (await hayChoque(c, o.estilista_id, inicio, o.duracion_min, id))) throw new ErrorNegocio("Esa persona ya tiene una cita en ese horario");
      await c.query("UPDATE salon_citas SET inicio_en = $2 WHERE id = $1", [id, inicio.toISOString()]);
    });
    return { ok: true };
  });

  /** PROGRAMADA → EN_ESPERA (llegó) → EN_SERVICIO (necesita estilista) → TERMINADA (descuenta insumos) · CANCELADA · NO_LLEGO (solo si no había llegado) */
  app.post("/central/salon/citas/:id/estado", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { estado } = z.object({ estado: z.enum(["EN_ESPERA", "EN_SERVICIO", "TERMINADA", "CANCELADA", "NO_LLEGO"]) }).parse(req.body);
    return await enTransaccion(async (c) => {
      const o = await cargar(c, id, empresaDe(req));
      const validas: Record<string, string[]> = {
        EN_ESPERA: ["PROGRAMADA"], EN_SERVICIO: ["EN_ESPERA", "PROGRAMADA"], TERMINADA: ["EN_SERVICIO"],
        CANCELADA: ["PROGRAMADA", "EN_ESPERA", "EN_SERVICIO", "TERMINADA"], NO_LLEGO: ["PROGRAMADA"],
      };
      if (!validas[estado].includes(o.estado)) throw new ErrorNegocio(`No se puede pasar a ${estado} desde ${o.estado}`);
      if (estado === "EN_ESPERA") {
        await c.query("UPDATE salon_citas SET estado = 'EN_ESPERA', llego_en = now() WHERE id = $1", [id]);
      } else if (estado === "EN_SERVICIO") {
        if (!o.estilista_id) throw new ErrorNegocio("Asigne quién lo atiende antes de empezar");
        await c.query("UPDATE salon_citas SET estado = 'EN_SERVICIO', servicio_inicio_en = now(), llego_en = COALESCE(llego_en, now()) WHERE id = $1", [id]);
      } else if (estado === "TERMINADA") {
        await c.query("UPDATE salon_citas SET estado = 'TERMINADA', servicio_fin_en = now() WHERE id = $1", [id]);
        // Insumos del servicio: se descuentan del inventario; si no se puede (sin existencia…) la cita igual queda terminada y se avisa
        const gasto = new Map<string, Decimal>();
        for (const l of o.lineas) for (const i of l.insumos ?? []) gasto.set(i.productoId, (gasto.get(i.productoId) ?? new Decimal(0)).plus(new Decimal(i.cantidad).mul(l.cantidad)));
        if (gasto.size) {
          await c.query("SAVEPOINT insumos");
          try {
            const aj = await crearAjuste(c, {
              sucursalId: o.sucursal_id, almacenId: await almacenDe(c, o.sucursal_id), usuarioId: usuarioDe(req), motivo: `Salón #${o.numero} · ${o.nombre}`, origen: "MANUAL",
              lineas: [...gasto].map(([productoId, cant]) => ({ productoId, tipo: "CONSUMO_INTERNO" as const, cantidad: cant.neg(), nota: `Salón #${o.numero}` })),
            });
            await c.query("UPDATE salon_citas SET insumos_ajuste_id = $2 WHERE id = $1", [id, aj.id]);
          } catch (e) {
            await c.query("ROLLBACK TO SAVEPOINT insumos");
            await c.query("UPDATE salon_citas SET insumos_nota = $2 WHERE id = $1", [id, `No se descontaron los insumos: ${(e as Error).message}`.slice(0, 300)]);
            return { ok: true, aviso: `El servicio quedó terminado, pero no se pudieron descontar los insumos del inventario: ${(e as Error).message}` };
          }
        }
      } else {
        await c.query("UPDATE salon_citas SET estado = $2 WHERE id = $1", [id, estado]);
      }
      return { ok: true };
    });
  });

  /**
   * La cita se facturó (desde Nueva factura): queda COBRADA y enlazada a su factura. Aquí se acumula la comisión del estilista:
   * monto fijo por servicio, o el % de lo realmente facturado de ese servicio (sin ITBIS y con el descuento aplicado).
   */
  app.post("/central/salon/citas/:id/factura", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { ventaId } = z.object({ ventaId: uuid }).parse(req.body);
    await enTransaccion(async (c) => {
      const o = await cargar(c, id, empresaDe(req));
      if (o.estado !== "TERMINADA") throw new ErrorNegocio("Solo se cobra una cita cuyo servicio ya terminó");
      if (!(await c.query("SELECT 1 FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id WHERE v.id = $1 AND s.empresa_id = $2", [ventaId, empresaDe(req)])).rowCount) throw new ErrorNegocio("Factura no encontrada", 404);
      await c.query("UPDATE salon_citas SET estado = 'COBRADA', cobrada_en = now(), venta_id = $2 WHERE id = $1", [id, ventaId]);
      if (!o.estilista_id) return;
      const neto = new Map<string, Decimal>();
      for (const x of (await c.query<{ presentacion_id: string; neto: string }>(
        "SELECT presentacion_id, SUM(total - itbis)::text AS neto FROM venta_items WHERE venta_id = $1 GROUP BY presentacion_id", [ventaId])).rows) neto.set(x.presentacion_id, new Decimal(x.neto));
      const monto = o.lineas.reduce((a, l) => {
        const v = new Decimal(l.comision);
        if (l.comisionTipo === "MONTO") return a.plus(v.mul(l.cantidad));
        return a.plus((neto.get(l.presentacionId) ?? new Decimal(0)).mul(v).div(100));
      }, new Decimal(0));
      if (monto.gt(0)) await c.query("INSERT INTO salon_comisiones (id, cita_id, estilista_id, monto) VALUES ($1,$2,$3,$4) ON CONFLICT (cita_id) DO NOTHING", [uuidv7(), id, o.estilista_id, monto.toDecimalPlaces(2).toFixed(2)]);
    });
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------------ Comisiones
  app.get("/central/salon/comisiones", async (req) => {
    const { desde, hasta } = z.object({ desde: fecha.optional(), hasta: fecha.optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT e.id AS "estilistaId", e.nombre AS estilista, COUNT(m.id)::int AS servicios,
              COALESCE(SUM(m.monto),0)::text AS total, COALESCE(SUM(m.monto) FILTER (WHERE m.pagada_en IS NULL),0)::text AS pendiente
         FROM salon_estilistas e LEFT JOIN salon_comisiones m ON m.estilista_id = e.id
          AND ($2::date IS NULL OR (m.creada_en AT TIME ZONE '${ZONA}')::date >= $2) AND ($3::date IS NULL OR (m.creada_en AT TIME ZONE '${ZONA}')::date <= $3)
        WHERE e.empresa_id = $1 GROUP BY e.id, e.nombre HAVING COUNT(m.id) > 0 ORDER BY e.nombre`, [empresaDe(req), desde ?? null, hasta ?? null]);
    return r.rows;
  });
  /** Marca como pagado lo pendiente de un estilista hasta una fecha (el pago en sí se hace fuera del sistema) */
  app.post("/central/salon/comisiones/liquidar", async (req) => {
    const b = z.object({ estilistaId: uuid, hasta: fecha }).parse(req.body);
    const r = await pool.query(
      `UPDATE salon_comisiones m SET pagada_en = now(), pagada_por = $3 FROM salon_estilistas e
        WHERE m.estilista_id = e.id AND e.id = $1 AND e.empresa_id = $2 AND m.pagada_en IS NULL AND (m.creada_en AT TIME ZONE '${ZONA}')::date <= $4
        RETURNING m.monto::text`, [b.estilistaId, empresaDe(req), usuarioDe(req), b.hasta]);
    return { citas: r.rowCount, total: r.rows.reduce((a, x) => a.plus(x.monto), new Decimal(0)).toFixed(2) };
  });
}
