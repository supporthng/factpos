import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { config } from "../config.js";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { crearToken, puedeAdministrar, verificarClave } from "../sesion.js";
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
}
