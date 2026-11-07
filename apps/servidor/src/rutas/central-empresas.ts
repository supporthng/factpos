import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { config } from "../config.js";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { crearToken, puedeAdministrar, verificarClave } from "../sesion.js";
import type { PoolClient } from "pg";
import { sesionAdmin } from "./sesion.js";

/**
 * Empresas enlazadas: cada RNC es una empresa aparte (catálogo, usuarios, NCF y reportes propios).
 * Las del mismo grupo las maneja el mismo administrador, que cambia de una a otra sin volver a entrar.
 */
const uuid = z.string().uuid();

const grupoDe = async (empresaId: string) =>
  (await pool.query<{ g: string }>("SELECT COALESCE(grupo_id, id) AS g FROM empresas WHERE id = $1", [empresaId])).rows[0]?.g ?? empresaId;

export async function rutasCentralEmpresas(app: FastifyInstance) {
  /** Empresas del grupo de la sesión. */
  app.get("/central/empresas", async (req) => {
    const s = sesionAdmin(req);
    const g = await grupoDe(s.e);
    const r = await pool.query(
      `SELECT id, rnc, razon_social AS "razonSocial", COALESCE(nombre_comercial, razon_social) AS nombre, id = $2 AS actual
         FROM empresas WHERE COALESCE(grupo_id, id) = $1 AND activo ORDER BY (id = $2) DESC, nombre_comercial`, [g, s.e]);
    return r.rows;
  });

  /** Crea otra empresa (otro RNC) en el grupo, con su sucursal, caja, roles, impuestos y un administrador copia del actual. */
  app.post("/central/empresas", async (req, rep) => {
    if (config.modo === "sucursal" || config.modo === "portal") throw new ErrorNegocio("Las empresas se crean desde la central", 409);
    const s = sesionAdmin(req);
    const b = z.object({
      rnc: z.string().trim().regex(/^\d{9}$|^\d{11}$/, "RNC de 9 dígitos (o cédula de 11)"),
      razonSocial: z.string().trim().min(2).max(150),
      nombreComercial: z.string().trim().min(2).max(120),
      sucursal: z.string().trim().min(2).max(80).default("Principal"),
      clave: z.string().min(1).max(200),
    }).parse(req.body);
    const me = (await pool.query<{ usuario: string; nombre: string; clave_hash: string }>("SELECT usuario, nombre, clave_hash FROM usuarios WHERE id = $1", [s.u])).rows[0];
    if (!me || !(await verificarClave(b.clave, me.clave_hash))) throw new ErrorNegocio("La contraseña no es correcta", 403);
    if ((await pool.query("SELECT 1 FROM empresas WHERE rnc = $1", [b.rnc])).rowCount) throw new ErrorNegocio("Ya existe una empresa con ese RNC", 409);
    const grupo = await grupoDe(s.e);
    const r = await enTransaccion(async (c) => {
      const q = (sql: string, p: unknown[]) => c.query(sql, p);
      await q("UPDATE empresas SET grupo_id = $1 WHERE id = $1 AND grupo_id IS NULL", [grupo]);
      const empresa = uuidv7(), suc = uuidv7(), alm = uuidv7(), caja = uuidv7();
      const rolAdmin = uuidv7(), rolSup = uuidv7(), rolCaj = uuidv7(), admin = uuidv7();
      await q("INSERT INTO empresas (id, rnc, razon_social, nombre_comercial, grupo_id) VALUES ($1,$2,$3,$4,$5)", [empresa, b.rnc, b.razonSocial, b.nombreComercial, grupo]);
      await q("INSERT INTO sucursales (id, empresa_id, codigo, nombre) VALUES ($1,$2,'S01',$3)", [suc, empresa, b.sucursal]);
      await q("INSERT INTO almacenes (id, sucursal_id, nombre, es_principal) VALUES ($1,$2,'Piso de venta',true)", [alm, suc]);
      await q("INSERT INTO cajas (id, sucursal_id, numero, nombre, almacen_id) VALUES ($1,$2,1,'Caja 1',$3)", [caja, suc, alm]);
      await q("INSERT INTO configuracion_sucursal (sucursal_id, modulos) VALUES ($1, '{\"delivery\":{\"activo\":false}}')", [suc]);
      await q(`INSERT INTO roles (id, empresa_id, nombre, permisos) VALUES
               ($1,$4,'Administrador','{*}'),
               ($2,$4,'Supervisor','{venta.crear,venta.descuento,venta.anular,venta.corregir,cliente.precio,caja.retiro,caja.gasto,cxc.abono,turno.abrir}'),
               ($3,$4,'Cajero','{venta.crear,turno.abrir,cxc.abono}')`, [rolAdmin, rolSup, rolCaj, empresa]);
      await q("INSERT INTO usuarios (id, empresa_id, rol_id, nombre, usuario, clave_hash) VALUES ($1,$2,$3,$4,$5,$6)", [admin, empresa, rolAdmin, me.nombre, me.usuario, me.clave_hash]);
      await q(`INSERT INTO impuestos (id, empresa_id, nombre, tipo, tasa) VALUES
               ($1,$4,'ITBIS 18%','ITBIS',0.18), ($2,$4,'ITBIS 16%','ITBIS',0.16), ($3,$4,'Exento','ITBIS',0)`, [uuidv7(), uuidv7(), uuidv7(), empresa]);
      await q(`INSERT INTO listas_precio (id, empresa_id, nombre, nivel, es_predeterminada) VALUES
               ($1,$4,'Precio 1 · Detalle',1,true), ($2,$4,'Precio 2 · Mayorista',2,false), ($3,$4,'Precio 3 · Distribuidor',3,false)`, [uuidv7(), uuidv7(), uuidv7(), empresa]);
      return { id: empresa, nombre: b.nombreComercial };
    });
    rep.code(201);
    return r;
  });

  /** Lista de puesta en marcha de la empresa activa: qué le falta antes de poder facturar. */
  app.get("/central/empresas/puesta-en-marcha", async (req) => {
    const e = sesionAdmin(req).e;
    const un = async <T>(sql: string) => (await pool.query<T>(sql, [e])).rows[0];
    const [fis, cert, aut, suc, cajas, prod, usu] = await Promise.all([
      un<{ direccion_emisor: string; municipio: string | null; provincia: string | null; ambiente: string; transmisor: string; pse_url: string | null }>(
        "SELECT direccion_emisor, municipio, provincia, ambiente, transmisor, pse_url FROM configuracion_fiscal WHERE empresa_id = $1"),
      un<{ vence: Date; titular: string }>("SELECT vence, titular FROM certificados_digitales WHERE empresa_id = $1 AND activo ORDER BY subido_en DESC LIMIT 1"),
      un<{ n: string; vigentes: string }>("SELECT count(*) AS n, count(*) FILTER (WHERE vence_en >= current_date) AS vigentes FROM ecf_autorizaciones WHERE empresa_id = $1"),
      un<{ n: string; en_linea: string }>(
        `SELECT count(*) AS n, count(*) FILTER (WHERE GREATEST(y.ultima_subida, y.ultima_bajada) > now() - interval '2 minutes') AS en_linea
           FROM sucursales s LEFT JOIN sync_sucursales y ON y.sucursal_id = s.id WHERE s.empresa_id = $1 AND s.activo`),
      un<{ n: string }>("SELECT count(*) AS n FROM cajas c JOIN sucursales s ON s.id = c.sucursal_id WHERE s.empresa_id = $1 AND c.activo AND s.activo"),
      un<{ n: string }>("SELECT count(*) AS n FROM productos WHERE empresa_id = $1 AND activo"),
      un<{ n: string }>("SELECT count(*) AS n FROM usuarios WHERE empresa_id = $1 AND activo AND pin_hash IS NOT NULL"),
    ]);
    type Paso = { id: string; titulo: string; ok: boolean; detalle: string; ir?: string };
    const dias = cert ? Math.floor((new Date(cert.vence).getTime() - Date.now()) / 86400e3) : 0;
    const pasos: Paso[] = [
      { id: "datos", titulo: "Datos fiscales del emisor", ok: !!fis?.direccion_emisor?.trim() && !!fis?.municipio && !!fis?.provincia,
        detalle: fis?.direccion_emisor?.trim() ? "Dirección, municipio y provincia" : "Falta la dirección, el municipio o la provincia del emisor", ir: "fiscal" },
      { id: "certificado", titulo: "Certificado digital (.p12) de este RNC", ok: !!cert && dias >= 0,
        detalle: !cert ? "No hay certificado cargado" : dias < 0 ? `Venció hace ${-dias} días` : `${cert.titular} · vence en ${dias} días`, ir: "fiscal" },
      { id: "rangos", titulo: "Rangos de e-NCF autorizados por la DGII", ok: Number(aut?.vigentes ?? 0) > 0,
        detalle: Number(aut?.n ?? 0) === 0 ? "No hay rangos cargados" : Number(aut?.vigentes) === 0 ? "Todos los rangos están vencidos" : `${aut?.vigentes} rangos vigentes`, ir: "fiscal" },
      { id: "transmisor", titulo: "Envío a la DGII o proveedor e-CF", ok: !!fis && fis.transmisor !== "SIMULADO" && (fis.transmisor !== "PSE" || !!fis.pse_url),
        detalle: !fis || fis.transmisor === "SIMULADO" ? "Está en modo simulado: no se envía nada a la DGII" : fis.transmisor === "PSE" && !fis.pse_url ? "Falta la dirección del proveedor" : `${fis.transmisor === "PSE" ? "Proveedor e-CF" : "DGII directo"} · ambiente ${fis.ambiente}`, ir: "fiscal" },
      { id: "servidor", titulo: "Servidor de la tienda conectado", ok: Number(suc?.en_linea ?? 0) > 0,
        detalle: Number(suc?.en_linea ?? 0) > 0 ? `${suc?.en_linea} de ${suc?.n} sucursales en línea` : "Ningún servidor de tienda se ha comunicado en los últimos 2 minutos", ir: "sucursales" },
      { id: "cajas", titulo: "Cajas creadas", ok: Number(cajas?.n ?? 0) > 0, detalle: `${cajas?.n ?? 0} cajas activas`, ir: "sucursales" },
      { id: "productos", titulo: "Productos cargados", ok: Number(prod?.n ?? 0) > 0, detalle: `${prod?.n ?? 0} productos activos`, ir: "productos" },
      { id: "usuarios", titulo: "Usuarios con PIN para la caja", ok: Number(usu?.n ?? 0) > 0, detalle: `${usu?.n ?? 0} usuarios con PIN`, ir: "usuarios" },
    ];
    return { pasos, listos: pasos.filter((x) => x.ok).length, total: pasos.length };
  });

  /** Pasa a otra empresa del grupo: devuelve una sesión nueva como administrador de esa empresa. */
  app.post("/central/empresas/cambiar", async (req) => {
    const s = sesionAdmin(req);
    const { empresaId } = z.object({ empresaId: uuid }).parse(req.body);
    const g = await grupoDe(s.e);
    const me = (await pool.query<{ usuario: string }>("SELECT usuario FROM usuarios WHERE id = $1", [s.u])).rows[0];
    const r = await pool.query<{ id: string; nombre: string; permisos: string[]; empresa: string }>(
      `SELECT u.id, u.nombre, ro.permisos, COALESCE(e.nombre_comercial, e.razon_social) AS empresa
         FROM usuarios u JOIN roles ro ON ro.id = u.rol_id JOIN empresas e ON e.id = u.empresa_id
        WHERE e.id = $1 AND COALESCE(e.grupo_id, e.id) = $2 AND e.activo AND u.activo AND lower(u.usuario) = lower($3)`, [empresaId, g, me?.usuario ?? ""]);
    const u = r.rows[0];
    if (!u) throw new ErrorNegocio("Su usuario no existe en esa empresa (o no pertenece a su grupo)", 403);
    if (!puedeAdministrar(u.permisos)) throw new ErrorNegocio("Su usuario no tiene acceso a la administración de esa empresa", 403);
    const token = crearToken({ t: "admin", u: u.id, e: empresaId, n: u.nombre, p: u.permisos }, 12);
    return { token, usuario: { id: u.id, nombre: u.nombre, permisos: u.permisos }, empresa: { id: empresaId, nombre: u.empresa } };
  });

  /** Ventas de todas las empresas del grupo en un periodo, por sucursal, con el periodo anterior equivalente. Solo administradores completos. */
  app.get("/central/empresas/consolidado", async (req) => {
    const s = sesionAdmin(req);
    if (!s.p.includes("*")) throw new ErrorNegocio("Solo un administrador completo puede ver el consolidado", 403);
    const { periodo } = z.object({ periodo: z.enum(["hoy", "ayer", "semana", "semanaPasada", "mes"]).default("hoy") }).parse(req.query);
    const g = await grupoDe(s.e);
    const r = await pool.query(
      `WITH h AS (SELECT (now() AT TIME ZONE 'America/Santo_Domingo')::date AS hoy),
            r AS (SELECT hoy,
                    CASE $2 WHEN 'hoy' THEN hoy WHEN 'ayer' THEN hoy - 1 WHEN 'semana' THEN date_trunc('week', hoy)::date
                            WHEN 'semanaPasada' THEN date_trunc('week', hoy)::date - 7 ELSE date_trunc('month', hoy)::date END AS desde,
                    CASE $2 WHEN 'hoy' THEN hoy WHEN 'ayer' THEN hoy - 1 WHEN 'semana' THEN hoy
                            WHEN 'semanaPasada' THEN date_trunc('week', hoy)::date - 1 ELSE hoy END AS hasta FROM h),
            a AS (SELECT desde, hasta,
                    CASE WHEN $2 = 'mes' THEN (desde - interval '1 month')::date WHEN $2 IN ('semana','semanaPasada') THEN desde - 7 ELSE desde - 1 END AS pdesde,
                    CASE WHEN $2 = 'mes' THEN LEAST((hasta - interval '1 month')::date, (desde - 1)) WHEN $2 IN ('semana','semanaPasada') THEN hasta - 7 ELSE hasta - 1 END AS phasta FROM r)
       SELECT e.id AS "empresaId", COALESCE(e.nombre_comercial, e.razon_social) AS empresa, e.rnc, sc.id AS "sucursalId", sc.nombre AS sucursal,
              COALESCE(SUM(v.venta_total) FILTER (WHERE v.fecha BETWEEN a.desde AND a.hasta), 0)::text AS venta,
              COALESCE(SUM(v.transacciones) FILTER (WHERE v.fecha BETWEEN a.desde AND a.hasta), 0)::int AS transacciones,
              COALESCE(SUM(v.venta_total) FILTER (WHERE v.fecha BETWEEN a.pdesde AND a.phasta), 0)::text AS "ventaAnterior"
         FROM a CROSS JOIN empresas e JOIN sucursales sc ON sc.empresa_id = e.id AND sc.activo
         LEFT JOIN rpt_ventas_sucursal v ON v.sucursal_id = sc.id AND v.fecha >= a.pdesde
        WHERE COALESCE(e.grupo_id, e.id) = $1 AND e.activo
        GROUP BY e.id, e.nombre_comercial, e.razon_social, e.rnc, sc.id, sc.nombre
        ORDER BY empresa, sucursal`, [g, periodo]);
    return r.rows;
  });

  /**
   * Copia el catálogo (categorías, productos, presentaciones, códigos de barra y precios) de otra empresa del grupo
   * a la empresa actual. No copia existencias, costos ni historial. Los SKU que ya existan en la empresa actual se omiten.
   */
  app.post("/central/empresas/copiar-catalogo", async (req) => {
    const s = sesionAdmin(req);
    if (!s.p.includes("*")) throw new ErrorNegocio("Solo un administrador completo puede copiar catálogos", 403);
    const b = z.object({ origenId: uuid, clave: z.string().min(1).max(200), precios: z.boolean().default(true) }).parse(req.body);
    if (b.origenId === s.e) throw new ErrorNegocio("Elija otra empresa como origen");
    const g = await grupoDe(s.e);
    if ((await grupoDe(b.origenId)) !== g) throw new ErrorNegocio("Esa empresa no pertenece a su grupo", 403);
    const me = (await pool.query<{ clave_hash: string }>("SELECT clave_hash FROM usuarios WHERE id = $1", [s.u])).rows[0];
    if (!me || !(await verificarClave(b.clave, me.clave_hash))) throw new ErrorNegocio("La contraseña no es correcta", 403);
    const o = b.origenId, d = s.e;
    return enTransaccion(async (c: PoolClient) => {
      const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
      const cols = async (t: string, quitar: string[]) =>
        (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`, [t]))
          .rows.map((x) => x.column_name as string).filter((x) => !quitar.includes(x));
      // Impuestos que falten en el destino (se comparan por tipo y tasa)
      await q(`INSERT INTO impuestos (id, empresa_id, nombre, tipo, tasa)
               SELECT gen_random_uuid(), $2, i.nombre, i.tipo, i.tasa FROM impuestos i WHERE i.empresa_id = $1
                AND NOT EXISTS (SELECT 1 FROM impuestos x WHERE x.empresa_id = $2 AND x.tipo = i.tipo AND x.tasa = i.tasa)`, [o, d]);
      await q(`CREATE TEMP TABLE m_imp ON COMMIT DROP AS
               SELECT i.id AS viejo, (SELECT x.id FROM impuestos x WHERE x.empresa_id = $2 AND x.tipo = i.tipo AND x.tasa = i.tasa ORDER BY x.id LIMIT 1) AS nuevo
                 FROM impuestos i WHERE i.empresa_id = $1`, [o, d]);
      // Categorías: se reutilizan las del mismo nombre
      await q(`CREATE TEMP TABLE m_cat ON COMMIT DROP AS
               SELECT c.id AS viejo, COALESCE((SELECT x.id FROM categorias x WHERE x.empresa_id = $2 AND lower(x.nombre) = lower(c.nombre) LIMIT 1), gen_random_uuid()) AS nuevo,
                      EXISTS (SELECT 1 FROM categorias x WHERE x.empresa_id = $2 AND lower(x.nombre) = lower(c.nombre)) AS existe
                 FROM categorias c WHERE c.empresa_id = $1`, [o, d]);
      const cc = await cols("categorias", ["id", "empresa_id", "padre_id", "version", "actualizado_en"]);
      const nCat = (await q(`INSERT INTO categorias (id, empresa_id, ${cc.join(",")})
               SELECT m.nuevo, $2, ${cc.map((x) => "c." + x).join(",")} FROM categorias c JOIN m_cat m ON m.viejo = c.id WHERE c.empresa_id = $1 AND NOT m.existe`, [o, d])).rowCount ?? 0;
      await q(`UPDATE categorias n SET padre_id = mp.nuevo FROM categorias c JOIN m_cat m ON m.viejo = c.id JOIN m_cat mp ON mp.viejo = c.padre_id
                WHERE n.id = m.nuevo AND NOT m.existe AND c.padre_id IS NOT NULL`);
      // Productos
      await q(`CREATE TEMP TABLE m_prod ON COMMIT DROP AS
               SELECT p.id AS viejo, gen_random_uuid() AS nuevo FROM productos p
                WHERE p.empresa_id = $1 AND p.activo AND NOT EXISTS (SELECT 1 FROM productos x WHERE x.empresa_id = $2 AND x.sku = p.sku)`, [o, d]);
      const pc = await cols("productos", ["id", "empresa_id", "categoria_id", "impuesto_id", "isc_id", "costo_promedio", "version", "actualizado_en"]);
      const nProd = (await q(`INSERT INTO productos (id, empresa_id, categoria_id, impuesto_id, isc_id, costo_promedio, ${pc.join(",")})
               SELECT m.nuevo, $2, (SELECT nuevo FROM m_cat WHERE viejo = p.categoria_id), (SELECT nuevo FROM m_imp WHERE viejo = p.impuesto_id),
                      (SELECT nuevo FROM m_imp WHERE viejo = p.isc_id), 0, ${pc.map((x) => "p." + x).join(",")}
                 FROM productos p JOIN m_prod m ON m.viejo = p.id`, [o, d])).rowCount ?? 0;
      await q(`CREATE TEMP TABLE m_pres ON COMMIT DROP AS SELECT r.id AS viejo, gen_random_uuid() AS nuevo FROM presentaciones r JOIN m_prod m ON m.viejo = r.producto_id`);
      const rc = await cols("presentaciones", ["id", "producto_id", "version", "actualizado_en"]);
      await q(`INSERT INTO presentaciones (id, producto_id, ${rc.join(",")})
               SELECT mr.nuevo, m.nuevo, ${rc.map((x) => "r." + x).join(",")} FROM presentaciones r JOIN m_pres mr ON mr.viejo = r.id JOIN m_prod m ON m.viejo = r.producto_id`);
      const bc = await cols("codigos_barra", ["empresa_id", "presentacion_id", "version", "actualizado_en"]);
      const nCod = (await q(`INSERT INTO codigos_barra (empresa_id, presentacion_id, ${bc.join(",")})
               SELECT $2, mr.nuevo, ${bc.map((x) => "b." + x).join(",")} FROM codigos_barra b JOIN m_pres mr ON mr.viejo = b.presentacion_id WHERE b.empresa_id = $1
               ON CONFLICT DO NOTHING`, [o, d])).rowCount ?? 0;
      let nPre = 0;
      if (b.precios) {
        nPre = (await q(`INSERT INTO precios (id, lista_precio_id, presentacion_id, sucursal_id, precio, porcentaje, base, activo)
               SELECT gen_random_uuid(), ld.id, mr.nuevo, NULL, pr.precio, pr.porcentaje, pr.base, pr.activo
                 FROM precios pr JOIN listas_precio lo ON lo.id = pr.lista_precio_id AND lo.empresa_id = $1
                 JOIN listas_precio ld ON ld.empresa_id = $2 AND ld.nivel = lo.nivel
                 JOIN m_pres mr ON mr.viejo = pr.presentacion_id
                WHERE pr.sucursal_id IS NULL AND lo.nivel IS NOT NULL`, [o, d])).rowCount ?? 0;
      }
      const omitidos = ((await q("SELECT COUNT(*)::int AS n FROM productos WHERE empresa_id = $1 AND activo", [o])).rows[0].n as number) - nProd;
      return { productos: nProd, omitidos, categorias: nCat, codigos: nCod, precios: nPre };
    });
  });
}
