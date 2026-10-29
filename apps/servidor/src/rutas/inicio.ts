import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { hashClave, claveSegura } from "../sesion.js";
import { hashPin } from "../autorizacion.js";

/**
 * PRIMER USO de una nube nueva (la de un cliente o el portal).
 *
 * Con la base recién creada no hay empresa ni usuarios. La pantalla de entrada
 * lo detecta (GET /central/inicio) y ofrece crear la empresa, su primera
 * sucursal y el usuario administrador (POST /central/inicio). Solo funciona
 * mientras la base está vacía y exige la CLAVE_ACCESO de esa instalación (la
 * conoce quien la configuró en Vercel), para que nadie más pueda reclamarla.
 */
export async function rutasInicio(app: FastifyInstance) {
  const vacia = async () => !(await pool.query("SELECT 1 FROM empresas LIMIT 1")).rowCount;

  app.get("/central/inicio", async () => ({ necesitaConfigurar: await vacia(), pideClave: !!process.env.CLAVE_ACCESO }));

  app.post("/central/inicio", async (req, rep) => {
    const b = z.object({
      claveAcceso: z.string().max(200).optional(),
      rnc: z.string().trim().regex(/^\d{9}(\d{2})?$/, "RNC de 9 u 11 dígitos"),
      razonSocial: z.string().trim().min(2).max(150),
      nombreComercial: z.string().trim().min(2).max(120),
      sucursal: z.string().trim().min(2).max(80).default("Principal"),
      nombre: z.string().trim().min(2).max(80),
      usuario: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, "Usuario: 3 a 30 letras, números, punto o guion"),
      clave: z.string().min(8).max(200),
      pin: z.string().regex(/^\d{4,6}$/, "PIN de 4 a 6 números").optional(),
    }).parse(req.body);

    const esperada = process.env.CLAVE_ACCESO;
    if (esperada) {
      const h = (t: string) => createHash("sha256").update(t).digest();
      if (!b.claveAcceso || !timingSafeEqual(h(b.claveAcceso), h(esperada))) {
        throw new ErrorNegocio("La clave de acceso de la instalación no es correcta (es la variable CLAVE_ACCESO de Vercel)", 401);
      }
    }
    const debil = claveSegura(b.clave);
    if (debil) throw new ErrorNegocio(debil);

    const r = await enTransaccion(async (c) => {
      // Bloqueo: solo una configuración inicial, aunque lleguen dos a la vez
      await c.query("LOCK TABLE empresas IN EXCLUSIVE MODE");
      if ((await c.query("SELECT 1 FROM empresas LIMIT 1")).rowCount) throw new ErrorNegocio("Esta instalación ya está configurada: entre con su usuario", 409);
      const empresa = uuidv7(), suc = uuidv7(), alm = uuidv7(), caja = uuidv7();
      const rolAdmin = uuidv7(), rolSup = uuidv7(), rolCaj = uuidv7(), admin = uuidv7();
      const q = (sql: string, p: unknown[]) => c.query(sql, p);
      await q("INSERT INTO empresas (id, rnc, razon_social, nombre_comercial) VALUES ($1,$2,$3,$4)", [empresa, b.rnc, b.razonSocial, b.nombreComercial]);
      await q("INSERT INTO sucursales (id, empresa_id, codigo, nombre) VALUES ($1,$2,'S01',$3)", [suc, empresa, b.sucursal]);
      await q("INSERT INTO almacenes (id, sucursal_id, nombre, es_principal) VALUES ($1,$2,'Piso de venta',true)", [alm, suc]);
      await q("INSERT INTO cajas (id, sucursal_id, numero, nombre, almacen_id) VALUES ($1,$2,1,'Caja 1',$3)", [caja, suc, alm]);
      await q("INSERT INTO configuracion_sucursal (sucursal_id, modulos) VALUES ($1, '{\"delivery\":{\"activo\":false}}')", [suc]);
      await q(`INSERT INTO roles (id, empresa_id, nombre, permisos) VALUES
               ($1,$4,'Administrador','{*}'),
               ($2,$4,'Supervisor','{venta.crear,venta.descuento,venta.anular,venta.corregir,cliente.precio,caja.retiro,caja.gasto,cxc.abono,turno.abrir}'),
               ($3,$4,'Cajero','{venta.crear,turno.abrir,cxc.abono}')`, [rolAdmin, rolSup, rolCaj, empresa]);
      await q("INSERT INTO usuarios (id, empresa_id, rol_id, nombre, usuario, clave_hash, pin_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [admin, empresa, rolAdmin, b.nombre, b.usuario, await hashClave(b.clave), b.pin ? hashPin(empresa, b.pin) : null]);
      await q(`INSERT INTO impuestos (id, empresa_id, nombre, tipo, tasa) VALUES
               ($1,$4,'ITBIS 18%','ITBIS',0.18), ($2,$4,'ITBIS 16%','ITBIS',0.16), ($3,$4,'Exento','ITBIS',0)`, [uuidv7(), uuidv7(), uuidv7(), empresa]);
      await q(`INSERT INTO listas_precio (id, empresa_id, nombre, nivel, es_predeterminada) VALUES
               ($1,$4,'Precio 1 · Detalle',1,true), ($2,$4,'Precio 2 · Mayorista',2,false), ($3,$4,'Precio 3 · Distribuidor',3,false)`,
        [uuidv7(), uuidv7(), uuidv7(), empresa]);
      return { empresa: b.nombreComercial, usuario: b.usuario };
    });
    rep.code(201);
    return r;
  });
}
