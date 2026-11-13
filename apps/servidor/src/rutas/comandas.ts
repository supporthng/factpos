import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";

/**
 * Comandas por estación (barra, cocina). Cada categoría de productos va a una estación; al «Enviar» una cuenta lo nuevo
 * se separa por estación y cada una recibe su comanda: se ve en la pantalla de la estación (cola con «Listo») y/o se imprime.
 * Solo para empresas que no son «TIENDA».
 */
const uuid = z.string().uuid();

export interface ComandaNueva {
  id: string; numero: string; estacionId: string; estacion: string; imprimeEnCaja: boolean;
  cuenta: string; mesa: string | null; creadaEn: string; paso: number;
  lineas: { descripcion: string; cantidad: string; persona: string | null; nota: string | null }[];
}

/**
 * Separa por estación lo pendiente de enviar de una cuenta y crea una comanda por estación. Marca las líneas como enviadas
 * (también las de categorías sin estación: salen «enviadas» pero sin comanda). Se llama dentro de la transacción del envío.
 */
export async function crearComandas(c: PoolClient, sucursalId: string, cuentaId: string, usuarioId: string | null, soloLineas: string[] | null = null): Promise<ComandaNueva[]> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`comandas:${sucursalId}`]);
  const filas = (await c.query<{ id: string; descripcion: string; cantidad: string; nota: string | null; persona: string | null; estacionId: string | null; paso: number }>(
    `SELECT l.id, l.descripcion, l.cantidad::text AS cantidad, l.nota, a.nombre AS persona, l.paso,
            -- un extra con cargo se prepara donde se prepara su plato
            (SELECT e.id FROM estacion_categorias ec JOIN estaciones e ON e.id = ec.estacion_id
              WHERE ec.categoria_id = COALESCE(pp.categoria_id, p.categoria_id) AND e.sucursal_id = $2 AND e.activa ORDER BY e.orden, e.nombre LIMIT 1) AS "estacionId"
       FROM cuenta_lineas l
       JOIN cuentas cu ON cu.id = l.cuenta_id
       JOIN presentaciones pr ON pr.id = l.presentacion_id JOIN productos p ON p.id = pr.producto_id
       LEFT JOIN cuenta_lineas pl ON pl.id = l.padre_id
       LEFT JOIN presentaciones ppr ON ppr.id = pl.presentacion_id LEFT JOIN productos pp ON pp.id = ppr.producto_id
       LEFT JOIN cuenta_asientos a ON a.id = l.asiento_id
      -- por tiempos: solo sale lo que ya se liberó (entradas primero, luego fuertes, luego postres); una cortesía o un vale sale siempre
      WHERE l.cuenta_id = $1 AND l.enviada_en IS NULL AND NOT l.anulada AND l.venta_id IS NULL AND ($3::uuid[] IS NULL OR l.id = ANY($3::uuid[]))
        AND ($3::uuid[] IS NOT NULL OR l.paso <= cu.paso_liberado)
      ORDER BY l.creada_en, l.id FOR UPDATE OF l`, [cuentaId, sucursalId, soloLineas])).rows;
  if (!filas.length) return [];
  const cuenta = (await c.query<{ nombre: string; mesa: string | null }>("SELECT nombre, mesa FROM cuentas WHERE id = $1", [cuentaId])).rows[0];
  const porEstacion = new Map<string, typeof filas>();
  for (const f of filas) if (f.estacionId) porEstacion.set(f.estacionId, [...(porEstacion.get(f.estacionId) ?? []), f]);
  let numero = Number((await c.query<{ n: string }>("SELECT COALESCE(max(numero), 0)::text AS n FROM comandas WHERE sucursal_id = $1", [sucursalId])).rows[0].n);
  const salida: ComandaNueva[] = [];
  for (const [estacionId, lineas] of porEstacion) {
    const est = (await c.query<{ nombre: string; imprimeEnCaja: boolean }>(`SELECT nombre, imprime_en_caja AS "imprimeEnCaja" FROM estaciones WHERE id = $1`, [estacionId])).rows[0];
    const id = uuidv7();
    numero += 1;
    const r = await c.query<{ creadaEn: string }>(
      `INSERT INTO comandas (id, sucursal_id, estacion_id, cuenta_id, numero, creada_por, paso) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING creada_en AS "creadaEn"`,
      [id, sucursalId, estacionId, cuentaId, numero, usuarioId, Math.max(...lineas.map((l) => l.paso))]);
    await c.query(
      `INSERT INTO comanda_lineas (id, comanda_id, cuenta_linea_id, descripcion, cantidad, persona, nota)
       SELECT gen_random_uuid(), $1, x.id, x.d, x.c::numeric, x.p, x.n FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[]) AS x(id, d, c, p, n)`,
      [id, lineas.map((l) => l.id), lineas.map((l) => l.descripcion), lineas.map((l) => l.cantidad), lineas.map((l) => l.persona), lineas.map((l) => l.nota)]);
    salida.push({
      id, numero: String(numero), estacionId, estacion: est.nombre, imprimeEnCaja: est.imprimeEnCaja, cuenta: cuenta.nombre, mesa: cuenta.mesa, creadaEn: r.rows[0].creadaEn, paso: Math.max(...lineas.map((l) => l.paso)),
      lineas: lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, persona: l.persona, nota: l.nota })),
    });
  }
  await c.query("UPDATE cuenta_lineas SET enviada_en = now() WHERE id = ANY($1::uuid[])", [filas.map((f) => f.id)]);
  return salida;
}

export async function rutasComandas(app: FastifyInstance) {
  const preparar = async (req: { params: unknown }) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const e = (await pool.query<{ t: string }>("SELECT tipo_negocio AS t FROM empresas WHERE id = $1", [ctx.empresaId])).rows[0];
    if (!e || e.t === "TIENDA") throw new ErrorNegocio("Las comandas no están activadas para esta empresa", 409);
    return ctx;
  };

  /** Estaciones de la sucursal con sus categorías, y las categorías de la empresa para asignarlas. */
  app.get("/cajas/:cajaId/estaciones", async (req) => {
    const ctx = await preparar(req);
    const estaciones = (await pool.query(
      `SELECT e.id, e.nombre, e.tipo, e.imprime_en_caja AS "imprimeEnCaja", e.activa, e.alerta_minutos AS "alertaMinutos",
              COALESCE((SELECT array_agg(ec.categoria_id ORDER BY ec.categoria_id) FROM estacion_categorias ec WHERE ec.estacion_id = e.id), '{}') AS "categoriaIds"
         FROM estaciones e WHERE e.sucursal_id = $1 ORDER BY e.orden, e.nombre`, [ctx.sucursalId])).rows;
    const categorias = (await pool.query("SELECT id, nombre FROM categorias WHERE empresa_id = $1 ORDER BY nombre", [ctx.empresaId])).rows;
    return { estaciones, categorias };
  });

  /** Guarda las estaciones (solo supervisor). Una categoría va a una sola estación. */
  app.put("/cajas/:cajaId/estaciones", async (req) => {
    const ctx = await preparar(req);
    const p = ((req as { sesionCaja?: { p?: string[] } }).sesionCaja?.p) ?? [];
    if (!(p.includes("*") || p.includes("venta.anular"))) throw new ErrorNegocio("Configurar las estaciones requiere un supervisor", 403);
    const b = z.object({
      estaciones: z.array(z.object({
        id: uuid.optional(), nombre: z.string().trim().min(1).max(40), tipo: z.enum(["BARRA", "COCINA"]),
        imprimeEnCaja: z.boolean().default(false), alertaMinutos: z.number().int().min(1).max(120).default(10), activa: z.boolean().default(true), categoriaIds: z.array(uuid).max(200),
      })).max(20),
    }).parse(req.body);
    const nombres = b.estaciones.map((e) => e.nombre.toLowerCase());
    if (new Set(nombres).size !== nombres.length) throw new ErrorNegocio("Hay dos estaciones con el mismo nombre", 400);
    const cats = b.estaciones.flatMap((e) => e.categoriaIds);
    if (new Set(cats).size !== cats.length) throw new ErrorNegocio("Una categoría solo puede ir a una estación", 400);
    await enTransaccion(async (c) => {
      const ids: string[] = [];
      for (const [i, e] of b.estaciones.entries()) {
        const id = e.id ?? uuidv7();
        ids.push(id);
        await c.query(
          `INSERT INTO estaciones (id, sucursal_id, nombre, tipo, imprime_en_caja, activa, orden, alerta_minutos) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET nombre = $3, tipo = $4, imprime_en_caja = $5, activa = $6, orden = $7, alerta_minutos = $8
             WHERE estaciones.sucursal_id = $2`, [id, ctx.sucursalId, e.nombre, e.tipo, e.imprimeEnCaja, e.activa, i, e.alertaMinutos]);
        await c.query("DELETE FROM estacion_categorias WHERE estacion_id = $1", [id]);
        if (e.categoriaIds.length) {
          await c.query(
            `INSERT INTO estacion_categorias (estacion_id, categoria_id) SELECT $1, k FROM unnest($2::uuid[]) k WHERE EXISTS (SELECT 1 FROM categorias WHERE id = k AND empresa_id = $3)`,
            [id, e.categoriaIds, ctx.empresaId]);
        }
      }
      // Las que ya no están se desactivan (conservan su historial de comandas)
      await c.query("UPDATE estaciones SET activa = FALSE WHERE sucursal_id = $1 AND NOT (id = ANY($2::uuid[]))", [ctx.sucursalId, ids]);
    }).catch((e: { code?: string }) => {
      if (e.code === "23505") throw new ErrorNegocio("Hay dos estaciones con el mismo nombre", 400);
      throw e;
    });
    return { ok: true };
  });

  /** Cola de una estación: comandas pendientes (y las listas de los últimos minutos). */
  app.get("/cajas/:cajaId/comandas", async (req) => {
    const ctx = await preparar(req);
    const f = z.object({ estacionId: uuid }).parse(req.query);
    const r = await pool.query(
      `SELECT c.id, c.estacion_id AS "estacionId", c.numero::text, c.estado, c.creada_en AS "creadaEn", c.impresa_en AS "impresaEn", c.lista_en AS "listaEn", c.paso,
              -- el reloj lo da el servidor: así el atraso no depende de la hora de cada pantalla
              floor(EXTRACT(EPOCH FROM (COALESCE(c.lista_en, now()) - c.creada_en)))::int AS "segundos",
              (SELECT e.alerta_minutos FROM estaciones e WHERE e.id = c.estacion_id) AS "alertaMinutos",
              cu.nombre AS cuenta, cu.mesa,
              (SELECT json_agg(json_build_object('descripcion', l.descripcion, 'cantidad', l.cantidad::text, 'persona', l.persona, 'nota', l.nota) ORDER BY l.descripcion)
                 FROM comanda_lineas l WHERE l.comanda_id = c.id) AS lineas
         FROM comandas c JOIN cuentas cu ON cu.id = c.cuenta_id
        WHERE c.sucursal_id = $1 AND c.estacion_id = $2 AND (c.estado = 'PENDIENTE' OR c.lista_en > now() - interval '10 minutes')
        ORDER BY (c.estado = 'LISTA'), c.creada_en`, [ctx.sucursalId, f.estacionId]);
    return r.rows;
  });

  app.post("/cajas/:cajaId/comandas/:id/lista", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query("UPDATE comandas SET estado = 'LISTA', lista_en = now() WHERE id = $1 AND sucursal_id = $2 AND estado = 'PENDIENTE'", [id, ctx.sucursalId]);
    return { ok: (r.rowCount ?? 0) > 0 };
  });

  /** Devolver a la cola una comanda marcada «Lista» por error. */
  app.post("/cajas/:cajaId/comandas/:id/pendiente", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await pool.query("UPDATE comandas SET estado = 'PENDIENTE', lista_en = NULL WHERE id = $1 AND sucursal_id = $2", [id, ctx.sucursalId]);
    return { ok: true };
  });

  app.post("/cajas/:cajaId/comandas/:id/impresa", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await pool.query("UPDATE comandas SET impresa_en = COALESCE(impresa_en, now()) WHERE id = $1 AND sucursal_id = $2", [id, ctx.sucursalId]);
    return { ok: true };
  });
}
