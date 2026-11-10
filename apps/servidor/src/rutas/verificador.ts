import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { leerCodigoBalanza, mejorOferta, formatoRD, variantesCodigoBarra } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { SQL_PRESENTACION, type PresentacionVenta } from "../contexto.js";
import { tienePermiso, type SesionAdmin } from "../sesion.js";
import { PORTAL_URL } from "../licencia/cliente.js";
import { supervisorPorPin } from "../autorizacion.js";
import { ofertasPara } from "../promociones.js";
import QRCode from "qrcode";
import { PAGINA_CONSULTA_MOVIL } from "../consulta-movil-pagina.js";
import { PAGINA_VERIFICADOR } from "../verificador-pagina.js";
import { direccionesLocales } from "../red.js";
import { config } from "../config.js";

/** Rutas de la consulta de precios desde el celular del cliente (la página, su configuración y la consulta de un código). */
export function rutaConsultaMovil(url: string) {
  const [ruta, consulta = ""] = url.split("?");
  if (ruta === "/verificador/movil" || ruta === "/verificador/config" || ruta === "/verificador/ofertas") return true;
  return /^\/verificador\/[0-9a-f-]{36}\/[^/]+$/i.test(ruta) && /(^|&)canal=movil(&|$)/.test(consulta);
}
const visitas = new Map<string, { n: number; hasta: number }>();
/** Distancia en metros entre dos puntos (fórmula de haversine). */
export function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const RADIO_CONSULTA_M = 150;

/**
 * Verificador de precios.
 *
 * - GET /verificador?sucursal=<id>  → página lista para una tablet o kiosco.
 * - GET /verificador/:sucursalId/:codigo → JSON para cualquier otra app
 *   (por ejemplo tu verificador hecho en Streamlit), con el precio al detalle
 *   y la oferta vigente ya calculada.
 *
 * Funciona desde el servidor local, así sigue funcionando sin internet.
 */
/** Cambia cada vez que el servidor arranca (p. ej. al actualizarse): las pantallas abiertas se recargan solas al notarlo. */
const ARRANQUE = String(Date.now());
const versionApps = new Map<string, { version: number; hasta: number }>();
/** Compilación vigente de la app del verificador (la misma que ven las apps), con la caché de 10 min. null si no se pudo saber. */
export async function buildVigenteVerificador(so: "android" | "windows"): Promise<number | null> {
  const c = versionApps.get(so);
  if (c && c.hasta > Date.now()) return c.version;
  try {
    const r = await fetch(`${PORTAL_URL()}/licencias/version-verificador/${so}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(String(r.status));
    const { version } = (await r.json()) as { version: number };
    versionApps.set(so, { version, hasta: Date.now() + 10 * 60_000 });
    return version;
  } catch { return c?.version ?? null; }
}

export async function rutasVerificador(app: FastifyInstance) {
  /**
   * Por internet (servidor web de la empresa, no el de la tienda): la consulta del celular solo responde si el
   * dueño la activó en Verificador › «Consulta por internet», y con un límite de consultas por persona.
   */
  app.addHook("onRequest", async (req, rep) => {
    const deInternet = typeof req.headers["cf-connecting-ip"] === "string" || !!process.env.VERCEL;
    if (config.modo === "sucursal" || !deInternet || !rutaConsultaMovil(req.url)) return;
    const ahora = Date.now();
    const ip = String(req.headers["cf-connecting-ip"] ?? req.ip);
    const v = visitas.get(ip);
    if (!v || v.hasta < ahora) visitas.set(ip, { n: 1, hasta: ahora + 60_000 });
    else if (++v.n > 40) return rep.code(429).send({ error: "Demasiadas consultas: espere un minuto" });
    if (visitas.size > 5000) for (const [k, x] of visitas) if (x.hasta < ahora) visitas.delete(k);
    // Cada sucursal tiene sus precios y sus ofertas: por internet el enlace SIEMPRE lleva la sucursal, y la activación es la de su empresa
    const id = /^\/verificador\/([0-9a-f-]{36})\//i.exec(req.url)?.[1] ?? /[?&]sucursal=([0-9a-f-]{36})/i.exec(req.url)?.[1];
    if (!id) return rep.code(400).send({ error: "Falta la sucursal en el enlace: genere el enlace desde Verificador eligiendo la sucursal" });
    const r = await pool.query<{ ok: boolean; lat: string | null; lng: string | null; radio: string | null }>(
      `SELECT COALESCE(m.verificador->>'consultaWeb' = 'true', false) AS ok,
              m.verificador->'ubicaciones'->$2::text->>'lat' AS lat, m.verificador->'ubicaciones'->$2::text->>'lng' AS lng,
              m.verificador->>'radioM' AS radio
         FROM sucursales s LEFT JOIN configuracion_marca m ON m.empresa_id = s.empresa_id WHERE s.id = $1::uuid AND s.activo`, [id, id]).catch((e) => { console.error("[consulta móvil]", (e as Error).message); return null; });
    if (!r?.rows[0]?.ok) return rep.code(404).send({ error: "La consulta de precios por internet no está activada" });
    // Solo el precio de un producto exige estar en la tienda (la página, su configuración y el QR cargan desde cualquier lugar)
    if (/^\/verificador\/[0-9a-f-]{36}\/[^/?]+/i.test(req.url)) {
      const { lat, lng, radio } = r.rows[0];
      if (lat === null || lng === null) return rep.code(403).send({ error: "Esta tienda todavía no activó la consulta por ubicación. Pregunta el precio en caja." });
      const q = req.query as { lat?: string; lng?: string; pre?: string };
      const mLat = Number(q.lat), mLng = Number(q.lng), pre = Math.min(100, Math.max(0, Number(q.pre) || 0));
      if (q.lat === undefined || q.lng === undefined || !Number.isFinite(mLat) || !Number.isFinite(mLng) || Math.abs(mLat) > 90 || Math.abs(mLng) > 180) {
        return rep.code(403).send({ codigo: "UBICACION_REQUERIDA", error: "Para consultar precios hay que permitir la ubicación del teléfono: solo funciona dentro de la tienda." });
      }
      const radioM = Number(radio) > 0 ? Number(radio) : RADIO_CONSULTA_M;
      const d = distanciaM(mLat, mLng, Number(lat), Number(lng));
      if (d - pre > radioM) return rep.code(403).send({ codigo: "FUERA_DE_TIENDA", distanciaM: Math.round(d / 10) * 10, radioM, error: `Solo se puede consultar estando en la tienda (estás a unos ${Math.round(d / 10) * 10} m).` });
    }
  });

  /** Consulta desde el celular del cliente (QR en la tienda, dentro del WiFi de la sucursal). */
  app.get("/verificador/movil", async (_req, rep) => {
    rep.type("text/html; charset=utf-8");
    return PAGINA_CONSULTA_MOVIL;
  });

  /** QR de la consulta móvil con la dirección por la que el equipo llegó a este servidor (la IP de la tienda). */
  app.get("/verificador/movil/qr.svg", async (req, rep) => {
    const { sucursal } = z.object({ sucursal: z.string().uuid().optional() }).parse(req.query);
    const host = String(req.headers.host ?? "").replace(/[^a-zA-Z0-9.:\-\[\]]/g, "");
    if (!host) throw new ErrorNegocio("Sin dirección del servidor", 400);
    // Si la página se abrió en el propio servidor (127.0.0.1 / localhost), el celular no podría llegar: se usa la IP de la red de la tienda
    const [nombreHost, puertoHost] = host.split(/:(?=\d+$)/);
    const ip = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i.test(nombreHost) ? direccionesLocales()[0] : undefined;
    const destino = ip ? `${ip}${puertoHost ? ":" + puertoHost : ""}` : host;
    const url = `http://${destino}/verificador/movil${sucursal ? `?sucursal=${sucursal}` : ""}`;
    rep.type("image/svg+xml").header("cache-control", "public, max-age=60");
    return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  });

  app.get("/verificador", async (_req, rep) => {
    rep.type("text/html; charset=utf-8");
    return PAGINA_VERIFICADOR;
  });

  /**
   * Ofertas vigentes ahora mismo en la sucursal (fecha, día y hora de RD) con los productos que abarcan,
   * para la pantalla de espera interactiva del verificador.
   */
  app.get("/verificador/ofertas", async (req) => {
    const { sucursal } = z.object({ sucursal: z.string().uuid() }).parse(req.query);
    const s = await pool.query<{ empresa_id: string }>("SELECT empresa_id FROM sucursales WHERE id = $1 AND activo", [sucursal]);
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    const empresaId = s.rows[0].empresa_id;
    // Interruptor general (Administración › Verificador): apagado = la pantalla de espera no muestra ofertas
    const ajuste = await pool.query<{ v: unknown }>("SELECT verificador->'mostrarOfertas' AS v FROM configuracion_marca WHERE empresa_id = $1", [empresaId]);
    if (ajuste.rows[0]?.v === false) return [];
    const of = await pool.query(
      `SELECT o.id, o.nombre, o.tipo, o.valor::text, o.lleva, o.paga, o.cantidad_minima::text AS "cantidadMinima", o.termina_en AS "terminaEn", o.prioridad
         FROM ofertas o
        WHERE o.empresa_id = $1 AND o.activo AND o.mostrar_en_verificador AND now() >= o.inicia_en AND now() < o.termina_en
          AND (o.sucursales IS NULL OR $2::uuid = ANY(o.sucursales))
          AND (o.lista_precio_id IS NULL OR o.lista_precio_id = (SELECT lp.id FROM listas_precio lp WHERE lp.empresa_id = $1 AND lp.es_predeterminada))
          AND (o.dias_semana IS NULL OR extract(dow FROM now() AT TIME ZONE 'America/Santo_Domingo')::int = ANY(o.dias_semana))
          AND (o.hora_desde IS NULL OR o.hora_hasta IS NULL OR date_trunc('minute', o.hora_desde) = date_trunc('minute', o.hora_hasta) OR (CASE WHEN o.hora_desde <= o.hora_hasta
                 THEN (now() AT TIME ZONE 'America/Santo_Domingo')::time >= o.hora_desde AND (now() AT TIME ZONE 'America/Santo_Domingo')::time < o.hora_hasta
                 ELSE (now() AT TIME ZONE 'America/Santo_Domingo')::time >= o.hora_desde OR (now() AT TIME ZONE 'America/Santo_Domingo')::time < o.hora_hasta END))
          AND (o.unidades_maximas IS NULL OR o.unidades_maximas > COALESCE((SELECT vv.unidades FROM v_oferta_vendidas vv WHERE vv.oferta_id = o.id AND vv.sucursal_id = $2), 0))
        ORDER BY o.prioridad DESC, o.termina_en LIMIT 20`, [empresaId, sucursal]);
    if (!of.rowCount) return [];
    const pr = await pool.query(
      `SELECT DISTINCT ON (a.oferta_id, pr.id) a.oferta_id AS "ofertaId", pr.id AS "presentacionId", p.id AS "productoId",
              TRIM(p.nombre || ' ' || pr.nombre) AS nombre,
              CASE WHEN p.imagen LIKE 'data:%' THEN '/imagenes/' || p.id::text || '?v=' || p.version::text ELSE p.imagen END AS imagen,
              (SELECT x.precio::text FROM precios x JOIN listas_precio lp ON lp.id = x.lista_precio_id AND lp.es_predeterminada
                WHERE x.presentacion_id = pr.id AND x.activo
                  AND (x.sucursal_id IS NULL OR (x.sucursal_id = $2 AND (SELECT precios_por_sucursal FROM empresas WHERE id = $3)))
                ORDER BY x.sucursal_id NULLS LAST LIMIT 1) AS precio
         FROM oferta_alcance a
         JOIN presentaciones pr ON pr.id = a.presentacion_id OR pr.producto_id = a.producto_id
              OR pr.producto_id IN (SELECT id FROM productos WHERE categoria_id = a.categoria_id AND a.categoria_id IS NOT NULL)
         JOIN productos p ON p.id = pr.producto_id AND p.activo AND p.empresa_id = $3
        WHERE a.oferta_id = ANY($1::uuid[]) AND a.activo
        ORDER BY a.oferta_id, pr.id`, [of.rows.map((o) => o.id), sucursal, empresaId]);
    const texto = (o: any) =>
      o.tipo === "PORCENTAJE" ? `${Number(o.valor)}% de descuento`
      : o.tipo === "PRECIO_ESPECIAL" ? `Precio especial ${formatoRD(o.valor)}`
      : o.tipo === "LLEVA_PAGA" ? `Lleve ${o.lleva}, pague ${o.paga}`
      : `Desde ${Number(o.cantidadMinima)} unidades a ${formatoRD(o.valor)} c/u`;
    const precioOferta = (o: any, precio: string | null) => {
      if (precio === null) return null;
      if (o.tipo === "PORCENTAJE") return (Number(precio) * (1 - Number(o.valor) / 100)).toFixed(2);
      if (o.tipo === "PRECIO_ESPECIAL" || o.tipo === "POR_VOLUMEN") return Number(o.valor).toFixed(2);
      return null; // lleve/pague: el precio unitario no cambia
    };
    return of.rows.map((o) => ({
      id: o.id, nombre: o.nombre, tipo: o.tipo, texto: texto(o), hasta: o.terminaEn,
      productos: pr.rows.filter((x) => x.ofertaId === o.id).slice(0, 30)
        .map((x) => ({ nombre: x.nombre, imagen: x.imagen, precio: x.precio, precioOferta: precioOferta(o, x.precio) })),
    })).filter((o) => o.productos.length);
  });

  /**
   * Las apps del verificador (Android y Windows) piden el PIN de un supervisor o administrador para cerrarse
   * o cambiar de servidor. La comprobación es aquí: la clave es la misma de FactPOS, no una aparte.
   * Máximo 10 PIN equivocados cada 10 minutos por equipo.
   */
  const fallos = new Map<string, { n: number; hasta: number }>();
  app.post("/verificador/autorizar-salida", async (req) => {
    const b = z.object({ pin: z.string().regex(/^\d{4,8}$/, "PIN de 4 a 8 dígitos") }).parse(req.body);
    const f = fallos.get(req.ip);
    if (f && f.hasta > Date.now() && f.n >= 10) throw new ErrorNegocio("Demasiados intentos: espere unos minutos", 429);
    const emp = await pool.query<{ id: string }>("SELECT id FROM empresas ORDER BY id LIMIT 2");
    if (emp.rowCount !== 1) throw new ErrorNegocio("Este servidor atiende varias empresas: no se puede validar el PIN", 409);
    try {
      const supervisor = await supervisorPorPin(pool, emp.rows[0].id, b.pin);
      fallos.delete(req.ip);
      return { ok: true, supervisor };
    } catch (e) {
      const ahora = Date.now();
      const previo = f && f.hasta > ahora ? f : { n: 0, hasta: ahora + 10 * 60_000 };
      fallos.set(req.ip, { n: previo.n + 1, hasta: previo.hasta });
      throw e;
    }
  });

  /** Descarga de las apps del verificador: este servidor no las tiene; las pide al portal, que las entrega desde GitHub. */
  app.get("/verificador/descarga/:so", async (req, rep) => {
    const { so } = z.object({ so: z.enum(["android", "windows", "admin-android", "admin-windows", "importador"]) }).parse(req.params);
    return rep.redirect(`${PORTAL_URL()}/licencias/descargar-verificador/${so}`);
  });

  /** Qué sucursal atiende este servidor y la marca de la empresa (la página la usa para no necesitar ?sucursal=). */
  /**
   * Última versión publicada de las apps (Android / Windows). Las apps la comparan con la suya y se actualizan solas;
   * la descarga sale de este mismo servidor (/verificador/descarga/:so). Se consulta al portal como máximo cada 10 min.
   */
  app.get("/verificador/actualizacion/:so", async (req) => {
    const { so } = z.object({ so: z.enum(["android", "windows"]) }).parse(req.params);
    // La app dice quién es y qué versión tiene: así la administración ve cuáles están desactualizadas (nunca estorba a la app)
    const q = z.object({ build: z.coerce.number().int().min(0).max(1_000_000).optional(), id: z.string().trim().min(1).max(64).optional(), equipo: z.string().trim().max(60).optional() }).safeParse(req.query);
    if (q.success && q.data.id && q.data.build !== undefined) {
      pool.query(
        `INSERT INTO verificador_equipos (id, so, equipo, build, sucursal_id, ultimo_contacto)
         VALUES ($1, $2, $3, $4, (SELECT id FROM sucursales WHERE activo ORDER BY nombre LIMIT 1), now())
         ON CONFLICT (id) DO UPDATE SET so = $2, equipo = $3, build = $4, ultimo_contacto = now()`,
        [q.data.id, so, q.data.equipo ?? "", q.data.build]).catch(() => {});
    }
    // «auto»: si las apps se actualizan solas; «orden»: marca de tiempo del último botón «Actualizar ahora» de la administración
    const aj = await pool.query<{ auto: unknown; orden: string | null }>(
      `SELECT m.verificador->'autoActualizar' AS auto, m.verificador->>'ordenActualizar' AS orden
         FROM configuracion_marca m JOIN sucursales s ON s.empresa_id = m.empresa_id WHERE s.activo ORDER BY s.nombre LIMIT 1`);
    const extra = { url: `/verificador/descarga/${so}`, auto: aj.rows[0]?.auto !== false, orden: Number(aj.rows[0]?.orden ?? 0) || 0 };
    const c = versionApps.get(so);
    if (c && c.hasta > Date.now()) return { version: c.version, ...extra };
    try {
      const r = await fetch(`${PORTAL_URL()}/licencias/version-verificador/${so}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(String(r.status));
      const { version } = (await r.json()) as { version: number };
      versionApps.set(so, { version, hasta: Date.now() + 10 * 60_000 });
      return { version, ...extra };
    } catch {
      if (c) return { version: c.version, ...extra };   // sin internet: la última conocida
      throw new ErrorNegocio("No se pudo consultar la versión de la app", 503);
    }
  });

  app.get("/verificador/config", async (req) => {
    const { sucursal } = z.object({ sucursal: z.string().uuid().optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT s.id AS "sucursalId", s.nombre, COALESCE(e.nombre_comercial, e.razon_social) AS empresa, m.logo,
              COALESCE(m.color_primario, '#c0362c') AS primario, CASE WHEN m.empresa_id IS NULL THEN '#10202e' ELSE m.color_secundario END AS secundario,
              COALESCE(m.verificador->'mostrarQr', 'true'::jsonb) <> 'false'::jsonb AS "mostrarQr", COALESCE(m.verificador->>'wifi', '') AS wifi, COALESCE((m.verificador->>'segundosOferta')::int, 7) AS "segundosOferta", $2::text AS arranque
         FROM sucursales s JOIN empresas e ON e.id = s.empresa_id LEFT JOIN configuracion_marca m ON m.empresa_id = e.id
        WHERE s.activo AND ($1::uuid IS NULL OR s.id = $1) ORDER BY s.nombre LIMIT 2`, [sucursal ?? null, ARRANQUE]);
    if (!r.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    // Con varias sucursales y sin indicar cuál, no se adivina
    if (!sucursal && r.rowCount > 1) throw new ErrorNegocio("Este servidor atiende varias sucursales: abra el verificador con ?sucursal=ID", 409);
    return r.rows[0];
  });

  /**
   * Copia del catálogo para que las apps del verificador sigan consultando precios sin conexión con el servidor:
   * solo códigos, nombre y precio al detalle (sin existencia ni ofertas). Las apps la piden de vez en cuando.
   */
  app.get("/verificador/catalogo", async (req) => {
    const { sucursal } = z.object({ sucursal: z.string().uuid().optional() }).parse(req.query);
    const s = await pool.query<{ id: string; empresa_id: string; almacen_id: string }>(
      `SELECT s.id, s.empresa_id, a.id AS almacen_id FROM sucursales s
         JOIN almacenes a ON a.sucursal_id = s.id AND a.es_principal
        WHERE s.activo AND ($1::uuid IS NULL OR s.id = $1) ORDER BY s.nombre LIMIT 2`, [sucursal ?? null]);
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    if (!sucursal && s.rowCount > 1) throw new ErrorNegocio("Este servidor atiende varias sucursales: indique ?sucursal=ID", 409);
    const { id: sucursalId, empresa_id: empresaId, almacen_id: almacenId } = s.rows[0];
    const prod = await pool.query<PresentacionVenta>(
      `${SQL_PRESENTACION} AND pr.id IN (SELECT presentacion_id FROM codigos_barra WHERE empresa_id = $1 AND activo)`,
      [empresaId, sucursalId, almacenId, null]);
    const cod = await pool.query<{ presentacionId: string; codigo: string }>(
      `SELECT presentacion_id AS "presentacionId", codigo FROM codigos_barra WHERE empresa_id = $1 AND activo`, [empresaId]);
    const codigos = new Map<string, string[]>();
    for (const c of cod.rows) { const l = codigos.get(c.presentacionId); if (l) l.push(c.codigo); else codigos.set(c.presentacionId, [c.codigo]); }
    return {
      generado: new Date().toISOString(), sucursalId,
      items: prod.rows.filter((p) => p.precio !== null && codigos.has(p.presentacionId)).map((p) => ({
        c: codigos.get(p.presentacionId), d: `${p.nombre} ${p.presentacion}`.trim(), p: p.precio,
        i: p.precioIncluyeItbis ? 1 : 0, z: p.esPesable ? 1 : 0,
      })),
    };
  });

  /** Ajustes del verificador de la empresa (hoy: mostrar u ocultar las ofertas). */
  const permisoPrecios = (req: unknown) => {
    const sesion = (req as { sesion?: SesionAdmin }).sesion;
    if (!sesion || !tienePermiso(sesion.p, "admin.precios")) throw new ErrorNegocio("Sin permiso", 403);
  };
  app.get("/central/verificador/ajustes", async (req) => {
    permisoPrecios(req);
    const empresaId = z.string().uuid().parse(req.headers["x-empresa-id"]);
    const r = await pool.query<{ o: unknown; q: unknown; cw: unknown; w: string | null; a: unknown; s: unknown; u: unknown; rm: unknown }>("SELECT verificador->'mostrarOfertas' AS o, verificador->'mostrarQr' AS q, verificador->>'wifi' AS w, verificador->'consultaWeb' AS cw, verificador->'autoActualizar' AS a, verificador->'segundosOferta' AS s, verificador->'ubicaciones' AS u, verificador->'radioM' AS rm FROM configuracion_marca WHERE empresa_id = $1", [empresaId]);
    return { ubicaciones: (r.rows[0]?.u && typeof r.rows[0].u === "object" ? r.rows[0].u : {}) as Record<string, { lat: number; lng: number }>, radioM: typeof r.rows[0]?.rm === "number" ? r.rows[0].rm : RADIO_CONSULTA_M, consultaWeb: r.rows[0]?.cw === true, mostrarOfertas: r.rows[0]?.o !== false, mostrarQr: r.rows[0]?.q !== false, wifi: (r.rows[0] as { w?: string | null } | undefined)?.w ?? "", autoActualizar: r.rows[0]?.a !== false, segundosOferta: typeof r.rows[0]?.s === "number" ? r.rows[0].s : 7 };
  });
  app.put("/central/verificador/ajustes", async (req) => {
    permisoPrecios(req);
    const empresaId = z.string().uuid().parse(req.headers["x-empresa-id"]);
    const b = z.object({ mostrarOfertas: z.boolean().optional(), mostrarQr: z.boolean().optional(), wifi: z.string().trim().max(40).optional(), autoActualizar: z.boolean().optional(), consultaWeb: z.boolean().optional(), segundosOferta: z.number().int().min(3).max(120).optional(), radioM: z.number().int().min(30).max(1000).optional() }).refine((x) => Object.values(x).some((v) => v !== undefined), "Nada que cambiar").parse(req.body);
    await pool.query(
      `INSERT INTO configuracion_marca (empresa_id, verificador) VALUES ($1, $2::jsonb)
       ON CONFLICT (empresa_id) DO UPDATE SET verificador = configuracion_marca.verificador || $2::jsonb`,
      [empresaId, JSON.stringify(b)]);
    return b;
  });

  /** Ubicación de la tienda para la consulta por internet: solo se responde a teléfonos que estén a menos del radio. */
  app.put("/central/verificador/ubicacion", async (req) => {
    permisoPrecios(req);
    const empresaId = z.string().uuid().parse(req.headers["x-empresa-id"]);
    const b = z.object({ sucursalId: z.string().uuid(), lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable() }).parse(req.body);
    const s = await pool.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2", [b.sucursalId, empresaId]);
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    await pool.query(
      `INSERT INTO configuracion_marca (empresa_id, verificador) VALUES ($1, '{}'::jsonb) ON CONFLICT (empresa_id) DO NOTHING`, [empresaId]);
    if (b.lat === null || b.lng === null) {
      await pool.query(`UPDATE configuracion_marca SET verificador = jsonb_set(verificador, '{ubicaciones}', COALESCE(verificador->'ubicaciones', '{}'::jsonb) - $2::text, true) WHERE empresa_id = $1`, [empresaId, b.sucursalId]);
    } else {
      await pool.query(
        `UPDATE configuracion_marca SET verificador = jsonb_set(verificador, '{ubicaciones}', COALESCE(verificador->'ubicaciones', '{}'::jsonb) || jsonb_build_object($2::text, jsonb_build_object('lat', $3::float8, 'lng', $4::float8)), true) WHERE empresa_id = $1`,
        [empresaId, b.sucursalId, b.lat, b.lng]);
    }
    return { ok: true };
  });

  /** Botón «Actualizar verificadores ahora»: las apps lo ven en menos de un minuto y se actualizan (si hay una versión nueva). */
  app.put("/central/verificador/actualizar-ahora", async (req) => {
    permisoPrecios(req);
    const empresaId = z.string().uuid().parse(req.headers["x-empresa-id"]);
    const orden = Date.now();
    await pool.query(
      `INSERT INTO configuracion_marca (empresa_id, verificador) VALUES ($1, jsonb_build_object('ordenActualizar', $2::bigint))
       ON CONFLICT (empresa_id) DO UPDATE SET verificador = configuracion_marca.verificador || jsonb_build_object('ordenActualizar', $2::bigint)`,
      [empresaId, orden]);
    versionApps.clear();   // vuelve a preguntar al portal cuál es la versión vigente
    return { orden };
  });

  /** Qué se consultó en los últimos días y qué códigos no tenían precio (para la administración). */
  app.get("/central/verificador/consultas", async (req) => {
    const sesion = (req as { sesion?: SesionAdmin }).sesion;
    if (!sesion || !tienePermiso(sesion.p, "admin.precios")) throw new ErrorNegocio("Sin permiso", 403);
    const q = z.object({ dias: z.coerce.number().int().min(1).max(90).default(30), sucursal: z.string().uuid().optional() }).parse(req.query);
    const empresaId = z.string().uuid().parse(req.headers["x-empresa-id"]);
    const base = `FROM verificador_consultas c JOIN sucursales s ON s.id = c.sucursal_id
                   WHERE s.empresa_id = $1 AND c.creado_en >= now() - make_interval(days => $2) AND ($3::uuid IS NULL OR c.sucursal_id = $3)`;
    const arg = [empresaId, q.dias, q.sucursal ?? null];
    const [tot, top, sin] = await Promise.all([
      pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT c.encontrado)::int AS "sinPrecio" ${base}`, arg),
      pool.query(`SELECT c.codigo, max(c.descripcion) AS descripcion, count(*)::int AS veces ${base} AND c.encontrado
                   GROUP BY c.codigo ORDER BY veces DESC LIMIT 15`, arg),
      pool.query(`SELECT c.codigo, count(*)::int AS veces, max(c.creado_en) AS ultima ${base} AND NOT c.encontrado
                   GROUP BY c.codigo ORDER BY veces DESC, ultima DESC LIMIT 25`, arg),
    ]);
    return { dias: q.dias, ...tot.rows[0], masConsultados: top.rows, sinPrecioLista: sin.rows };
  });

  /** Permite instalar el verificador en la pantalla de inicio de Android (pantalla completa, sin barra del navegador). */
  app.get("/verificador/manifest.webmanifest", async (_req, rep) => {
    rep.type("application/manifest+json");
    return { name: "Verificador de precios", short_name: "Precios", start_url: "/verificador", display: "fullscreen", orientation: "any", background_color: "#10202e", theme_color: "#10202e", icons: [] };
  });

  app.get("/verificador/:sucursalId/:codigo", async (req) => {
    const { sucursalId, codigo } = z
      .object({ sucursalId: z.string().uuid(), codigo: z.string().trim().min(1).max(30) })
      .parse(req.params);
    const canal = (req.query as { canal?: string }).canal === "movil" ? "movil" : "lector";

    const s = await pool.query<{ empresa_id: string; almacen_id: string }>(
      `SELECT s.empresa_id, a.id AS almacen_id FROM sucursales s
         JOIN almacenes a ON a.sucursal_id = s.id AND a.es_principal
        WHERE s.id = $1 AND s.activo`,
      [sucursalId],
    );
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    const { empresa_id: empresaId, almacen_id: almacenId } = s.rows[0];

    const buscar = async (cod: string, soloPesables = false) =>
      (await pool.query<PresentacionVenta>(
        `${SQL_PRESENTACION} ${soloPesables ? "AND p.es_pesable" : ""}
           AND pr.id = (SELECT presentacion_id FROM codigos_barra WHERE empresa_id = $1 AND codigo = ANY($5::text[]) AND activo
                         ORDER BY array_position($5::text[], codigo) LIMIT 1)`,
        [empresaId, sucursalId, almacenId, null, variantesCodigoBarra(cod)],
      )).rows[0];

    /** Anota la consulta (qué se consulta y qué códigos no tenían precio). Nunca estorba al cliente. */
    const anotar = (encontrado: boolean, descripcion: string | null) => {
      pool.query("INSERT INTO verificador_consultas (sucursal_id, codigo, encontrado, descripcion, canal) VALUES ($1, $2, $3, $4, $5)",
        [sucursalId, codigo, encontrado, descripcion, canal]).catch(() => {});
      if (Math.random() < 0.005) pool.query("DELETE FROM verificador_consultas WHERE creado_en < now() - interval '13 months'").catch(() => {});
    };

    let p = await buscar(codigo);
    let peso: number | null = null;
    if (!p) {
      const b = leerCodigoBalanza(codigo);
      if (b) {
        p = await buscar(b.codigoProducto, true);
        peso = b.valor;
      }
    }
    if (!p || p.precio === null) { anotar(false, null); throw new ErrorNegocio("Producto no encontrado", 404); }
    anotar(true, `${p.nombre} ${p.presentacion}`.trim());

    // Precios por nivel (para clientes por mayor)
    const niveles = await pool.query<{ nivel: number; lista: string; precio: string }>(
      `SELECT lp.nivel, lp.nombre AS lista, x.precio FROM precios x
         JOIN listas_precio lp ON lp.id = x.lista_precio_id
        WHERE x.presentacion_id = $1 AND x.activo AND lp.nivel IS NOT NULL
          AND (x.sucursal_id IS NULL OR (x.sucursal_id = $2 AND (SELECT precios_por_sucursal FROM empresas e JOIN sucursales s ON s.empresa_id = e.id WHERE s.id = $2)))
        ORDER BY lp.nivel, x.sucursal_id NULLS LAST`,
      [p.presentacionId, sucursalId],
    );
    const porNivel = new Map<number, { lista: string; precio: string }>();
    for (const n of niveles.rows) if (!porNivel.has(n.nivel)) porNivel.set(n.nivel, n);

    const ofertas = (await ofertasPara(pool, empresaId, sucursalId, p.listaPrecioId, [p])).get(p.presentacionId) ?? [];
    const cantidadPrueba = peso ?? 1;
    const oferta = mejorOferta(ofertas, { cantidad: cantidadPrueba, precioUnitario: p.precio });
    // Para 2x1, 3x2 y por volumen, se informa aunque con 1 unidad no aplique
    const promocion = oferta
      ? { nombre: oferta.nombre, precioOferta: oferta.precioEfectivo }
      : ofertas.length
        ? { nombre: ofertas.sort((a, b) => b.prioridad - a.prioridad)[0].nombre, precioOferta: null }
        : null;

    return {
      codigo,
      descripcion: `${p.nombre} ${p.presentacion}`.trim(),
      sku: canal === "movil" ? null : p.sku,
      precio: p.precio,
      precioTexto: formatoRD(p.precio),
      itbisIncluido: p.precioIncluyeItbis,
      pesable: p.esPesable,
      peso,
      importe: peso !== null ? formatoRD(Number(p.precio) * peso) : null,
      promocion,
      // Al celular del cliente nunca van los precios por nivel (mayoristas) ni la existencia
      niveles: canal === "movil" ? [] : [...porNivel.entries()].map(([nivel, v]) => ({ nivel, lista: v.lista, precio: v.precio })),
      disponible: canal === "movil" ? true : Number(p.existencia) > 0,
    };
  });
}
