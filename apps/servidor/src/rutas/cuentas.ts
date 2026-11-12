import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja, SQL_PRESENTACION, type PresentacionVenta } from "../contexto.js";
import { crearComandas } from "./comandas.js";
import { repartirPorLotes } from "../lotes.js";
import { verificarAutorizacion } from "../autorizacion.js";
import { leerToken } from "../sesion.js";
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
  incluyeItbis?: boolean; padreId?: string | null; paso?: number;
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
    const c = (await pool.query<{ id: string; nombre: string; mesa: string | null; estado: string; numero: string; nota: string | null; abiertaEn: string; pasoLiberado: number; pedidoCobro: boolean }>(
      `SELECT id, nombre, mesa, estado, numero::text, nota, abierta_en AS "abiertaEn", paso_liberado AS "pasoLiberado", pedido_cobro_en IS NOT NULL AS "pedidoCobro" FROM cuentas WHERE id = $1 AND sucursal_id = $2`, [id, sucursalId])).rows[0];
    if (!c) throw new ErrorNegocio("Cuenta no encontrada", 404);
    if (abierta && c.estado !== "ABIERTA") throw new ErrorNegocio("La cuenta ya está cerrada", 409);
    return c;
  };

  const detalle = async (sucursalId: string, id: string) => {
    const c = await cuentaDe(sucursalId, id, false);
    const asientos = (await pool.query<{ id: string; nombre: string; orden: number; pedidoCobro: boolean }>(
      `SELECT a.id, a.nombre, a.orden,
              -- el aviso de cobro solo cuenta mientras la persona tenga algo pendiente
              (a.pedido_cobro_en IS NOT NULL AND EXISTS (SELECT 1 FROM cuenta_lineas l WHERE l.asiento_id = a.id AND NOT l.anulada AND l.venta_id IS NULL)) AS "pedidoCobro"
         FROM cuenta_asientos a WHERE a.cuenta_id = $1 ORDER BY a.orden, a.id`, [id])).rows;
    const lineas = (await pool.query<FilaLinea>(
      `SELECT l.id, l.asiento_id AS "asientoId", l.presentacion_id AS "presentacionId", l.descripcion, l.cantidad::text AS cantidad,
              l.precio_unitario::text AS "precioUnitario", l.tasa_itbis::text AS "tasaItbis", l.nota, l.enviada_en AS "enviadaEn", l.anulada, l.venta_id AS "ventaId",
              p.precio_incluye_impuesto AS "incluyeItbis", l.padre_id AS "padreId", l.paso
         FROM cuenta_lineas l JOIN presentaciones pr ON pr.id = l.presentacion_id JOIN productos p ON p.id = pr.producto_id
        WHERE l.cuenta_id = $1 ORDER BY l.creada_en, l.id`, [id])).rows;
    // Pendientes de cobrar: ni anuladas ni cobradas ya
    const vivas = lineas.filter((l) => !l.anulada && !l.ventaId);
    const porAsiento = asientos.map((a) => ({ ...a, total: aMonto(vivas.filter((l) => l.asientoId === a.id).reduce((s, l) => s + totalLinea(l), 0)) }));
    const total = vivas.reduce((s, l) => s + totalLinea(l), 0);
    // Para la pre-cuenta: el consumo separado en base e ITBIS (cada línea redondeada, suman exacto el total)
    const itbis = vivas.reduce((s, l) => s + (totalLinea(l) - Math.round(totalLinea(l) / (1 + Number(l.tasaItbis)))), 0);
    const sinAsiento = vivas.filter((l) => l.asientoId === null).reduce((s, l) => s + totalLinea(l), 0);
    const cortesias = (await pool.query(
      `SELECT descripcion, cantidad::text AS cantidad, motivo_tipo AS "motivoTipo", motivo, valor::text AS valor FROM control_cuentas WHERE cuenta_id = $1 AND tipo IN ('CORTESIA','VALE') ORDER BY creado_en`, [id])).rows;
    return {
      ...c, cortesias, asientos: porAsiento, total: aMonto(total), itbis: aMonto(itbis), subtotal: aMonto(total - itbis), sinAsiento: aMonto(sinAsiento), propinaLegal: aMonto(propinaDe(vivas)),
      lineas: lineas.map((l) => ({ ...l, total: aMonto(totalLinea(l)) })),
    };
  };

  /** El mesero avisa al cajero que cobre una persona (asientoId) o toda la mesa. `cancelar` retira el aviso. */
  app.post("/cajas/:cajaId/cuentas/:id/pedir-cobro", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ asientoId: uuid.nullable().optional(), cancelar: z.boolean().optional() }).parse(req.body);
    await cuentaDe(ctx.sucursalId, id);
    const valor = b.cancelar ? null : new Date();
    if (b.asientoId) {
      if (!b.cancelar && !(await pool.query(
        "SELECT 1 FROM cuenta_lineas WHERE cuenta_id = $1 AND asiento_id = $2 AND NOT anulada AND venta_id IS NULL LIMIT 1", [id, b.asientoId])).rowCount) {
        throw new ErrorNegocio("Esa cuenta no tiene nada pendiente de cobrar", 400);
      }
      await pool.query("UPDATE cuenta_asientos SET pedido_cobro_en = $3 WHERE id = $1 AND cuenta_id = $2", [b.asientoId, id, valor]);
    } else {
      await pool.query("UPDATE cuentas SET pedido_cobro_en = $2 WHERE id = $1", [id, valor]);
    }
    return detalle(ctx.sucursalId, id);
  });

  /**
   * Repartir un producto entre varias personas (o la mesa) por unidades enteras: 6 cervezas → 2 a una persona y 4 a otra.
   * Los extras con cargo del plato se reparten con él. Lo ya cobrado o anulado no se toca.
   */
  app.post("/cajas/:cajaId/cuentas/:id/lineas/:lineaId/repartir", async (req) => {
    const ctx = await preparar(req);
    const { id, lineaId } = z.object({ id: uuid, lineaId: uuid }).parse(req.params);
    const b = z.object({ partes: z.array(z.object({ asientoId: uuid.nullable(), cantidad })).min(2).max(30) }).parse(req.body);
    await cuentaDe(ctx.sucursalId, id);
    const l = (await pool.query<{ cantidad: string; padre: string | null; pesable: boolean }>(
      `SELECT l.cantidad::text AS cantidad, l.padre_id AS padre, p.es_pesable AS pesable FROM cuenta_lineas l
         JOIN presentaciones pr ON pr.id = l.presentacion_id JOIN productos p ON p.id = pr.producto_id
        WHERE l.id = $1 AND l.cuenta_id = $2 AND NOT l.anulada AND l.venta_id IS NULL`, [lineaId, id])).rows[0];
    if (!l) throw new ErrorNegocio("Línea no encontrada", 404);
    if (l.padre) throw new ErrorNegocio("Un extra se reparte junto con su plato", 400);
    const suma = b.partes.reduce((s, x) => s + Number(x.cantidad), 0);
    if (Math.abs(suma - Number(l.cantidad)) > 0.0005) throw new ErrorNegocio(`Lo repartido (${suma}) debe sumar la cantidad del producto (${Number(l.cantidad)})`, 400);
    if (!l.pesable && b.partes.some((x) => !Number.isInteger(Number(x.cantidad)))) throw new ErrorNegocio("Este producto se reparte por unidades enteras", 400);
    for (const x of b.partes) {
      if (x.asientoId && !(await pool.query("SELECT 1 FROM cuenta_asientos WHERE id = $1 AND cuenta_id = $2", [x.asientoId, id])).rowCount) throw new ErrorNegocio("Esa persona no es de la cuenta", 400);
    }
    await enTransaccion(async (c) => {
      const hijas = (await c.query<{ id: string }>("SELECT id FROM cuenta_lineas WHERE padre_id = $1 AND NOT anulada AND venta_id IS NULL", [lineaId])).rows;
      const [primera, ...resto] = b.partes;
      await c.query("UPDATE cuenta_lineas SET asiento_id = $2, cantidad = $3 WHERE id = $1 OR (padre_id = $1 AND NOT anulada AND venta_id IS NULL)", [lineaId, primera!.asientoId, primera!.cantidad]);
      const copiar = `INSERT INTO cuenta_lineas (id, cuenta_id, asiento_id, presentacion_id, descripcion, cantidad, precio_unitario, tasa_itbis, nota, enviada_en, creada_por, padre_id, paso)
                      SELECT $2, cuenta_id, $3, presentacion_id, descripcion, $4, precio_unitario, tasa_itbis, nota, enviada_en, creada_por, $5, paso FROM cuenta_lineas WHERE id = $1`;
      for (const x of resto) {
        const nuevo = uuidv7();
        await c.query(copiar, [lineaId, nuevo, x.asientoId, x.cantidad, null]);
        for (const h of hijas) await c.query(copiar, [h.id, uuidv7(), x.asientoId, x.cantidad, nuevo]);
      }
    });
    return detalle(ctx.sucursalId, id);
  });

  /**
   * El mesero (rol con «salon.mesero» y sin «venta.crear») solo entra a las cuentas que abrió él: cada mesero maneja sus mesas.
   * El cajero, el supervisor y el administrador entran a todas.
   */
  const soloMias = (req: { headers: Record<string, unknown> }): string | null => {
    const t = leerToken(req.headers["x-sesion-caja"] as string | undefined);
    const p = ((t as { p?: string[] } | null)?.p) ?? [];
    return t && t.t === "caja" && !(p.includes("*") || p.includes("venta.crear")) ? t.u : null;
  };
  app.addHook("preHandler", async (req) => {
    const yo = soloMias(req as never);
    if (!yo) return;
    const params = (req.params ?? {}) as { id?: string };
    const body = (req.body ?? {}) as { desdeId?: string; destinoId?: string };
    const ids = [params.id, body.desdeId, body.destinoId].filter((x): x is string => typeof x === "string" && uuid.safeParse(x).success);
    for (const id of ids) {
      const c = (await pool.query<{ abierta_por: string | null; mesero: string | null }>(
        "SELECT c.abierta_por, u.nombre AS mesero FROM cuentas c LEFT JOIN usuarios u ON u.id = c.abierta_por WHERE c.id = $1", [id])).rows[0];
      if (c && c.abierta_por !== yo) throw new ErrorNegocio(`Esa mesa es de ${c.mesero ?? "otro mesero"}: solo el cajero o un supervisor puede entrar`, 403);
    }
  });

  app.get("/cajas/:cajaId/cuentas", async (req) => {
    const ctx = await preparar(req);
    const r = await pool.query(
      `SELECT c.id, c.nombre, c.mesa, c.nota, c.numero::text, c.abierta_en AS "abiertaEn", u.nombre AS "abiertaPor",
              (SELECT count(*)::int FROM cuenta_lineas l WHERE l.cuenta_id = c.id AND NOT l.anulada AND l.venta_id IS NULL) AS lineas,
              (SELECT count(*)::int FROM cuenta_asientos a WHERE a.cuenta_id = c.id) AS asientos,
              (SELECT COALESCE(sum(l.cantidad * l.precio_unitario * CASE WHEN p.precio_incluye_impuesto THEN 1 ELSE 1 + l.tasa_itbis END), 0)::numeric(14,2)::text
                 FROM cuenta_lineas l JOIN presentaciones pr ON pr.id = l.presentacion_id JOIN productos p ON p.id = pr.producto_id
                WHERE l.cuenta_id = c.id AND NOT l.anulada AND l.venta_id IS NULL) AS total
         FROM cuentas c LEFT JOIN usuarios u ON u.id = c.abierta_por
        WHERE c.sucursal_id = $1 AND c.estado = 'ABIERTA' AND ($2::uuid IS NULL OR c.abierta_por = $2) ORDER BY c.abierta_en`, [ctx.sucursalId, soloMias(req)]);
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

  /**
   * Ordenar: agrega un producto a la cuenta, a un asiento (persona) o a toda la mesa.
   * Con modificadores: los de nota («término medio», «sin cebolla») van en la nota para la cocina; los que tienen cargo («extra queso»)
   * se agregan como una línea hija del plato, con su propio precio, que lo sigue en la comanda, al moverlo y al quitarlo.
   * `paso` es el tiempo de servicio (1 entradas y bebidas, 2 fuertes, 3 postres).
   */
  app.post("/cajas/:cajaId/cuentas/:id/lineas", async (req, rep) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      presentacionId: uuid, cantidad, asientoId: uuid.nullable().optional(), nota: z.string().trim().max(200).optional(),
      modificadores: z.array(uuid).max(20).optional(), paso: z.number().int().min(1).max(3).optional(),
    }).parse(req.body);
    await cuentaDe(ctx.sucursalId, id);
    if (b.asientoId && !(await pool.query("SELECT 1 FROM cuenta_asientos WHERE id = $1 AND cuenta_id = $2", [b.asientoId, id])).rowCount) throw new ErrorNegocio("Ese asiento no es de la cuenta", 400);
    const p = (await pool.query<PresentacionVenta>(`${SQL_PRESENTACION} AND pr.id = $5`, [ctx.empresaId, ctx.sucursalId, ctx.almacenId, null, b.presentacionId])).rows[0];
    if (!p) throw new ErrorNegocio("Producto no encontrado o no disponible en esta sucursal", 404);
    if (p.precio === null && !p.precioVariable) throw new ErrorNegocio(`«${p.nombre}» no tiene precio`, 400);
    if ((await pool.query("SELECT 1 FROM platos_agotados WHERE sucursal_id = $1 AND presentacion_id = $2", [ctx.sucursalId, b.presentacionId])).rowCount) {
      throw new ErrorNegocio(`«${p.nombre}» está agotado hoy`, 409);
    }
    const ids = [...new Set(b.modificadores ?? [])];
    const mods = ids.length
      ? (await pool.query<{ nombre: string; presentacionId: string | null; grupo: string; abreGrupo: string | null }>(
        `SELECT nombre, presentacion_id AS "presentacionId", grupo, abre_grupo AS "abreGrupo" FROM modificadores WHERE id = ANY($1::uuid[]) AND empresa_id = $2 AND activo ORDER BY orden, nombre`, [ids, ctx.empresaId])).rows
      : [];
    if (mods.length !== ids.length) throw new ErrorNegocio("Un modificador ya no está disponible", 409);
    const extras: { mod: string; p: PresentacionVenta }[] = [];
    for (const m of mods) {
      if (!m.presentacionId) continue;
      const e = (await pool.query<PresentacionVenta>(`${SQL_PRESENTACION} AND pr.id = $5`, [ctx.empresaId, ctx.sucursalId, ctx.almacenId, null, m.presentacionId])).rows[0];
      if (!e || e.precio === null) throw new ErrorNegocio(`«${m.nombre}» no está disponible o no tiene precio`, 409);
      extras.push({ mod: m.nombre, p: e });
    }
    // Reglas del grupo (guarniciones): obligatorio = al menos una, máximo = hasta cuántas
    const reglas = (await pool.query<{ grupo: string; obligatorio: boolean; max: number; elegidos: string }>(
      `SELECT g.nombre AS grupo, g.obligatorio, g.max_opciones AS max,
              COUNT(*) FILTER (WHERE m.id = ANY($3::uuid[]))::text AS elegidos
         FROM modificador_grupos g
         JOIN modificadores m ON m.empresa_id = g.empresa_id AND m.grupo = g.nombre AND m.activo
         JOIN presentaciones pr ON pr.id = $2
         JOIN productos pd ON pd.id = pr.producto_id
        WHERE g.empresa_id = $1 AND (m.categoria_id IS NULL OR m.categoria_id = pd.categoria_id)
          AND (m.aplica_presentacion_id IS NULL OR m.aplica_presentacion_id = pr.id)
        GROUP BY g.nombre, g.obligatorio, g.max_opciones`, [ctx.empresaId, b.presentacionId, ids])).rows;
    // Grupos anidados: solo se preguntan (y se exigen) cuando alguna opción elegida los abre
    const hijos = new Set((await pool.query<{ g: string }>("SELECT DISTINCT abre_grupo AS g FROM modificadores WHERE empresa_id = $1 AND activo AND abre_grupo IS NOT NULL", [ctx.empresaId])).rows.map((x) => x.g));
    const abiertos = new Set(mods.map((m) => m.abreGrupo).filter((g): g is string => !!g));
    for (const m of mods) if (hijos.has(m.grupo) && !abiertos.has(m.grupo)) throw new ErrorNegocio(`«${m.nombre}» no aplica a lo que eligió`, 400);
    for (const r of reglas) {
      if (hijos.has(r.grupo) && !abiertos.has(r.grupo)) continue;
      const n = Number(r.elegidos);
      if (r.obligatorio && n < 1) throw new ErrorNegocio(`Falta elegir ${r.grupo.toLowerCase() || "una opción"} para «${p.nombre}»`, 400);
      if (n > r.max) throw new ErrorNegocio(`En ${r.grupo || "este grupo"} se puede elegir ${r.max === 1 ? "una sola opción" : `hasta ${r.max}`}`, 400);
    }
    const nota = [...mods.filter((m) => !m.presentacionId).map((m) => m.nombre), ...(b.nota ? [b.nota] : [])].join(" · ") || null;
    const paso = b.paso ?? 1;
    await enTransaccion(async (c) => {
      const padre = uuidv7();
      await c.query(
        `INSERT INTO cuenta_lineas (id, cuenta_id, asiento_id, presentacion_id, descripcion, cantidad, precio_unitario, tasa_itbis, nota, creada_por, paso)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [padre, id, b.asientoId ?? null, p.presentacionId, p.presentacion && p.presentacion !== "Unidad" ? `${p.nombre} (${p.presentacion})` : p.nombre,
         b.cantidad, p.precio ?? "0", p.tasaItbis, nota, usuarioDe(req), paso]);
      for (const x of extras) {
        await c.query(
          `INSERT INTO cuenta_lineas (id, cuenta_id, asiento_id, presentacion_id, descripcion, cantidad, precio_unitario, tasa_itbis, creada_por, padre_id, paso)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [uuidv7(), id, b.asientoId ?? null, x.p.presentacionId, `+ ${x.mod}`, b.cantidad, x.p.precio ?? "0", x.p.tasaItbis, usuarioDe(req), padre, paso]);
      }
    });
    rep.code(201);
    return detalle(ctx.sucursalId, id);
  });

  /** Pasar un producto de una persona a otra, cambiar la cantidad o anular. Lo que ya salió a la barra solo se anula con autorización del supervisor. */
  app.patch("/cajas/:cajaId/cuentas/:id/lineas/:lineaId", async (req) => {
    const ctx = await preparar(req);
    const { id, lineaId } = z.object({ id: uuid, lineaId: uuid }).parse(req.params);
    const b = z.object({ asientoId: uuid.nullable().optional(), cantidad: cantidad.optional(), paso: z.number().int().min(1).max(3).optional(), anulada: z.boolean().optional(), nota: z.string().trim().max(200).optional(), autorizacion: z.string().max(2000).optional(), motivo: z.string().trim().max(200).optional() }).parse(req.body);
    const cuenta = await cuentaDe(ctx.sucursalId, id);
    const l = (await pool.query<{ enviada: boolean }>("SELECT enviada_en IS NOT NULL AS enviada FROM cuenta_lineas WHERE id = $1 AND cuenta_id = $2", [lineaId, id])).rows[0];
    if (!l) throw new ErrorNegocio("Línea no encontrada", 404);
    if (l.enviada && b.paso !== undefined) throw new ErrorNegocio("Ese producto ya salió: no se le puede cambiar el tiempo", 409);
    if (l.enviada && (b.anulada || b.cantidad !== undefined)) {
      const aut = verificarAutorizacion(b.autorizacion, "venta.anular", ctx.cajaId);
      // Quitar algo que ya salió a la barra o la cocina deja constancia: quién, quién lo autorizó y por qué
      if (b.anulada) {
        if (!b.motivo || b.motivo.length < 3) throw new ErrorNegocio("Escriba el motivo de la anulación", 400);
        await enTransaccion(async (c) => {
          // Los extras con cargo del plato se quitan con él y cada uno queda en el control
          const hijas = (await c.query<{ id: string }>("SELECT id FROM cuenta_lineas WHERE padre_id = $1 AND NOT anulada AND venta_id IS NULL", [lineaId])).rows;
          await c.query("UPDATE cuenta_lineas SET anulada = TRUE WHERE (id = $1 OR padre_id = $1) AND cuenta_id = $2 AND venta_id IS NULL", [lineaId, id]);
          for (const x of [lineaId, ...hijas.map((h) => h.id)]) await registrarControl(c, ctx.sucursalId, ctx.cajaId, cuenta, x, "ANULACION", "OTRO", b.motivo!, usuarioDe(req), aut.supervisorId);
        });
        return detalle(ctx.sucursalId, id);
      }
    }
    if (b.nota !== undefined) {
      // Cambiar la indicación de un plato. Si ya salió, vuelve a quedar pendiente y se reenvía marcada como CAMBIO para que la cocina la vea
      const nueva = b.nota ? (l.enviada ? `CAMBIO: ${b.nota.replace(/^CAMBIO:\s*/i, "")}` : b.nota) : null;
      await pool.query(
        `UPDATE cuenta_lineas SET nota = $3, enviada_en = CASE WHEN $4::boolean AND $3 IS NOT NULL THEN NULL ELSE enviada_en END
          WHERE id = $1 AND cuenta_id = $2 AND venta_id IS NULL AND NOT anulada`, [lineaId, id, nueva, l.enviada]);
      if (b.asientoId === undefined && b.cantidad === undefined && b.paso === undefined && b.anulada === undefined) return detalle(ctx.sucursalId, id);
    }
    if (b.asientoId && !(await pool.query("SELECT 1 FROM cuenta_asientos WHERE id = $1 AND cuenta_id = $2", [b.asientoId, id])).rowCount) throw new ErrorNegocio("Ese asiento no es de la cuenta", 400);
    // Los extras con cargo siguen a su plato: persona, cantidad, tiempo y anulación
    await pool.query(
      `UPDATE cuenta_lineas SET asiento_id = CASE WHEN $3::boolean THEN $4::uuid ELSE asiento_id END,
              cantidad = COALESCE($5::numeric, cantidad), anulada = COALESCE($6::boolean, anulada), paso = COALESCE($7::smallint, paso)
        WHERE (id = $1 OR padre_id = $1) AND cuenta_id = $2 AND venta_id IS NULL`,
      [lineaId, id, "asientoId" in b, b.asientoId ?? null, b.cantidad ?? null, b.anulada ?? null, b.paso ?? null]);
    return detalle(ctx.sucursalId, id);
  });

  /** Registra en el control (y sube a la central) una cortesía o una anulación de algo ya enviado. La cortesía descuenta el inventario. */
  const registrarControl = async (
    c: Parameters<Parameters<typeof enTransaccion>[0]>[0], sucursalId: string, cajaId: string, cuenta: { id: string; nombre: string },
    lineaId: string, tipo: "CORTESIA" | "ANULACION" | "VALE", motivoTipo: string, motivo: string, usuarioId: string | null, autorizadoPor: string | null,
  ) => {
    const l = (await c.query<FilaLinea & { productoId: string; factor: string; tipoProd: string; controlaStock: boolean; enviadaEn: string | null }>(
      `SELECT l.id, l.descripcion, l.cantidad::text AS cantidad, l.precio_unitario::text AS "precioUnitario", l.tasa_itbis::text AS "tasaItbis",
              l.enviada_en AS "enviadaEn", p.precio_incluye_impuesto AS "incluyeItbis", p.id AS "productoId", pr.factor::text AS factor,
              p.tipo AS "tipoProd", p.controla_stock AS "controlaStock"
         FROM cuenta_lineas l JOIN presentaciones pr ON pr.id = l.presentacion_id JOIN productos p ON p.id = pr.producto_id
        WHERE l.id = $1`, [lineaId])).rows[0];
    const id = uuidv7();
    const valor = aMonto(totalLinea(l as FilaLinea));
    await c.query(
      `INSERT INTO control_cuentas (id, sucursal_id, tipo, cuenta_id, cuenta_nombre, caja_id, producto_id, descripcion, cantidad, valor, motivo_tipo, motivo, ya_enviada, usuario_id, autorizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, sucursalId, tipo, cuenta.id, cuenta.nombre, cajaId, l.productoId, l.descripcion, l.cantidad, valor, motivoTipo, motivo || null, !!l.enviadaEn, usuarioId, autorizadoPor]);
    const kardexIds: string[] = [];
    if (tipo !== "ANULACION") {
      const unidades = Number(l.cantidad) * Number(l.factor);
      const salidas: { productoId: string; cantidad: string }[] = [];
      if (l.tipoProd === "COMBO") {
        const comp = (await c.query<{ id: string; cantidad: string }>("SELECT componente_id AS id, cantidad::text FROM producto_componentes WHERE combo_id = $1", [l.productoId])).rows;
        for (const x of comp) salidas.push({ productoId: x.id, cantidad: (-(unidades * Number(x.cantidad))).toFixed(3) });
      } else if (l.controlaStock) salidas.push({ productoId: l.productoId, cantidad: (-unidades).toFixed(3) });
      if (salidas.length) {
        const almacenId = (await c.query<{ id: string }>("SELECT almacen_id AS id FROM cajas WHERE id = $1", [cajaId])).rows[0]?.id;
        if (!almacenId) throw new ErrorNegocio("La caja no tiene almacén", 409);
        const KL = await repartirPorLotes(c, almacenId, salidas);
        const ids = KL.map(() => uuidv7());
        kardexIds.push(...ids);
        await c.query(
          `INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, documento_tipo, documento_id, motivo, usuario_id, lote_id)
           SELECT id, $2, $3, producto_id, 'CONSUMO_INTERNO', cantidad, 0, 'cortesia', $4, $5, $6, lote_id
             FROM unnest($1::uuid[], $7::uuid[], $8::numeric[], $9::uuid[]) AS t(id, producto_id, cantidad, lote_id)`,
          [ids, sucursalId, almacenId, id, `${tipo === "VALE" ? "Vale de consumo" : "Cortesía"} · ${motivoTipo}${motivo ? ` · ${motivo}` : ""}`, usuarioId, KL.map((k) => k.productoId), KL.map((k) => k.cantidad), KL.map((k) => k.loteId)]);
        await c.query(
          `UPDATE control_cuentas SET costo = COALESCE((SELECT -sum(k.cantidad * k.costo_unitario) FROM kardex_movimientos k WHERE k.id = ANY($2::uuid[])), 0)::numeric(14,2) WHERE id = $1`, [id, ids]);
      }
    }
    await c.query(
      `INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
       SELECT 'control_cuentas', cc.id, 'UPSERT', jsonb_build_object('filas', jsonb_build_array(to_jsonb(cc)),
              'kardex', (SELECT jsonb_agg(to_jsonb(k)) FROM kardex_movimientos k WHERE k.id = ANY($2::uuid[])))
         FROM control_cuentas cc WHERE cc.id = $1`, [id, kardexIds]);
  };

  /**
   * Cortesía: se regala un producto de la cuenta. Requiere un supervisor, un motivo y queda en el reporte.
   * Sale la comanda a la barra (si faltaba enviarlo), el producto deja de cobrarse y se descuenta del inventario.
   */
  app.post("/cajas/:cajaId/cuentas/:id/lineas/:lineaId/cortesia", async (req) => {
    const ctx = await preparar(req);
    const { id, lineaId } = z.object({ id: uuid, lineaId: uuid }).parse(req.params);
    const b = z.object({
      motivoTipo: z.enum(["CASA", "RRPP", "CLIENTE_VIP", "ERROR", "OTRO"]), motivo: z.string().trim().max(200).default(""), autorizacion: z.string().max(2000),
    }).parse(req.body);
    const aut = verificarAutorizacion(b.autorizacion, ["venta.descuento", "venta.anular"], ctx.cajaId);
    if (b.motivoTipo === "OTRO" && b.motivo.length < 3) throw new ErrorNegocio("Escriba el motivo de la cortesía", 400);
    const cuenta = await cuentaDe(ctx.sucursalId, id);
    const comandas = await enTransaccion(async (c) => {
      const l = (await c.query<{ anulada: boolean; ventaId: string | null; enviada: boolean }>(
        `SELECT anulada, venta_id AS "ventaId", enviada_en IS NOT NULL AS enviada FROM cuenta_lineas WHERE id = $1 AND cuenta_id = $2 FOR UPDATE`, [lineaId, id])).rows[0];
      if (!l) throw new ErrorNegocio("Línea no encontrada", 404);
      if (l.anulada || l.ventaId) throw new ErrorNegocio("Ese producto ya no está pendiente en la cuenta", 409);
      // Lo regalado también se prepara: si todavía no salió, sale ahora su comanda
      const nuevas = l.enviada ? [] : await crearComandas(c, ctx.sucursalId, id, usuarioDe(req), [lineaId]);
      await c.query("UPDATE cuenta_lineas SET anulada = TRUE WHERE id = $1", [lineaId]);
      await registrarControl(c, ctx.sucursalId, ctx.cajaId, cuenta, lineaId, "CORTESIA", b.motivoTipo, b.motivo, usuarioDe(req), aut.supervisorId);
      return nuevas;
    });
    return { ...(await detalle(ctx.sucursalId, id)), comandas };
  });

  /** Consulta un vale de consumo por su código (cuántos consumos le quedan). */
  app.get("/cajas/:cajaId/vales/:codigo", async (req) => {
    const ctx = await preparar(req);
    const { codigo } = z.object({ codigo: z.string().trim().min(3).max(12) }).parse(req.params);
    const v = (await pool.query(
      `SELECT codigo, descripcion, consumos, usados, (consumos - usados) AS restantes FROM vales_consumo WHERE sucursal_id = $1 AND codigo = $2`,
      [ctx.sucursalId, codigo.toUpperCase()])).rows[0];
    if (!v) throw new ErrorNegocio("Ese código de vale no existe", 404);
    return v;
  });

  /**
   * Canjear un vale de consumo: el producto de la cuenta se paga con los consumos del vale (no se cobra, sale su comanda, descuenta el
   * inventario y queda en el reporte de control). El código del vale es la autorización; se gasta un consumo por unidad.
   */
  app.post("/cajas/:cajaId/cuentas/:id/lineas/:lineaId/vale", async (req) => {
    const ctx = await preparar(req);
    const { id, lineaId } = z.object({ id: uuid, lineaId: uuid }).parse(req.params);
    const b = z.object({ codigo: z.string().trim().min(3).max(12) }).parse(req.body);
    const cuenta = await cuentaDe(ctx.sucursalId, id);
    const comandas = await enTransaccion(async (c) => {
      const l = (await c.query<{ anulada: boolean; ventaId: string | null; enviada: boolean; cantidad: string }>(
        `SELECT anulada, venta_id AS "ventaId", enviada_en IS NOT NULL AS enviada, cantidad::text AS cantidad FROM cuenta_lineas WHERE id = $1 AND cuenta_id = $2 FOR UPDATE`, [lineaId, id])).rows[0];
      if (!l) throw new ErrorNegocio("Línea no encontrada", 404);
      if (l.anulada || l.ventaId) throw new ErrorNegocio("Ese producto ya no está pendiente en la cuenta", 409);
      const unidades = Number(l.cantidad);
      if (!Number.isInteger(unidades)) throw new ErrorNegocio("Un vale solo se canjea por productos de cantidad entera", 400);
      const vale = (await c.query<{ id: string; restantes: number }>(
        `SELECT id, (consumos - usados) AS restantes FROM vales_consumo WHERE sucursal_id = $1 AND codigo = $2 FOR UPDATE`, [ctx.sucursalId, b.codigo.toUpperCase()])).rows[0];
      if (!vale) throw new ErrorNegocio("Ese código de vale no existe", 404);
      if (vale.restantes < unidades) throw new ErrorNegocio(vale.restantes <= 0 ? "Ese vale ya no tiene consumos" : `Al vale le quedan ${vale.restantes} consumo(s) y el producto es de ${unidades}`, 409);
      await c.query("UPDATE vales_consumo SET usados = usados + $2 WHERE id = $1", [vale.id, unidades]);
      const nuevas = l.enviada ? [] : await crearComandas(c, ctx.sucursalId, id, usuarioDe(req), [lineaId]);
      await c.query("UPDATE cuenta_lineas SET anulada = TRUE WHERE id = $1", [lineaId]);
      await registrarControl(c, ctx.sucursalId, ctx.cajaId, cuenta, lineaId, "VALE", "VALE", `Vale ${b.codigo.toUpperCase()}`, usuarioDe(req), null);
      return nuevas;
    });
    return { ...(await detalle(ctx.sucursalId, id)), comandas };
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

  /** Pedir el siguiente tiempo (de entradas a fuertes, de fuertes a postres): libera y envía a cocina lo que estaba esperando. */
  app.post("/cajas/:cajaId/cuentas/:id/siguiente-tiempo", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const cuenta = await cuentaDe(ctx.sucursalId, id);
    if (cuenta.pasoLiberado >= 3) throw new ErrorNegocio("Ya se pidieron todos los tiempos", 409);
    const comandas = await enTransaccion(async (c) => {
      await c.query("UPDATE cuentas SET paso_liberado = paso_liberado + 1 WHERE id = $1", [id]);
      return crearComandas(c, ctx.sucursalId, id, usuarioDe(req));
    });
    return { ...(await detalle(ctx.sucursalId, id)), comandas };
  });

  /** Cambiar la cuenta de mesa. Si la mesa de destino está ocupada hay que unir las cuentas. */
  app.post("/cajas/:cajaId/cuentas/:id/mesa", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ mesa: z.string().trim().min(1).max(30) }).parse(req.body);
    const cuenta = await cuentaDe(ctx.sucursalId, id);
    if (cuenta.mesa === b.mesa) return detalle(ctx.sucursalId, id);
    await enTransaccion(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('cuentas:' || $1))", [ctx.sucursalId]);
      const ocupada = (await c.query("SELECT 1 FROM cuentas WHERE sucursal_id = $1 AND estado = 'ABIERTA' AND mesa = $2 AND id <> $3", [ctx.sucursalId, b.mesa, id])).rowCount;
      if (ocupada) throw new ErrorNegocio(`${b.mesa} está ocupada: use «Pasar productos» para juntarlos con esa cuenta`, 409);
      // Si la cuenta se llamaba como su mesa («Mesa 4»), pasa a llamarse como la nueva
      await c.query("UPDATE cuentas SET mesa = $2, nombre = CASE WHEN nombre = COALESCE(mesa, '') THEN $2 ELSE nombre END WHERE id = $1", [id, b.mesa]);
    });
    return detalle(ctx.sucursalId, id);
  });

  /** Pasar productos de esta cuenta a otra abierta (otra mesa, o de la barra a una mesa). Los extras van con su plato. */
  app.post("/cajas/:cajaId/cuentas/:id/mover-lineas", async (req) => {
    const ctx = await preparar(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ destinoId: uuid, lineaIds: z.array(uuid).min(1).max(200) }).parse(req.body);
    if (b.destinoId === id) throw new ErrorNegocio("Elija otra cuenta", 400);
    await cuentaDe(ctx.sucursalId, id);
    await cuentaDe(ctx.sucursalId, b.destinoId);
    const n = await enTransaccion(async (c) => {
      // Los asientos son de cada cuenta: lo que pasa queda «para toda la mesa» de la nueva
      const r = await c.query(
        `UPDATE cuenta_lineas SET cuenta_id = $2, asiento_id = NULL
          WHERE cuenta_id = $1 AND venta_id IS NULL AND NOT anulada AND ((id = ANY($3::uuid[]) AND padre_id IS NULL) OR padre_id = ANY($3::uuid[]))`,
        [id, b.destinoId, b.lineaIds]);
      return r.rowCount ?? 0;
    });
    if (!n) throw new ErrorNegocio("No había productos pendientes para pasar", 409);
    return detalle(ctx.sucursalId, id);
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
      // lo que ya se cobró deja de pedir cobro: el aviso del mesero se retira solo
      await c.query(`UPDATE cuenta_asientos a SET pedido_cobro_en = NULL WHERE a.cuenta_id = $1 AND a.pedido_cobro_en IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM cuenta_lineas l WHERE l.asiento_id = a.id AND NOT l.anulada AND l.venta_id IS NULL)`, [id]);
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
