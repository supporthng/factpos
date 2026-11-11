import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja, SQL_PRESENTACION, type PresentacionVenta } from "../contexto.js";
import { crearComandas } from "./comandas.js";
import { verificarAutorizacion } from "../autorizacion.js";
import { dividirPorAsientos, dividirPorLineas, dividirPorMontos, ErrorDivision, repartirIgual, repartirProporcional } from "./cuentas-division.js";

/**
 * Cuentas abiertas (restaurantes, bares, discotecas): una cuenta por mesa o cliente, con «asientos» (personas).
 * Solo funcionan si la empresa dejó de ser «TIENDA» (Administración › Empresa › Tipo de negocio); en una tienda responden 409.
 * El cobro NO está aquí: la caja cobra cada parte con la venta normal (POST /cajas/:id/ventas) y después cierra la cuenta.
 * Los montos de esta pantalla son una vista previa; el precio final lo fija la venta (ofertas, nivel del cliente, etc.).
 */
const uuid = z.string().uuid();
const cantidad = z.string().regex(/^\d+(\.\d{1,3})?$/, "Cantidad inválida").refine((v) => Number(v) > 0, "La cantidad debe ser mayor que cero");
const centavos = (v: string | number) => Math.round(Number(v) * 100);
const aMonto = (c: number) => (c / 100).toFixed(2);

interface FilaLinea {
  id: string; asientoId: string | null; presentacionId: string; descripcion: string; cantidad: string;
  precioUnitario: string; tasaItbis: string; nota: string | null; enviadaEn: string | null; anulada: boolean; ventaId: string | null;
  incluyeItbis?: boolean;
}

/** Total de una línea en centavos (el precio guardado ya incluye el ITBIS si el producto lo trae incluido). */
/** Propina legal de una cuenta (centavos): 10 % del consumo SIN ITBIS (cada línea sin su impuesto). */
const propinaDe = (lineas: FilaLinea[]) => Math.round(lineas.reduce((s, l) => s + totalLinea(l) / (1 + Number(l.tasaItbis)), 0) / 10);
const totalLinea = (l: FilaLinea) => Math.round(Number(l.cantidad) * Number(l.precioUnitario) * (l.incluyeItbis === false ? 1 + Number(l.tasaItbis) : 1) * 100);

export async function rutasCuentas(app: FastifyInstance) {
  /** Todas las operaciones exigen una empresa que no sea «TIENDA» y devuelven la caja y la sucursal. */
  const preparar = async (req: { params: unknown }) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const ctx = await contextoCaja(cajaId);
    const e = (await pool.query<{ t: string }>("SELECT tipo_negocio AS t FROM empresas WHERE id = $1", [ctx.empresaId])).rows[0];
    if (!e || e.t === "TIENDA") throw new ErrorNegocio("Las cuentas abiertas no están activadas para esta empresa", 409);
    return ctx;
  };
  const usuarioDe = (req: unknown) => ((req as { sesionCaja?: { u?: string } }).sesionCaja?.u) ?? null;

  const cuentaDe = async (sucursalId: string, id: string, abierta = true) => {
    const c = (await pool.query<{ id: string; nombre: string; mesa: string | null; estado: string; numero: string; nota: string | null; abiertaEn: string }>(
      `SELECT id, nombre, mesa, estado, numero::text, nota, abierta_en AS "abiertaEn" FROM cuentas WHERE id = $1 AND sucursal_id = $2`, [id, sucursalId])).rows[0];
    if (!c) throw new ErrorNegocio("Cuenta no encontrada", 404);
    if (abierta && c.estado !== "ABIERTA") throw new ErrorNegocio("La cuenta ya está cerrada", 409);
    return c;
  };

  const detalle = async (sucursalId: string, id: string) => {
    const c = await cuentaDe(sucursalId, id, false);
    const asientos = (await pool.query<{ id: string; nombre: string; orden: number }>(
      "SELECT id, nombre, orden FROM cuenta_asientos WHERE cuenta_id = $1 ORDER BY orden, id", [id])).rows;
    const lineas = (await pool.query<FilaLinea>(
      `SELECT l.id, l.asiento_id AS "asientoId", l.presentacion_id AS "presentacionId", l.descripcion, l.cantidad::text AS cantidad,
              l.precio_unitario::text AS "precioUnitario", l.tasa_itbis::text AS "tasaItbis", l.nota, l.enviada_en AS "enviadaEn", l.anulada, l.venta_id AS "ventaId",
              p.precio_incluye_impuesto AS "incluyeItbis"
         FROM cuenta_lineas l JOIN presentaciones pr ON pr.id = l.presentacion_id JOIN productos p ON p.id = pr.producto_id
        WHERE l.cuenta_id = $1 ORDER BY l.creada_en, l.id`, [id])).rows;
    // Pendientes de cobrar: ni anuladas ni cobradas ya
    const vivas = lineas.filter((l) => !l.anulada && !l.ventaId);
    const porAsiento = asientos.map((a) => ({ ...a, total: aMonto(vivas.filter((l) => l.asientoId === a.id).reduce((s, l) => s + totalLinea(l), 0)) }));
    const total = vivas.reduce((s, l) => s + totalLinea(l), 0);
    const sinAsiento = vivas.filter((l) => l.asientoId === null).reduce((s, l) => s + totalLinea(l), 0);
    return {
      ...c, asientos: porAsiento, total: aMonto(total), sinAsiento: aMonto(sinAsiento), propinaLegal: aMonto(propinaDe(vivas)),
      lineas: lineas.map((l) => ({ ...l, total: aMonto(totalLinea(l)) })),
    };
  };

  app.get("/cajas/:cajaId/cuentas", async (req) => {
    const ctx = await preparar(req);
    const r = await pool.query(
      `SELECT c.id, c.nombre, c.mesa, c.numero::text, c.abierta_en AS "abiertaEn", u.nombre AS "abiertaPor",
              (SELECT count(*)::int FROM cuenta_lineas l WHERE l.cuenta_id = c.id AND NOT l.anulada AND l.venta_id IS NULL) AS lineas,
              (SELECT count(*)::int FROM cuenta_asientos a WHERE a.cuenta_id = c.id) AS asientos
         FROM cuentas c LEFT JOIN usuarios u ON u.id = c.abierta_por
        WHERE c.sucursal_id = $1 AND c.estado = 'ABIERTA' ORDER BY c.abierta_en`, [ctx.sucursalId]);
    return r.rows;
  });

  app.get("/cajas/:cajaId/cuentas/:id", async (req) => {
    const ctx = await preparar(req);
    return detalle(ctx.sucursalId, z.object({ id: uuid }).parse(req.params).id);
  });

  app.post("/cajas/:cajaId/cuentas", async (req, rep) => {
    const ctx = await preparar(req);
    const b = z.object({ nombre: z.string().trim().min(1).max(60), mesa: z.string().trim().max(30).optional(), asientos: z.number().int().min(0).max(30).default(0), nota: z.string().trim().max(300).optional() }).parse(req.body);
    const id = uuidv7();
    await enTransaccion(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('cuentas:' || $1))", [ctx.sucursalId]);
      await c.query(
        `INSERT INTO cuentas (id, sucursal_id, numero, nombre, mesa, nota, abierta_por)
         VALUES ($1, $2, (SELECT COALESCE(MAX(numero), 0) + 1 FROM cuentas WHERE sucursal_id = $2), $3, $4, $5, $6)`,
        [id, ctx.sucursalId, b.nombre, b.mesa ?? null, b.nota ?? null, usuarioDe(req)]);
      for (let i = 1; i <= b.asientos; i++) await c.query("INSERT INTO cuenta_asientos (id, cuenta_id, nombre, orden) VALUES ($1,$2,$3,$4)", [uuidv7(), id, `Persona ${i}`, i]);
    });
    rep.code(201);
    return detalle(ctx.sucursalId, id);
  });

  app.post("/cajas/:cajaId/cuentas/:id/asientos", async (req, rep) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nombre: z.string().trim().min(1).max(40).optional() }).parse(req.body ?? {});
    await cuentaDe(ctx.sucursalId, id);
    const n = (await pool.query<{ n: number }>("SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM cuenta_asientos WHERE cuenta_id = $1", [id])).rows[0]!.n;
    await pool.query("INSERT INTO cuenta_asientos (id, cuenta_id, nombre, orden) VALUES ($1,$2,$3,$4)", [uuidv7(), id, b.nombre ?? `Persona ${n}`, n]);
    rep.code(201);
    return detalle(ctx.sucursalId, id);
  });

  /** Ordenar: agrega un producto a la cuenta, a un asiento (persona) o a toda la mesa. */
  app.post("/cajas/:cajaId/cuentas/:id/lineas", async (req, rep) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ presentacionId: uuid, cantidad, asientoId: uuid.nullable().optional(), nota: z.string().trim().max(200).optional() }).parse(req.body);
    await cuentaDe(ctx.sucursalId, id);
    if (b.asientoId && !(await pool.query("SELECT 1 FROM cuenta_asientos WHERE id = $1 AND cuenta_id = $2", [b.asientoId, id])).rowCount) throw new ErrorNegocio("Ese asiento no es de la cuenta", 400);
    const p = (await pool.query<PresentacionVenta>(`${SQL_PRESENTACION} AND pr.id = $5`, [ctx.empresaId, ctx.sucursalId, ctx.almacenId, null, b.presentacionId])).rows[0];
    if (!p) throw new ErrorNegocio("Producto no encontrado o no disponible en esta sucursal", 404);
    if (p.precio === null && !p.precioVariable) throw new ErrorNegocio(`«${p.nombre}» no tiene precio`, 400);
    await pool.query(
      `INSERT INTO cuenta_lineas (id, cuenta_id, asiento_id, presentacion_id, descripcion, cantidad, precio_unitario, tasa_itbis, nota, creada_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [uuidv7(), id, b.asientoId ?? null, p.presentacionId, p.presentacion && p.presentacion !== "Unidad" ? `${p.nombre} (${p.presentacion})` : p.nombre,
       b.cantidad, p.precio ?? "0", p.tasaItbis, b.nota ?? null, usuarioDe(req)]);
    rep.code(201);
    return detalle(ctx.sucursalId, id);
  });

  /** Pasar un producto de una persona a otra, cambiar la cantidad o anular. Lo que ya salió a la barra solo se anula con autorización del supervisor. */
  app.patch("/cajas/:cajaId/cuentas/:id/lineas/:lineaId", async (req) => {
    const ctx = await preparar(req);
    const { id, lineaId } = z.object({ id: uuid, lineaId: uuid }).parse(req.params);
    const b = z.object({ asientoId: uuid.nullable().optional(), cantidad: cantidad.optional(), anulada: z.boolean().optional(), autorizacion: z.string().max(2000).optional() }).parse(req.body);
    await cuentaDe(ctx.sucursalId, id);
    const l = (await pool.query<{ enviada: boolean }>("SELECT enviada_en IS NOT NULL AS enviada FROM cuenta_lineas WHERE id = $1 AND cuenta_id = $2", [lineaId, id])).rows[0];
    if (!l) throw new ErrorNegocio("Línea no encontrada", 404);
    if (l.enviada && (b.anulada || b.cantidad !== undefined)) verificarAutorizacion(b.autorizacion, "venta.anular", ctx.cajaId);
    if (b.asientoId && !(await pool.query("SELECT 1 FROM cuenta_asientos WHERE id = $1 AND cuenta_id = $2", [b.asientoId, id])).rowCount) throw new ErrorNegocio("Ese asiento no es de la cuenta", 400);
    await pool.query(
      `UPDATE cuenta_lineas SET asiento_id = CASE WHEN $3::boolean THEN $4::uuid ELSE asiento_id END,
              cantidad = COALESCE($5::numeric, cantidad), anulada = COALESCE($6::boolean, anulada) WHERE id = $1 AND cuenta_id = $2`,
      [lineaId, id, "asientoId" in b, b.asientoId ?? null, b.cantidad ?? null, b.anulada ?? null]);
    return detalle(ctx.sucursalId, id);
  });

  /** Marca lo ordenado como enviado a la barra o la cocina (desde ahí, anular pide supervisor). */
  app.post("/cajas/:cajaId/cuentas/:id/enviar", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await cuentaDe(ctx.sucursalId, id);
    // Cada estación (barra, cocina) recibe su comanda con lo nuevo; las categorías sin estación solo quedan marcadas como enviadas
    const comandas = await enTransaccion((c) => crearComandas(c, ctx.sucursalId, id, usuarioDe(req)));
    return { ...(await detalle(ctx.sucursalId, id)), comandas };
  });

  /** Juntar otra cuenta abierta con esta (los asientos se conservan). */
  app.post("/cajas/:cajaId/cuentas/:id/unir", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { desdeId } = z.object({ desdeId: uuid }).parse(req.body);
    if (desdeId === id) throw new ErrorNegocio("Elija otra cuenta", 400);
    await cuentaDe(ctx.sucursalId, id);
    await cuentaDe(ctx.sucursalId, desdeId);
    await enTransaccion(async (c) => {
      await c.query("UPDATE cuenta_asientos SET cuenta_id = $1, orden = orden + 100 WHERE cuenta_id = $2", [id, desdeId]);
      await c.query("UPDATE cuenta_lineas SET cuenta_id = $1 WHERE cuenta_id = $2", [id, desdeId]);
      await c.query("UPDATE cuentas SET estado = 'ANULADA', cerrada_en = now(), nota = COALESCE(nota || ' · ', '') || 'Unida a otra cuenta' WHERE id = $1", [desdeId]);
    });
    return detalle(ctx.sucursalId, id);
  });

  /**
   * Vista previa de la división (no cobra nada).
   *   ASIENTOS   lo cargado a cada persona (antes de ordenar); lo de toda la mesa se reparte entre todas
   *   IGUAL      partes iguales entre N personas              MONTOS     un monto por persona
   *   PRODUCTOS  cada producto a una persona (y, si se indica, productos compartidos entre varias)
   * La propina legal (10 %) de cada parte se calcula sobre su consumo y suma exactamente la de la cuenta.
   */
  app.post("/cajas/:cajaId/cuentas/:id/dividir", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.discriminatedUnion("modo", [
      z.object({ modo: z.literal("ASIENTOS") }),
      z.object({ modo: z.literal("IGUAL"), partes: z.number().int().min(1).max(100) }),
      z.object({ modo: z.literal("MONTOS"), montos: z.array(z.string().regex(/^\d+(\.\d{1,2})?$/)).min(1).max(100) }),
      z.object({ modo: z.literal("PRODUCTOS"), partes: z.number().int().min(1).max(100), asignacion: z.record(z.string(), z.number().int()), compartidas: z.record(z.string(), z.array(z.number().int())).optional() }),
    ]).parse(req.body);
    const d = await detalle(ctx.sucursalId, id);
    if (d.estado !== "ABIERTA") throw new ErrorNegocio("La cuenta ya está cerrada", 409);
    const vivas = d.lineas.filter((l) => !l.anulada && !l.ventaId);
    const totales = vivas.map((l) => ({ id: l.id, total: centavos(l.total) }));
    const total = totales.reduce((s, l) => s + l.total, 0);
    if (!total) throw new ErrorNegocio("La cuenta está vacía", 400);
    try {
      let montos: number[]; let nombres: string[]; let lineasPorParte: string[][] | null = null;
      if (b.modo === "ASIENTOS") {
        if (!d.asientos.length) throw new ErrorNegocio("La cuenta no tiene asientos: agregue las personas antes de ordenar", 400);
        const pos = new Map<string, number>(d.asientos.map((a, i): [string, number] => [a.id, i]));
        montos = dividirPorAsientos(vivas.map((l) => ({ total: centavos(l.total), asiento: l.asientoId ? pos.get(l.asientoId) ?? null : null })), d.asientos.length);
        nombres = d.asientos.map((a) => a.nombre);
        lineasPorParte = d.asientos.map((a) => vivas.filter((l) => l.asientoId === a.id).map((l) => l.id));
      } else if (b.modo === "IGUAL") {
        montos = repartirIgual(total, b.partes); nombres = montos.map((_, i) => `Persona ${i + 1}`);
      } else if (b.modo === "MONTOS") {
        montos = dividirPorMontos(total, b.montos.map(centavos)); nombres = montos.map((_, i) => `Persona ${i + 1}`);
      } else {
        montos = dividirPorLineas(totales, b.partes, b.asignacion, b.compartidas ?? {}); nombres = montos.map((_, i) => `Persona ${i + 1}`);
        lineasPorParte = montos.map((_, i) => vivas.filter((l) => b.asignacion[l.id] === i).map((l) => l.id));
      }
      // 10 % del consumo sin ITBIS, repartido en proporción a lo que consume cada parte (suma exacta)
      const propinas = repartirProporcional(propinaDe(vivas), montos);
      return { cuentaId: id, modo: b.modo, total: aMonto(total), partes: montos.map((m, i) => ({ indice: i, nombre: nombres[i], consumo: aMonto(m), propina: aMonto(propinas[i]!), totalConPropina: aMonto(m + propinas[i]!), lineas: lineasPorParte?.[i] ?? null })) };
    } catch (e) {
      if (e instanceof ErrorDivision) throw new ErrorNegocio(e.message, 400);
      throw e;
    }
  });

  /**
   * La caja avisa que cobró una parte: esas líneas quedan ligadas a la venta. Cuando ya no queda nada pendiente, la cuenta se cierra sola.
   * Así se cobra por partes y se puede retomar sin cobrar dos veces.
   */
  app.post("/cajas/:cajaId/cuentas/:id/cobrada", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ ventaId: uuid, lineaIds: z.array(uuid).min(1).max(500) }).parse(req.body);
    await cuentaDe(ctx.sucursalId, id);
    if (!(await pool.query("SELECT 1 FROM ventas WHERE id = $1 AND sucursal_id = $2", [b.ventaId, ctx.sucursalId])).rowCount) throw new ErrorNegocio("Esa venta no existe en esta sucursal", 400);
    await enTransaccion(async (c) => {
      await c.query("UPDATE cuenta_lineas SET venta_id = $3 WHERE cuenta_id = $1 AND id = ANY($2::uuid[]) AND venta_id IS NULL AND NOT anulada", [id, b.lineaIds, b.ventaId]);
      await c.query("INSERT INTO cuenta_ventas (cuenta_id, venta_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, b.ventaId]);
      const quedan = (await c.query("SELECT count(*)::int AS n FROM cuenta_lineas WHERE cuenta_id = $1 AND NOT anulada AND venta_id IS NULL", [id])).rows[0].n;
      if (!quedan) await c.query("UPDATE cuentas SET estado = 'COBRADA', cerrada_en = now() WHERE id = $1", [id]);
    });
    return detalle(ctx.sucursalId, id);
  });

  /** Termina la cuenta una vez cobradas todas sus partes (las ventas hechas con la venta normal de la caja). */
  app.post("/cajas/:cajaId/cuentas/:id/cerrar", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ ventaIds: z.array(uuid).min(1).max(100) }).parse(req.body);
    await cuentaDe(ctx.sucursalId, id);
    const ok = await pool.query("SELECT count(*)::int AS n FROM ventas WHERE id = ANY($1::uuid[]) AND sucursal_id = $2", [b.ventaIds, ctx.sucursalId]);
    if (ok.rows[0].n !== b.ventaIds.length) throw new ErrorNegocio("Alguna venta no existe en esta sucursal", 400);
    await enTransaccion(async (c) => {
      for (const v of b.ventaIds) await c.query("INSERT INTO cuenta_ventas (cuenta_id, venta_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, v]);
      await c.query("UPDATE cuentas SET estado = 'COBRADA', cerrada_en = now() WHERE id = $1", [id]);
    });
    return detalle(ctx.sucursalId, id);
  });

  /** Anular una cuenta abierta (sin cobrar): lo ya enviado a la barra pide autorización del supervisor. */
  app.post("/cajas/:cajaId/cuentas/:id/anular", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ autorizacion: z.string().max(2000).optional() }).parse(req.body ?? {});
    await cuentaDe(ctx.sucursalId, id);
    const enviadas = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM cuenta_lineas WHERE cuenta_id = $1 AND enviada_en IS NOT NULL AND NOT anulada", [id])).rows[0]!.n;
    if ((await pool.query("SELECT 1 FROM cuenta_lineas WHERE cuenta_id = $1 AND venta_id IS NOT NULL", [id])).rowCount) throw new ErrorNegocio("La cuenta ya tiene partes cobradas: cobre lo que falta", 409);
    if (enviadas) verificarAutorizacion(b.autorizacion, "venta.anular", ctx.cajaId);
    await pool.query("UPDATE cuentas SET estado = 'ANULADA', cerrada_en = now() WHERE id = $1", [id]);
    return { ok: true };
  });
}
