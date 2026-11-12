import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";

/**
 * Salón de restaurante: mapa de mesas y modificadores de los platos.
 * Solo para empresas que no son «TIENDA». Configurarlos pide un supervisor (igual que las estaciones de la barra).
 */
const uuid = z.string().uuid();

export async function rutasSalon(app: FastifyInstance) {
  const preparar = async (req: { params: unknown }) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const e = (await pool.query<{ t: string }>("SELECT tipo_negocio AS t FROM empresas WHERE id = $1", [ctx.empresaId])).rows[0];
    if (!e || e.t === "TIENDA") throw new ErrorNegocio("El salón no está activado para esta empresa", 409);
    return ctx;
  };
  const exigirSupervisor = (req: unknown, que: string) => {
    const p = ((req as { sesionCaja?: { p?: string[] } }).sesionCaja?.p) ?? [];
    if (!(p.includes("*") || p.includes("venta.anular"))) throw new ErrorNegocio(`${que} requiere un supervisor`, 403);
  };

  /** Mesas de la sucursal, cada una con su cuenta abierta (si la hay): mesero, desde cuándo y cuánto lleva. */
  app.get("/cajas/:cajaId/mesas", async (req) => {
    const ctx = await preparar(req);
    return (await pool.query(
      `SELECT m.id, m.nombre, m.zona, m.capacidad, m.pos_x::float8 AS "posX", m.pos_y::float8 AS "posY", m.forma,
              c.id AS "cuentaId", c.abierta_en AS "abiertaEn", u.nombre AS mesero,
              floor(EXTRACT(EPOCH FROM (now() - c.abierta_en)) / 60)::int AS minutos,
              c.productos, c.total, c.esperando,
              r.id AS "reservaId", r.nombre AS "reservaNombre", r.para AS "reservaPara", r.personas AS "reservaPersonas"
         FROM mesas m
         -- una reserva pendiente cercana (de 45 minutos atrás a 2 horas adelante) marca la mesa como reservada
         LEFT JOIN LATERAL (
           SELECT x.id, x.nombre, x.para, x.personas FROM reservas x
            WHERE x.mesa_id = m.id AND x.estado = 'PENDIENTE' AND x.para BETWEEN now() - interval '45 minutes' AND now() + interval '2 hours' ORDER BY x.para LIMIT 1
         ) r ON TRUE
         LEFT JOIN LATERAL (
           SELECT c.id, c.abierta_en, c.abierta_por,
                  (SELECT count(*)::int FROM cuenta_lineas l WHERE l.cuenta_id = c.id AND NOT l.anulada AND l.venta_id IS NULL) AS productos,
                  -- pedidos que todavía no salieron (esperan su tiempo o falta enviarlos)
                  (SELECT count(*)::int FROM cuenta_lineas l WHERE l.cuenta_id = c.id AND NOT l.anulada AND l.venta_id IS NULL AND l.enviada_en IS NULL) AS esperando,
                  (SELECT COALESCE(sum(l.cantidad * l.precio_unitario * CASE WHEN p.precio_incluye_impuesto THEN 1 ELSE 1 + l.tasa_itbis END), 0)::numeric(14,2)::text
                     FROM cuenta_lineas l JOIN presentaciones pr ON pr.id = l.presentacion_id JOIN productos p ON p.id = pr.producto_id
                    WHERE l.cuenta_id = c.id AND NOT l.anulada AND l.venta_id IS NULL) AS total
             FROM cuentas c WHERE c.sucursal_id = m.sucursal_id AND c.estado = 'ABIERTA' AND c.mesa = m.nombre ORDER BY c.abierta_en LIMIT 1
         ) c ON TRUE
         LEFT JOIN usuarios u ON u.id = c.abierta_por
        WHERE m.sucursal_id = $1 AND m.activa ORDER BY m.zona, m.orden, m.nombre`, [ctx.sucursalId])).rows;
  });

  /** Guarda las mesas (solo supervisor). Las que ya no están se desactivan: conservan su historial. */
  app.put("/cajas/:cajaId/mesas", async (req) => {
    const ctx = await preparar(req);
    exigirSupervisor(req, "Configurar las mesas");
    const b = z.object({
      mesas: z.array(z.object({ id: uuid.optional(), nombre: z.string().trim().min(1).max(30), zona: z.string().trim().max(30).default(""), capacidad: z.number().int().min(1).max(60).default(4),
        posX: z.number().min(0).max(100).nullable().default(null), posY: z.number().min(0).max(100).nullable().default(null), forma: z.enum(["CUADRADA", "REDONDA", "LARGA"]).default("CUADRADA"),
      })).max(300),
    }).parse(req.body);
    const nombres = b.mesas.map((m) => m.nombre.toLowerCase());
    if (new Set(nombres).size !== nombres.length) throw new ErrorNegocio("Hay dos mesas con el mismo nombre", 400);
    await enTransaccion(async (c) => {
      const ids: string[] = [];
      // Primero se apartan los nombres para poder intercambiarlos sin chocar con la restricción de nombre único
      await c.query("UPDATE mesas SET nombre = nombre || '~' || id::text WHERE sucursal_id = $1", [ctx.sucursalId]);
      for (const [i, m] of b.mesas.entries()) {
        const id = m.id ?? uuidv7();
        ids.push(id);
        await c.query(
          `INSERT INTO mesas (id, sucursal_id, nombre, zona, capacidad, orden, activa, pos_x, pos_y, forma) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET nombre = $3, zona = $4, capacidad = $5, orden = $6, activa = TRUE, pos_x = $7, pos_y = $8, forma = $9 WHERE mesas.sucursal_id = $2`,
          [id, ctx.sucursalId, m.nombre, m.zona, m.capacidad, i, m.posX, m.posY, m.forma]);
      }
      await c.query("UPDATE mesas SET activa = FALSE WHERE sucursal_id = $1 AND NOT (id = ANY($2::uuid[]))", [ctx.sucursalId, ids]);
    }).catch((e: { code?: string }) => {
      if (e.code === "23505") throw new ErrorNegocio("Hay dos mesas con el mismo nombre", 400);
      throw e;
    });
    return { ok: true };
  });

  /**
   * Reporte del salón de una noche (jornada de 6:00 a. m. a 6:00 a. m.): ventas por mesero, por hora y por mesa. Solo supervisor.
   * El mesero es quien abrió la cuenta. Las ventas anuladas no cuentan.
   */
  app.get("/cajas/:cajaId/salon/reporte", async (req) => {
    const ctx = await preparar(req);
    exigirSupervisor(req, "Ver el reporte del salón");
    const { fecha } = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    const dia = fecha ?? (await pool.query<{ d: string }>("SELECT ((now() AT TIME ZONE 'America/Santo_Domingo') - interval '6 hours')::date::text AS d")).rows[0]!.d;
    const jornada = (col: string) => `((${col} AT TIME ZONE 'America/Santo_Domingo') - interval '6 hours')::date`;
    // Ventas que cuentan: no son anulaciones ni notas de crédito y no fueron anuladas después
    const valida = `v.tipo_documento NOT IN ('E34','ANU') AND NOT EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = v.id AND n.tipo_documento IN ('E34','ANU'))`;
    const cuentas = `
      SELECT c.id, c.abierta_por, c.mesa, c.numero,
             floor(EXTRACT(EPOCH FROM (c.cerrada_en - c.abierta_en)) / 60)::int AS minutos,
             COALESCE(SUM(v.total), 0) AS consumo, COALESCE(SUM(v.propina_legal), 0) AS propina
        FROM cuentas c
        LEFT JOIN cuenta_ventas cv ON cv.cuenta_id = c.id
        LEFT JOIN ventas v ON v.id = cv.venta_id AND ${valida}
       WHERE c.sucursal_id = $1 AND c.estado = 'COBRADA' AND ${jornada("c.cerrada_en")} = $2::date
       GROUP BY c.id`;
    const porMesero = (await pool.query(
      `WITH k AS (${cuentas})
       SELECT COALESCE(u.nombre, 'Sin asignar') AS mesero, count(*)::int AS cuentas, sum(k.consumo)::numeric(14,2)::text AS consumo,
              sum(k.propina)::numeric(14,2)::text AS propina, round(avg(k.minutos))::int AS "minutosPromedio",
              round(sum(k.consumo) / NULLIF(count(*), 0), 2)::text AS "cuentaPromedio"
         FROM k LEFT JOIN usuarios u ON u.id = k.abierta_por GROUP BY u.nombre ORDER BY sum(k.consumo) DESC`, [ctx.sucursalId, dia])).rows;
    const porMesa = (await pool.query(
      `WITH k AS (${cuentas})
       SELECT COALESCE(k.mesa, 'Sin mesa') AS mesa, count(*)::int AS cuentas, sum(k.consumo)::numeric(14,2)::text AS consumo, round(avg(k.minutos))::int AS "minutosPromedio"
         FROM k GROUP BY k.mesa ORDER BY count(*) DESC, sum(k.consumo) DESC`, [ctx.sucursalId, dia])).rows;
    // Por hora: todo lo vendido en la sucursal (cuentas y ventas directas), en hora de RD, empezando a las 6 a. m.
    const porHora = (await pool.query(
      `SELECT EXTRACT(HOUR FROM v.creado_en AT TIME ZONE 'America/Santo_Domingo')::int AS hora, count(*)::int AS facturas, sum(v.total)::numeric(14,2)::text AS ventas
         FROM ventas v WHERE v.sucursal_id = $1 AND ${jornada("v.creado_en")} = $2::date AND ${valida}
        GROUP BY 1 ORDER BY ((EXTRACT(HOUR FROM v.creado_en AT TIME ZONE 'America/Santo_Domingo')::int) + 18) % 24`, [ctx.sucursalId, dia])).rows;
    // Platos más vendidos y su ganancia (precio sin impuestos menos el costo de esa venta). Los extras con cargo cuentan como un producto más.
    const platos = (await pool.query(
      `SELECT vi.descripcion AS plato, sum(vi.cantidad)::numeric(14,1)::text AS cantidad,
              sum(vi.total - vi.itbis - vi.isc)::numeric(14,2)::text AS ventas,
              sum(vi.cantidad * vi.costo_unitario)::numeric(14,2)::text AS costo,
              sum((vi.total - vi.itbis - vi.isc) - vi.cantidad * vi.costo_unitario)::numeric(14,2)::text AS ganancia
         FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
        WHERE v.sucursal_id = $1 AND ${jornada("v.creado_en")} = $2::date AND ${valida}
        GROUP BY vi.descripcion ORDER BY sum(vi.cantidad) DESC, sum(vi.total) DESC LIMIT 20`, [ctx.sucursalId, dia])).rows;
    const total = porHora.reduce((a: number, h: { ventas: string }) => a + Number(h.ventas), 0);
    const facturas = porHora.reduce((a: number, h: { facturas: number }) => a + h.facturas, 0);
    // Reparto de la propina legal: el pozo de meseros se divide según lo que cada uno cobró; los demás pozos se dividen entre su personal
    const r = (await pool.query<{ m: string; c: string; b: string; o: string }>(
      "SELECT pct_meseros::text AS m, pct_cocina::text AS c, pct_barra::text AS b, pct_otros::text AS o FROM propina_reparto WHERE sucursal_id = $1", [ctx.sucursalId])).rows[0]
      ?? { m: "100", c: "0", b: "0", o: "0" };
    const propinaTotal = porMesero.reduce((a: number, m: { propina: string }) => a + Number(m.propina), 0);
    const pozo = (pct: string) => Math.round(propinaTotal * Number(pct)) / 100;
    const pozoMeseros = pozo(r.m);
    const reparto = {
      pct: { meseros: Number(r.m), cocina: Number(r.c), barra: Number(r.b), otros: Number(r.o) },
      propinaTotal: propinaTotal.toFixed(2),
      meseros: porMesero.map((m: { mesero: string; propina: string }) => ({
        mesero: m.mesero, monto: (propinaTotal > 0 ? (pozoMeseros * Number(m.propina)) / propinaTotal : 0).toFixed(2),
      })),
      cocina: pozo(r.c).toFixed(2), barra: pozo(r.b).toFixed(2), otros: pozo(r.o).toFixed(2),
    };
    return { fecha: dia, total: total.toFixed(2), facturas, porMesero, porMesa, porHora, reparto, platos };
  });

  const usuarioDe = (req: unknown) => ((req as { sesionCaja?: { u?: string } }).sesionCaja?.u) ?? null;

  /** Reservas pendientes (de hace 3 horas en adelante, hasta 30 días) con su mesa. */
  app.get("/cajas/:cajaId/reservas", async (req) => {
    const ctx = await preparar(req);
    return (await pool.query(
      `SELECT r.id, r.nombre, r.telefono, r.personas, r.para, r.nota, r.mesa_id AS "mesaId", m.nombre AS mesa
         FROM reservas r LEFT JOIN mesas m ON m.id = r.mesa_id
        WHERE r.sucursal_id = $1 AND r.estado = 'PENDIENTE' AND r.para >= now() - interval '3 hours' AND r.para < now() + interval '30 days'
        ORDER BY r.para`, [ctx.sucursalId])).rows;
  });

  app.post("/cajas/:cajaId/reservas", async (req, rep) => {
    const ctx = await preparar(req);
    const b = z.object({
      nombre: z.string().trim().min(1).max(60), telefono: z.string().trim().max(30).optional(), personas: z.number().int().min(1).max(200),
      para: z.string().datetime({ offset: true }), mesaId: uuid.nullable().optional(), nota: z.string().trim().max(200).optional(),
    }).parse(req.body);
    if (new Date(b.para).getTime() < Date.now() - 60 * 60 * 1000) throw new ErrorNegocio("Esa hora ya pasó", 400);
    if (b.mesaId && !(await pool.query("SELECT 1 FROM mesas WHERE id = $1 AND sucursal_id = $2 AND activa", [b.mesaId, ctx.sucursalId])).rowCount) throw new ErrorNegocio("Esa mesa no existe", 400);
    if (b.mesaId) {
      // No se reserva una mesa que ya tiene otra reserva a menos de 2 horas
      const choque = (await pool.query<{ nombre: string; para: string }>(
        `SELECT nombre, para FROM reservas WHERE mesa_id = $1 AND estado = 'PENDIENTE' AND para BETWEEN $2::timestamptz - interval '2 hours' AND $2::timestamptz + interval '2 hours' LIMIT 1`, [b.mesaId, b.para])).rows[0];
      if (choque) throw new ErrorNegocio(`Esa mesa ya está reservada para ${choque.nombre} a esa hora`, 409);
    }
    const id = uuidv7();
    await pool.query(
      `INSERT INTO reservas (id, sucursal_id, mesa_id, nombre, telefono, personas, para, nota, creada_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, ctx.sucursalId, b.mesaId ?? null, b.nombre, b.telefono || null, b.personas, b.para, b.nota || null, usuarioDe(req)]);
    rep.code(201);
    return { id };
  });

  /** Cancelar la reserva, marcarla «no llegó» o cambiarle la mesa. */
  app.patch("/cajas/:cajaId/reservas/:id", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ estado: z.enum(["CANCELADA", "NO_LLEGO"]).optional(), mesaId: uuid.nullable().optional() }).parse(req.body);
    const r = await pool.query(
      `UPDATE reservas SET estado = COALESCE($3, estado), mesa_id = CASE WHEN $4::boolean THEN $5::uuid ELSE mesa_id END
        WHERE id = $1 AND sucursal_id = $2 AND estado = 'PENDIENTE'`, [id, ctx.sucursalId, b.estado ?? null, "mesaId" in b, b.mesaId ?? null]);
    if (!r.rowCount) throw new ErrorNegocio("La reserva ya no está pendiente", 409);
    return { ok: true };
  });

  /** Llegaron: abre la cuenta de la mesa y la reserva queda «sentada». */
  app.post("/cajas/:cajaId/reservas/:id/sentar", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ mesaId: uuid.nullable().optional() }).parse(req.body ?? {});
    const cuentaId = await enTransaccion(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('cuentas:' || $1))", [ctx.sucursalId]);
      const r = (await c.query<{ nombre: string; personas: number; mesaId: string | null; telefono: string | null; nota: string | null }>(
        `SELECT nombre, personas, mesa_id AS "mesaId", telefono, nota FROM reservas WHERE id = $1 AND sucursal_id = $2 AND estado = 'PENDIENTE' FOR UPDATE`, [id, ctx.sucursalId])).rows[0];
      if (!r) throw new ErrorNegocio("La reserva ya no está pendiente", 409);
      const mesaId = b.mesaId ?? r.mesaId;
      if (!mesaId) throw new ErrorNegocio("Elija la mesa donde se sientan", 400);
      const mesa = (await c.query<{ nombre: string }>("SELECT nombre FROM mesas WHERE id = $1 AND sucursal_id = $2 AND activa", [mesaId, ctx.sucursalId])).rows[0];
      if (!mesa) throw new ErrorNegocio("Esa mesa no existe", 400);
      if ((await c.query("SELECT 1 FROM cuentas WHERE sucursal_id = $1 AND estado = 'ABIERTA' AND mesa = $2", [ctx.sucursalId, mesa.nombre])).rowCount) throw new ErrorNegocio(`${mesa.nombre} está ocupada`, 409);
      const cuenta = uuidv7();
      await c.query(
        `INSERT INTO cuentas (id, sucursal_id, numero, nombre, mesa, nota, abierta_por)
         VALUES ($1, $2, (SELECT COALESCE(MAX(numero), 0) + 1 FROM cuentas WHERE sucursal_id = $2), $3, $3, $4, $5)`,
        [cuenta, ctx.sucursalId, mesa.nombre, `Reserva de ${r.nombre} · ${r.personas} personas${r.nota ? ` · ${r.nota}` : ""}`, usuarioDe(req)]);
      await c.query("UPDATE reservas SET estado = 'SENTADA', mesa_id = $2, cuenta_id = $3 WHERE id = $1", [id, mesaId, cuenta]);
      return cuenta;
    });
    return { cuentaId };
  });

  /** Modificadores disponibles (los de nota y los extras con cargo, con el precio del extra) y las reglas de cada grupo. */
  app.get("/cajas/:cajaId/modificadores", async (req) => {
    const ctx = await preparar(req);
    const modificadores = (await pool.query(
      `SELECT m.id, m.grupo, m.nombre, m.presentacion_id AS "presentacionId", m.categoria_id AS "categoriaId",
              CASE WHEN m.presentacion_id IS NULL THEN NULL ELSE p.nombre END AS "producto"
         FROM modificadores m
         LEFT JOIN presentaciones pr ON pr.id = m.presentacion_id LEFT JOIN productos p ON p.id = pr.producto_id
        WHERE m.empresa_id = $1 AND m.activo ORDER BY m.grupo, m.orden, m.nombre`, [ctx.empresaId])).rows;
    const grupos = (await pool.query(
      `SELECT nombre, obligatorio, max_opciones AS "maxOpciones" FROM modificador_grupos WHERE empresa_id = $1 ORDER BY nombre`, [ctx.empresaId])).rows;
    return { modificadores, grupos };
  });

  /** Guarda los modificadores (solo supervisor). */
  app.put("/cajas/:cajaId/modificadores", async (req) => {
    const ctx = await preparar(req);
    exigirSupervisor(req, "Configurar los modificadores");
    const b = z.object({
      modificadores: z.array(z.object({
        id: uuid.optional(), grupo: z.string().trim().max(30).default(""), nombre: z.string().trim().min(1).max(40),
        presentacionId: uuid.nullable().default(null), categoriaId: uuid.nullable().default(null),
      })).max(300),
      grupos: z.array(z.object({ nombre: z.string().trim().min(1).max(30), obligatorio: z.boolean(), maxOpciones: z.number().int().min(1).max(99) })).max(50).default([]),
    }).parse(req.body);
    await enTransaccion(async (c) => {
      await c.query("DELETE FROM modificador_grupos WHERE empresa_id = $1", [ctx.empresaId]);
      for (const g of b.grupos) {
        await c.query("INSERT INTO modificador_grupos (empresa_id, nombre, obligatorio, max_opciones) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [ctx.empresaId, g.nombre, g.obligatorio, g.maxOpciones]);
      }
      const ids: string[] = [];
      for (const [i, m] of b.modificadores.entries()) {
        if (m.presentacionId && !(await c.query(
          "SELECT 1 FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id WHERE pr.id = $1 AND p.empresa_id = $2", [m.presentacionId, ctx.empresaId])).rowCount) {
          throw new ErrorNegocio(`El producto del extra «${m.nombre}» no existe`, 400);
        }
        if (m.categoriaId && !(await c.query("SELECT 1 FROM categorias WHERE id = $1 AND empresa_id = $2", [m.categoriaId, ctx.empresaId])).rowCount) {
          throw new ErrorNegocio(`La categoría de «${m.nombre}» no existe`, 400);
        }
        const id = m.id ?? uuidv7();
        ids.push(id);
        await c.query(
          `INSERT INTO modificadores (id, empresa_id, grupo, nombre, presentacion_id, categoria_id, orden, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
           ON CONFLICT (id) DO UPDATE SET grupo = $3, nombre = $4, presentacion_id = $5, categoria_id = $6, orden = $7, activo = TRUE WHERE modificadores.empresa_id = $2`,
          [id, ctx.empresaId, m.grupo, m.nombre, m.presentacionId, m.categoriaId, i]);
      }
      await c.query("UPDATE modificadores SET activo = FALSE WHERE empresa_id = $1 AND NOT (id = ANY($2::uuid[]))", [ctx.empresaId, ids]);
    });
    return { ok: true };
  });

  /** Platos agotados hoy en la sucursal («86»). Cualquier usuario de la caja puede marcarlos o liberarlos. */
  app.get("/cajas/:cajaId/agotados", async (req) => {
    const ctx = await preparar(req);
    return (await pool.query(
      `SELECT a.presentacion_id AS "presentacionId", p.nombre, a.marcado_en AS "marcadoEn"
         FROM platos_agotados a JOIN presentaciones pr ON pr.id = a.presentacion_id JOIN productos p ON p.id = pr.producto_id
        WHERE a.sucursal_id = $1 ORDER BY p.nombre`, [ctx.sucursalId])).rows;
  });
  app.put("/cajas/:cajaId/agotados/:presentacionId", async (req) => {
    const ctx = await preparar(req);
    const { presentacionId } = z.object({ presentacionId: uuid }).parse(req.params);
    const { agotado } = z.object({ agotado: z.boolean() }).parse(req.body);
    if (agotado) {
      if (!(await pool.query("SELECT 1 FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id WHERE pr.id = $1 AND p.empresa_id = $2", [presentacionId, ctx.empresaId])).rowCount) {
        throw new ErrorNegocio("Producto no encontrado", 404);
      }
      await pool.query(
        "INSERT INTO platos_agotados (sucursal_id, presentacion_id, marcado_por) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [ctx.sucursalId, presentacionId, usuarioDe(req)]);
    } else {
      await pool.query("DELETE FROM platos_agotados WHERE sucursal_id = $1 AND presentacion_id = $2", [ctx.sucursalId, presentacionId]);
    }
    return { ok: true };
  });

  /** Porcentajes del reparto de la propina legal (solo supervisor). Deben sumar 100. */
  app.put("/cajas/:cajaId/salon/propina-reparto", async (req) => {
    const ctx = await preparar(req);
    exigirSupervisor(req, "Configurar el reparto de la propina");
    const b = z.object({ meseros: z.number().min(0).max(100), cocina: z.number().min(0).max(100), barra: z.number().min(0).max(100), otros: z.number().min(0).max(100) }).parse(req.body);
    if (Math.abs(b.meseros + b.cocina + b.barra + b.otros - 100) > 0.001) throw new ErrorNegocio("Los porcentajes deben sumar 100", 400);
    await pool.query(
      `INSERT INTO propina_reparto (sucursal_id, pct_meseros, pct_cocina, pct_barra, pct_otros) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (sucursal_id) DO UPDATE SET pct_meseros = $2, pct_cocina = $3, pct_barra = $4, pct_otros = $5`,
      [ctx.sucursalId, b.meseros, b.cocina, b.barra, b.otros]);
    return { ok: true };
  });
}
