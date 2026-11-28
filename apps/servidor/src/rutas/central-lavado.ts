import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import type { PoolClient } from "pg";
import { uuidv7, tieneModulo, TAMANOS_VEHICULO } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";
import { almacenDe, crearAjuste } from "./central-inventario.js";

/**
 * Lavado de vehículos y auto detailing (módulo LAVADO): ficha del vehículo, servicios con precio por tamaño, lavadores, bahías,
 * orden de trabajo (EN_ESPERA → LAVANDO → LISTO → ENTREGADO) y la comisión que gana el lavador por cada lavado.
 * El precio y la factura salen del catálogo de productos: cada tamaño de un servicio apunta a una presentación.
 * Pide el permiso «admin.lavado» y que la empresa tenga el módulo encendido (Datos de la empresa).
 */
const uuid = z.string().uuid();
const TAMANOS = TAMANOS_VEHICULO.map((t) => t.id) as [string, ...string[]];
const nombreTamano = (id: string) => TAMANOS_VEHICULO.find((t) => t.id === id)?.nombre ?? id;
const dinero = z.coerce.number().min(0).max(99999999);
const placaDe = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function rutasLavado(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  // Sin el módulo encendido, nada de esto responde
  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/central/lavado")) return;
    const r = (await pool.query<{ t: string; m: string[] }>("SELECT tipo_negocio AS t, modulos_extra AS m FROM empresas WHERE id = $1", [empresaDe(req)])).rows[0];
    if (!r || !tieneModulo("LAVADO", r.t, r.m)) throw new ErrorNegocio("El módulo de lavado de vehículos no está activado: se enciende en Datos de la empresa", 409);
  });

  const sucursalValida = async (req: { headers: Record<string, unknown> }, sucursalId: string | undefined) => {
    const permitidas = sucursalesDe(req);
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM sucursales WHERE empresa_id = $1 AND activo AND ($2::uuid IS NULL OR id = $2) AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
        ORDER BY tipo = 'ALMACEN', codigo LIMIT 1`, [empresaDe(req), sucursalId ?? null, permitidas]);
    if (!r.rows[0]) throw new ErrorNegocio("Sucursal no válida");
    return r.rows[0].id;
  };

  // ------------------------------------------------------------------------------------------------ Servicios
  app.get("/central/lavado/servicios", async (req) => {
    const r = await pool.query(
      `SELECT id, nombre, descripcion, presentaciones, comision::text, insumos, activo FROM lavado_servicios WHERE empresa_id = $1 ORDER BY activo DESC, nombre`, [empresaDe(req)]);
    return r.rows;
  });
  const Servicio = z.object({
    nombre: z.string().trim().min(2, "Escriba el nombre del servicio").max(80), descripcion: z.string().trim().max(300).nullish(),
    presentaciones: z.record(z.enum(TAMANOS), uuid).default({}), comision: dinero.default(0), activo: z.boolean().default(true),
    /** Lo que gasta cada lavado de este servicio (se descuenta del inventario al quedar listo) */
    insumos: z.array(z.object({ productoId: uuid, cantidad: z.coerce.number().positive().max(9999) })).max(20).default([]),
  });
  /** Cada presentación elegida debe ser de un producto de esta empresa */
  const validarPresentaciones = async (empresaId: string, p: Record<string, string>) => {
    const ids = [...new Set(Object.values(p))];
    if (!ids.length) return;
    const n = (await pool.query("SELECT 1 FROM presentaciones pr JOIN productos po ON po.id = pr.producto_id WHERE pr.id = ANY($1::uuid[]) AND po.empresa_id = $2", [ids, empresaId])).rowCount;
    if (n !== ids.length) throw new ErrorNegocio("Una de las presentaciones elegidas no existe en el catálogo");
  };
  const validarInsumos = async (empresaId: string, ins: { productoId: string }[]) => {
    const ids = [...new Set(ins.map((i) => i.productoId))];
    if (ids.length !== ins.length) throw new ErrorNegocio("Un insumo está repetido");
    if (ids.length && (await pool.query("SELECT 1 FROM productos WHERE id = ANY($1::uuid[]) AND empresa_id = $2 AND controla_stock", [ids, empresaId])).rowCount !== ids.length)
      throw new ErrorNegocio("Los insumos deben ser productos del inventario (no servicios)");
  };
  app.post("/central/lavado/servicios", async (req, rep) => {
    const b = Servicio.parse(req.body);
    await validarPresentaciones(empresaDe(req), b.presentaciones);
    await validarInsumos(empresaDe(req), b.insumos);
    const id = uuidv7();
    try {
      await pool.query("INSERT INTO lavado_servicios (id, empresa_id, nombre, descripcion, presentaciones, comision, activo, insumos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, empresaDe(req), b.nombre, b.descripcion ?? null, JSON.stringify(b.presentaciones), new Decimal(b.comision).toFixed(2), b.activo, JSON.stringify(b.insumos)]);
    } catch (e) { if ((e as { code?: string }).code === "23505") throw new ErrorNegocio("Ya existe un servicio con ese nombre"); throw e; }
    rep.code(201);
    return { id };
  });
  app.put("/central/lavado/servicios/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = Servicio.parse(req.body);
    await validarPresentaciones(empresaDe(req), b.presentaciones);
    await validarInsumos(empresaDe(req), b.insumos);
    let r;
    try {
      r = await pool.query("UPDATE lavado_servicios SET nombre = $3, descripcion = $4, presentaciones = $5, comision = $6, activo = $7, insumos = $8 WHERE id = $1 AND empresa_id = $2",
        [id, empresaDe(req), b.nombre, b.descripcion ?? null, JSON.stringify(b.presentaciones), new Decimal(b.comision).toFixed(2), b.activo, JSON.stringify(b.insumos)]);
    } catch (e) { if ((e as { code?: string }).code === "23505") throw new ErrorNegocio("Ya existe un servicio con ese nombre"); throw e; }
    if (!r.rowCount) throw new ErrorNegocio("Servicio no encontrado", 404);
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------------ Lavadores y bahías
  app.get("/central/lavado/lavadores", async (req) =>
    (await pool.query("SELECT id, nombre, telefono, activo FROM lavado_lavadores WHERE empresa_id = $1 ORDER BY activo DESC, nombre", [empresaDe(req)])).rows);
  const Lavador = z.object({ nombre: z.string().trim().min(2, "Escriba el nombre").max(80), telefono: z.string().trim().max(30).nullish(), activo: z.boolean().default(true) });
  app.post("/central/lavado/lavadores", async (req, rep) => {
    const b = Lavador.parse(req.body);
    const id = uuidv7();
    try { await pool.query("INSERT INTO lavado_lavadores (id, empresa_id, nombre, telefono, activo) VALUES ($1,$2,$3,$4,$5)", [id, empresaDe(req), b.nombre, b.telefono ?? null, b.activo]); }
    catch (e) { if ((e as { code?: string }).code === "23505") throw new ErrorNegocio("Ya hay un lavador con ese nombre"); throw e; }
    rep.code(201);
    return { id };
  });
  app.put("/central/lavado/lavadores/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = Lavador.parse(req.body);
    const r = await pool.query("UPDATE lavado_lavadores SET nombre = $3, telefono = $4, activo = $5 WHERE id = $1 AND empresa_id = $2", [id, empresaDe(req), b.nombre, b.telefono ?? null, b.activo]);
    if (!r.rowCount) throw new ErrorNegocio("Lavador no encontrado", 404);
    return { ok: true };
  });

  app.get("/central/lavado/bahias", async (req) =>
    (await pool.query(
      `SELECT b.id, b.nombre, b.activa, b.sucursal_id AS "sucursalId", s.nombre AS sucursal FROM lavado_bahias b JOIN sucursales s ON s.id = b.sucursal_id
        WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) ORDER BY s.nombre, b.nombre`, [empresaDe(req), sucursalesDe(req)])).rows);
  app.post("/central/lavado/bahias", async (req, rep) => {
    const b = z.object({ nombre: z.string().trim().min(1, "Escriba el nombre de la bahía").max(40), sucursalId: uuid.optional() }).parse(req.body);
    const sucursalId = await sucursalValida(req, b.sucursalId);
    const id = uuidv7();
    try { await pool.query("INSERT INTO lavado_bahias (id, sucursal_id, nombre) VALUES ($1,$2,$3)", [id, sucursalId, b.nombre]); }
    catch (e) { if ((e as { code?: string }).code === "23505") throw new ErrorNegocio("Ya hay una bahía con ese nombre"); throw e; }
    rep.code(201);
    return { id };
  });
  app.put("/central/lavado/bahias/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nombre: z.string().trim().min(1).max(40), activa: z.boolean() }).parse(req.body);
    const r = await pool.query(
      `UPDATE lavado_bahias SET nombre = $3, activa = $4 WHERE id = $1 AND sucursal_id IN (SELECT id FROM sucursales WHERE empresa_id = $2)`, [id, empresaDe(req), b.nombre, b.activa]);
    if (!r.rowCount) throw new ErrorNegocio("Bahía no encontrada", 404);
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------------ Vehículos
  app.get("/central/lavado/vehiculos", async (req) => {
    const { q } = z.object({ q: z.string().trim().max(60).optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT v.id, v.placa, v.marca, v.modelo, v.color, v.tamano, v.notas, v.cliente_id AS "clienteId", c.nombre AS cliente, c.telefono,
              (SELECT COUNT(*) FROM lavado_ordenes o WHERE o.vehiculo_id = v.id AND o.estado = 'ENTREGADO')::int AS lavados
         FROM lavado_vehiculos v LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE v.empresa_id = $1 AND ($2::text IS NULL OR v.placa LIKE $3 OR v.marca ILIKE $4 OR v.modelo ILIKE $4 OR c.nombre ILIKE $4)
        ORDER BY v.placa LIMIT 30`, [empresaDe(req), q || null, `%${placaDe(q ?? "")}%`, `%${q ?? ""}%`]);
    return r.rows;
  });
  /** Guarda el vehículo por su placa: si ya existe lo actualiza (el mismo vehículo vuelve cada semana) */
  app.post("/central/lavado/vehiculos", async (req, rep) => {
    const b = z.object({
      placa: z.string().trim().min(3, "Escriba la placa").max(14), marca: z.string().trim().max(40).nullish(), modelo: z.string().trim().max(40).nullish(),
      color: z.string().trim().max(30).nullish(), tamano: z.enum(TAMANOS).default("CARRO"), notas: z.string().trim().max(300).nullish(), clienteId: uuid.nullish(),
    }).parse(req.body);
    const placa = placaDe(b.placa);
    if (placa.length < 3) throw new ErrorNegocio("La placa no es válida");
    if (b.clienteId && !(await pool.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2", [b.clienteId, empresaDe(req)])).rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
    const r = await pool.query<{ id: string; nuevo: boolean }>(
      `INSERT INTO lavado_vehiculos (id, empresa_id, cliente_id, placa, marca, modelo, color, tamano, notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (empresa_id, placa) DO UPDATE SET cliente_id = COALESCE(EXCLUDED.cliente_id, lavado_vehiculos.cliente_id), marca = COALESCE(EXCLUDED.marca, lavado_vehiculos.marca),
         modelo = COALESCE(EXCLUDED.modelo, lavado_vehiculos.modelo), color = COALESCE(EXCLUDED.color, lavado_vehiculos.color), tamano = EXCLUDED.tamano,
         notas = COALESCE(EXCLUDED.notas, lavado_vehiculos.notas)
       RETURNING id, (xmax = 0) AS nuevo`, [uuidv7(), empresaDe(req), b.clienteId ?? null, placa, b.marca ?? null, b.modelo ?? null, b.color ?? null, b.tamano, b.notas ?? null]);
    rep.code(r.rows[0].nuevo ? 201 : 200);
    return { id: r.rows[0].id, placa };
  });

  // ------------------------------------------------------------------------------------------------ Órdenes
  const SQL_ORDEN = `
    SELECT o.id, o.numero::text, o.estado, o.placa, o.vehiculo, o.tamano, o.telefono, o.notas, o.lineas, o.venta_id AS "ventaId",
           o.cliente_id AS "clienteId", c.nombre AS cliente, o.sucursal_id AS "sucursalId",
           CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'nombre', c.nombre, 'documento', c.documento, 'tipoDocumento', c.tipo_documento, 'telefono', c.telefono, 'correo', c.correo) END AS "clienteDatos",
           o.bahia_id AS "bahiaId", b.nombre AS bahia, o.lavador_id AS "lavadorId", l.nombre AS lavador,
           o.entrada_en AS "entradaEn", o.inicio_en AS "inicioEn", o.listo_en AS "listoEn", o.entregado_en AS "entregadoEn",
           (SELECT m.monto::text FROM lavado_comisiones m WHERE m.orden_id = o.id) AS comision
      FROM lavado_ordenes o JOIN sucursales s ON s.id = o.sucursal_id LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN lavado_bahias b ON b.id = o.bahia_id LEFT JOIN lavado_lavadores l ON l.id = o.lavador_id`;
  app.get("/central/lavado/ordenes", async (req) => {
    const { estado, sucursalId } = z.object({ estado: z.enum(["ACTIVAS", "HOY", "TODAS"]).default("ACTIVAS"), sucursalId: uuid.optional() }).parse(req.query);
    const r = await pool.query(
      `${SQL_ORDEN} WHERE s.empresa_id = $1 AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR s.id = $3)
         AND (CASE $4 WHEN 'ACTIVAS' THEN o.estado IN ('EN_ESPERA','LAVANDO','LISTO')
                      WHEN 'HOY' THEN o.entrada_en >= (now() AT TIME ZONE 'America/Santo_Domingo')::date::timestamp AT TIME ZONE 'America/Santo_Domingo' ELSE TRUE END)
        ORDER BY o.entrada_en DESC LIMIT 300`, [empresaDe(req), sucursalesDe(req), sucursalId ?? null, estado]);
    return r.rows;
  });
  app.post("/central/lavado/ordenes", async (req, rep) => {
    const b = z.object({
      /** Sin vehiculoId se abre una orden rápida sin placa (pinchazo de una bicicleta o un motor): hace falta el tipo de vehículo */
      vehiculoId: uuid.optional(), tamano: z.enum(TAMANOS).optional(), descripcion: z.string().trim().max(80).nullish(), servicios: z.array(z.object({ servicioId: uuid, cantidad: z.coerce.number().int().min(1).max(20).default(1) })).min(1, "Elija al menos un servicio"),
      sucursalId: uuid.optional(), bahiaId: uuid.nullish(), lavadorId: uuid.nullish(), telefono: z.string().trim().max(30).nullish(), notas: z.string().trim().max(500).nullish(),
    }).parse(req.body);
    const empresaId = empresaDe(req);
    const sucursalId = await sucursalValida(req, b.sucursalId);
    if (!b.vehiculoId && !b.tamano) throw new ErrorNegocio("Elija el vehículo o el tipo de vehículo");
    const out = await enTransaccion(async (c) => {
      type Veh = { placa: string; marca: string | null; modelo: string | null; color: string | null; tamano: string; cliente_id: string | null; telefono: string | null };
      const v: Veh | undefined = b.vehiculoId
        ? (await c.query<Veh>(
          `SELECT v.placa, v.marca, v.modelo, v.color, v.tamano, v.cliente_id, cl.telefono FROM lavado_vehiculos v LEFT JOIN clientes cl ON cl.id = v.cliente_id
            WHERE v.id = $1 AND v.empresa_id = $2`, [b.vehiculoId, empresaId])).rows[0]
        : { placa: "S/P", marca: b.descripcion ?? nombreTamano(b.tamano!), modelo: null, color: null, tamano: b.tamano!, cliente_id: null, telefono: null };
      if (!v) throw new ErrorNegocio("Vehículo no encontrado", 404);
      if (b.vehiculoId && (await c.query("SELECT 1 FROM lavado_ordenes WHERE vehiculo_id = $1 AND estado IN ('EN_ESPERA','LAVANDO','LISTO')", [b.vehiculoId])).rowCount)
        throw new ErrorNegocio(`El vehículo ${v.placa} ya tiene una orden abierta: termínela o cancélela primero`);
      const serv = (await c.query<{ id: string; nombre: string; presentaciones: Record<string, string>; comision: string; insumos: { productoId: string; cantidad: number }[] }>(
        "SELECT id, nombre, presentaciones, comision::text, insumos FROM lavado_servicios WHERE empresa_id = $1 AND activo AND id = ANY($2::uuid[])", [empresaId, b.servicios.map((s) => s.servicioId)])).rows;
      const lineas = b.servicios.map((s) => {
        const d = serv.find((x) => x.id === s.servicioId);
        if (!d) throw new ErrorNegocio("Uno de los servicios ya no está disponible");
        const presentacionId = d.presentaciones[v.tamano];
        if (!presentacionId) throw new ErrorNegocio(`«${d.nombre}» no tiene precio para ${nombreTamano(v.tamano).toLowerCase()}: configúrelo en Servicios`);
        return { servicioId: d.id, servicio: d.nombre, presentacionId, cantidad: s.cantidad, comision: d.comision, insumos: d.insumos };
      });
      if (b.bahiaId && !(await c.query("SELECT 1 FROM lavado_bahias WHERE id = $1 AND sucursal_id = $2 AND activa", [b.bahiaId, sucursalId])).rowCount) throw new ErrorNegocio("Bahía no válida");
      if (b.lavadorId && !(await c.query("SELECT 1 FROM lavado_lavadores WHERE id = $1 AND empresa_id = $2 AND activo", [b.lavadorId, empresaId])).rowCount) throw new ErrorNegocio("Lavador no válido");
      await c.query("SELECT pg_advisory_xact_lock(hashtext('lavado:' || $1))", [sucursalId]);
      const id = uuidv7();
      const n = (await c.query<{ numero: string }>(
        `INSERT INTO lavado_ordenes (id, sucursal_id, numero, vehiculo_id, cliente_id, placa, vehiculo, tamano, telefono, bahia_id, lavador_id, lineas, notas, creada_por)
         VALUES ($1,$2,(SELECT COALESCE(MAX(numero),0)+1 FROM lavado_ordenes WHERE sucursal_id = $2),$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING numero::text`,
        [id, sucursalId, b.vehiculoId ?? null, v.cliente_id, v.placa, [v.marca, v.modelo].filter(Boolean).join(" ") + (v.color ? ` · ${v.color}` : ""), v.tamano, b.telefono ?? v.telefono ?? null,
         b.bahiaId ?? null, b.lavadorId ?? null, JSON.stringify(lineas), b.notas ?? null, usuarioDe(req)])).rows[0].numero;
      return { id, numero: n };
    });
    rep.code(201);
    return out;
  });

  const cargar = async (c: PoolClient, id: string, empresaId: string) => {
    const o = (await c.query(
      `SELECT o.id, o.estado, o.lavador_id, o.lineas, o.sucursal_id, o.placa, o.numero::text FROM lavado_ordenes o JOIN sucursales s ON s.id = o.sucursal_id WHERE o.id = $1 AND s.empresa_id = $2 FOR UPDATE OF o`, [id, empresaId])).rows[0];
    if (!o) throw new ErrorNegocio("Orden no encontrada", 404);
    return o as { id: string; estado: string; lavador_id: string | null; lineas: { cantidad: number; comision: string; insumos?: { productoId: string; cantidad: number }[] }[]; sucursal_id: string; placa: string; numero: string };
  };
  /** Asigna o cambia el lavador y la bahía mientras la orden siga abierta */
  app.post("/central/lavado/ordenes/:id/asignar", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ lavadorId: uuid.nullish(), bahiaId: uuid.nullish() }).parse(req.body);
    await enTransaccion(async (c) => {
      const o = await cargar(c, id, empresaDe(req));
      if (!["EN_ESPERA", "LAVANDO"].includes(o.estado)) throw new ErrorNegocio("La orden ya no admite cambios");
      if (b.lavadorId && !(await c.query("SELECT 1 FROM lavado_lavadores WHERE id = $1 AND empresa_id = $2 AND activo", [b.lavadorId, empresaDe(req)])).rowCount) throw new ErrorNegocio("Lavador no válido");
      if (b.bahiaId && !(await c.query("SELECT 1 FROM lavado_bahias WHERE id = $1 AND sucursal_id = $2 AND activa", [b.bahiaId, o.sucursal_id])).rowCount) throw new ErrorNegocio("Bahía no válida");
      await c.query("UPDATE lavado_ordenes SET lavador_id = $2, bahia_id = $3 WHERE id = $1", [id, b.lavadorId ?? null, b.bahiaId ?? null]);
    });
    return { ok: true };
  });
  /** EN_ESPERA → LAVANDO (necesita lavador) → LISTO (acumula la comisión del lavador) · CANCELADO desde cualquier estado abierto */
  app.post("/central/lavado/ordenes/:id/estado", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { estado } = z.object({ estado: z.enum(["LAVANDO", "LISTO", "CANCELADO"]) }).parse(req.body);
    return await enTransaccion(async (c) => {
      const o = await cargar(c, id, empresaDe(req));
      const validas: Record<string, string[]> = { LAVANDO: ["EN_ESPERA"], LISTO: ["LAVANDO"], CANCELADO: ["EN_ESPERA", "LAVANDO", "LISTO"] };
      if (!validas[estado].includes(o.estado)) throw new ErrorNegocio(`No se puede pasar a ${estado} desde ${o.estado}`);
      if (estado === "LAVANDO") {
        if (!o.lavador_id) throw new ErrorNegocio("Asigne un lavador antes de empezar");
        await c.query("UPDATE lavado_ordenes SET estado = 'LAVANDO', inicio_en = now() WHERE id = $1", [id]);
      } else if (estado === "LISTO") {
        await c.query("UPDATE lavado_ordenes SET estado = 'LISTO', listo_en = now() WHERE id = $1", [id]);
        const monto = o.lineas.reduce((a, l) => a.plus(new Decimal(l.comision).mul(l.cantidad)), new Decimal(0));
        if (o.lavador_id && monto.gt(0)) await c.query("INSERT INTO lavado_comisiones (id, orden_id, lavador_id, monto) VALUES ($1,$2,$3,$4) ON CONFLICT (orden_id) DO NOTHING", [uuidv7(), id, o.lavador_id, monto.toFixed(2)]);
        // Insumos del lavado: se descuentan del inventario; si no se puede (sin existencia…) el lavado igual queda listo y se avisa
        const gasto = new Map<string, Decimal>();
        for (const l of o.lineas) for (const i of l.insumos ?? []) gasto.set(i.productoId, (gasto.get(i.productoId) ?? new Decimal(0)).plus(new Decimal(i.cantidad).mul(l.cantidad)));
        if (gasto.size) {
          await c.query("SAVEPOINT insumos");
          try {
            const aj = await crearAjuste(c, {
              sucursalId: o.sucursal_id, almacenId: await almacenDe(c, o.sucursal_id), usuarioId: usuarioDe(req), motivo: `Lavado #${o.numero} · ${o.placa}`, origen: "MANUAL",
              lineas: [...gasto].map(([productoId, cant]) => ({ productoId, tipo: "CONSUMO_INTERNO" as const, cantidad: cant.neg(), nota: `Lavado #${o.numero}` })),
            });
            await c.query("UPDATE lavado_ordenes SET insumos_ajuste_id = $2 WHERE id = $1", [id, aj.id]);
          } catch (e) {
            await c.query("ROLLBACK TO SAVEPOINT insumos");
            await c.query("UPDATE lavado_ordenes SET insumos_nota = $2 WHERE id = $1", [id, `No se descontaron los insumos: ${(e as Error).message}`.slice(0, 300)]);
            return { ok: true, aviso: `El lavado quedó listo, pero no se pudieron descontar los insumos del inventario: ${(e as Error).message}` };
          }
        }
      } else {
        // Si ya estaba LISTO y la comisión no se ha pagado, se retira
        await c.query("DELETE FROM lavado_comisiones WHERE orden_id = $1 AND pagada_en IS NULL", [id]);
        await c.query("UPDATE lavado_ordenes SET estado = 'CANCELADO' WHERE id = $1", [id]);
      }
      return { ok: true };
    });
  });
  /** La orden se facturó (desde Nueva factura): queda ENTREGADA y enlazada a su factura */
  app.post("/central/lavado/ordenes/:id/factura", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { ventaId } = z.object({ ventaId: uuid }).parse(req.body);
    await enTransaccion(async (c) => {
      const o = await cargar(c, id, empresaDe(req));
      if (o.estado !== "LISTO") throw new ErrorNegocio("Solo se cobra una orden que ya está lista");
      if (!(await c.query("SELECT 1 FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id WHERE v.id = $1 AND s.empresa_id = $2", [ventaId, empresaDe(req)])).rowCount) throw new ErrorNegocio("Factura no encontrada", 404);
      await c.query("UPDATE lavado_ordenes SET estado = 'ENTREGADO', entregado_en = now(), venta_id = $2 WHERE id = $1", [id, ventaId]);
    });
    return { ok: true };
  });

  // ------------------------------------------------------------------------------------------------ Comisiones por lavado
  app.get("/central/lavado/comisiones", async (req) => {
    const { desde, hasta } = z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT l.id AS "lavadorId", l.nombre AS lavador, COUNT(m.id)::int AS lavados,
              COALESCE(SUM(m.monto),0)::text AS total, COALESCE(SUM(m.monto) FILTER (WHERE m.pagada_en IS NULL),0)::text AS pendiente
         FROM lavado_lavadores l LEFT JOIN lavado_comisiones m ON m.lavador_id = l.id
          AND ($2::date IS NULL OR (m.creada_en AT TIME ZONE 'America/Santo_Domingo')::date >= $2) AND ($3::date IS NULL OR (m.creada_en AT TIME ZONE 'America/Santo_Domingo')::date <= $3)
        WHERE l.empresa_id = $1 GROUP BY l.id, l.nombre HAVING COUNT(m.id) > 0 ORDER BY l.nombre`, [empresaDe(req), desde ?? null, hasta ?? null]);
    return r.rows;
  });
  /** Marca como pagado lo pendiente de un lavador hasta una fecha (el pago en sí se hace fuera del sistema) */
  app.post("/central/lavado/comisiones/liquidar", async (req) => {
    const b = z.object({ lavadorId: uuid, hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
    const r = await pool.query(
      `UPDATE lavado_comisiones m SET pagada_en = now(), pagada_por = $3 FROM lavado_lavadores l
        WHERE m.lavador_id = l.id AND l.id = $1 AND l.empresa_id = $2 AND m.pagada_en IS NULL AND (m.creada_en AT TIME ZONE 'America/Santo_Domingo')::date <= $4
        RETURNING m.monto::text`, [b.lavadorId, empresaDe(req), usuarioDe(req), b.hasta]);
    return { ordenes: r.rowCount, total: r.rows.reduce((a, x) => a.plus(x.monto), new Decimal(0)).toFixed(2) };
  });
}
