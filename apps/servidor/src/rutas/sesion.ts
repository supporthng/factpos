import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { hashPin } from "../autorizacion.js";
import { esCodigoRecuperacion, huellaRecuperacion, nuevoSecreto, nuevosCodigosRecuperacion, uriOtp, verificarCodigo } from "../doble-factor.js";
import { contextoCaja } from "../contexto.js";
import {
  PERMISOS, claveSegura, crearToken, hashClave, leerToken, puedeAdministrar, tienePermiso, verificarClave, type SesionAdmin,
} from "../sesion.js";

const uuid = z.string().uuid();
const pinValido = z.string().regex(/^\d{4,6}$/, "El PIN debe tener de 4 a 6 números");

/** Freno a quien prueba contraseñas: 5 intentos fallidos y espera 5 minutos. */
const fallos = new Map<string, { n: number; hasta: number }>();
function frenar(clave: string, max = 5) {
  const f = fallos.get(clave);
  if (f && f.n >= max && f.hasta > Date.now()) {
    throw new ErrorNegocio(`Demasiados intentos. Espere ${Math.ceil((f.hasta - Date.now()) / 60000)} minuto(s)`, 429);
  }
}
function fallo(clave: string, minutos = 5) {
  const f = fallos.get(clave);
  const n = f && f.hasta > Date.now() ? f.n + 1 : 1;
  fallos.set(clave, { n, hasta: Date.now() + minutos * 60_000 });
}

export const sesionAdmin = (req: FastifyRequest) => (req as FastifyRequest & { sesion?: SesionAdmin }).sesion!;

// ===================================================================== Caja
export async function rutasSesionCaja(app: FastifyInstance) {
  /** El cajero entra con su PIN; la caja recibe una sesión firmada para esa caja. */
  app.post("/cajas/:cajaId/entrar", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const b = z.object({ usuarioId: uuid, pin: z.string().max(10) }).parse(req.body);
    const llave = `caja:${cajaId}:${b.usuarioId}`;
    frenar(llave);
    const ctx = await contextoCaja(cajaId);
    const r = await pool.query<{ id: string; nombre: string; pin_hash: string | null; permisos: string[]; sucursales: string[] | null }>(
      `SELECT u.id, u.nombre, u.pin_hash, ro.permisos, u.sucursales FROM usuarios u JOIN roles ro ON ro.id = u.rol_id
        WHERE u.id = $1 AND u.empresa_id = $2 AND u.activo`,
      [b.usuarioId, ctx.empresaId],
    );
    const u = r.rows[0];
    if (!u) throw new ErrorNegocio("Usuario no encontrado", 404);
    if (!u.pin_hash) throw new ErrorNegocio("Usted no tiene PIN todavía: pídale al administrador que se lo asigne", 403);
    if (u.pin_hash !== hashPin(ctx.empresaId, b.pin)) {
      fallo(llave, 1);
      throw new ErrorNegocio("PIN incorrecto", 401);
    }
    if (u.sucursales && !u.sucursales.includes(ctx.sucursalId)) throw new ErrorNegocio(`${u.nombre} no tiene acceso a esta sucursal`, 403);
    if (!tienePermiso(u.permisos, "venta.crear")) throw new ErrorNegocio(`${u.nombre} no tiene permiso para vender en caja`, 403);
    fallos.delete(llave);
    const token = crearToken({ t: "caja", u: u.id, e: ctx.empresaId, c: cajaId, n: u.nombre, p: u.permisos }, 16);
    return { token, usuario: { id: u.id, nombre: u.nombre } };
  });
}

// ===================================================================== Administración
export async function rutasSesionCentral(app: FastifyInstance) {
  /** Usuario y contraseña. Si el mismo usuario existe en dos empresas, se pide el RNC. */
  app.post("/central/entrar", async (req) => {
    const b = z.object({ usuario: z.string().trim().min(1).max(50), clave: z.string().min(1).max(200), rnc: z.string().trim().max(11).optional(), codigo: z.string().trim().max(20).optional() }).parse(req.body);
    const usuario = b.usuario.toLowerCase();
    const llave = `admin:${usuario}`;
    const ip = `ip:${String(req.headers["cf-connecting-ip"] ?? req.ip)}`;
    frenar(llave);
    frenar(ip, 20); // quien prueba muchos usuarios desde un mismo lugar
    const r = await pool.query<{ id: string; nombre: string; empresa_id: string; empresa: string; clave_hash: string; permisos: string[] }>(
      `SELECT u.id, u.nombre, u.empresa_id, e.nombre_comercial AS empresa, u.clave_hash, ro.permisos
         FROM usuarios u JOIN roles ro ON ro.id = u.rol_id JOIN empresas e ON e.id = u.empresa_id
        WHERE lower(u.usuario) = $1 AND u.activo AND ($2::text IS NULL OR e.rnc = $2)`,
      [usuario, b.rnc?.replace(/\D/g, "") || null],
    );
    if (r.rowCount! > 1) throw new ErrorNegocio("Ese usuario existe en varias empresas: escriba también el RNC de la empresa", 409);
    const u = r.rows[0];
    if (!u || !(await verificarClave(b.clave, u.clave_hash))) {
      fallo(llave); fallo(ip, 15);
      throw new ErrorNegocio("Usuario o contraseña incorrectos", 401);
    }
    if (!puedeAdministrar(u.permisos)) throw new ErrorNegocio(`${u.nombre} no tiene acceso a la administración`, 403);
    // Verificación en dos pasos (si el usuario la activó)
    const dos = (await pool.query<{ secreto: string; recuperacion: string[]; ultimo_paso: string }>(
      "SELECT secreto, recuperacion, ultimo_paso FROM usuarios_2fa WHERE usuario_id = $1 AND activo", [u.id])
      .catch(() => ({ rows: [] as { secreto: string; recuperacion: string[]; ultimo_paso: string }[] }))).rows[0];
    if (dos) {
      const c = (b.codigo ?? "").trim();
      if (!c) return { requiere2fa: true };
      let ok = false;
      if (esCodigoRecuperacion(c) && !/^\d{6}$/.test(c.replace(/\s/g, ""))) {
        const h = huellaRecuperacion(c);
        if (dos.recuperacion.includes(h)) {
          await pool.query("UPDATE usuarios_2fa SET recuperacion = array_remove(recuperacion, $2) WHERE usuario_id = $1", [u.id, h]);
          ok = true;
        }
      } else {
        const paso = verificarCodigo(dos.secreto, c);
        if (paso !== null && paso > Number(dos.ultimo_paso)) {
          ok = true;
          await pool.query("UPDATE usuarios_2fa SET ultimo_paso = $2 WHERE usuario_id = $1", [u.id, paso]);
        }
      }
      if (!ok) { fallo(llave); fallo(ip, 15); throw new ErrorNegocio("Código de verificación incorrecto", 401); }
    }
    fallos.delete(llave);
    const token = crearToken({ t: "admin", u: u.id, e: u.empresa_id, n: u.nombre, p: u.permisos }, 12);
    return { token, usuario: { id: u.id, nombre: u.nombre, permisos: u.permisos }, empresa: { id: u.empresa_id, nombre: u.empresa } };
  });

  /** Datos de la sesión actual (al abrir la administración). Si el rol cambió, se refleja. */
  app.get("/central/sesion", async (req) => {
    const s = sesionAdmin(req);
    const r = await pool.query(
      `SELECT u.id, u.nombre, ro.permisos, u.sucursales, e.id AS "empresaId", e.nombre_comercial AS empresa
         FROM usuarios u JOIN roles ro ON ro.id = u.rol_id JOIN empresas e ON e.id = u.empresa_id
        WHERE u.id = $1 AND u.activo`,
      [s.u],
    );
    if (!r.rowCount) throw new ErrorNegocio("Su usuario fue desactivado", 401);
    const u = r.rows[0];
    return { usuario: { id: u.id, nombre: u.nombre, permisos: u.permisos, sucursales: u.sucursales }, empresa: { id: u.empresaId, nombre: u.empresa }, modo: config.modo };
  });

  // ------------------------------------------------------------- Verificación en dos pasos (cada usuario, la suya)
  app.get("/central/sesion/2fa", async (req) => {
    const r = await pool.query<{ activo: boolean; n: number }>("SELECT activo, cardinality(recuperacion) AS n FROM usuarios_2fa WHERE usuario_id = $1", [sesionAdmin(req).u]);
    return { activo: !!r.rows[0]?.activo, codigosRestantes: r.rows[0]?.activo ? r.rows[0].n : 0 };
  });
  /** Paso 1: genera la clave para la app de códigos (todavía no queda activa). */
  app.post("/central/sesion/2fa/iniciar", async (req) => {
    const s = sesionAdmin(req);
    const ya = await pool.query("SELECT 1 FROM usuarios_2fa WHERE usuario_id = $1 AND activo", [s.u]);
    if (ya.rowCount) throw new ErrorNegocio("La verificación en dos pasos ya está activa. Desactívela primero para configurarla de nuevo.", 409);
    const secreto = nuevoSecreto();
    await pool.query(
      `INSERT INTO usuarios_2fa (usuario_id, secreto, activo) VALUES ($1,$2,FALSE)
       ON CONFLICT (usuario_id) DO UPDATE SET secreto = $2, activo = FALSE, recuperacion = '{}', ultimo_paso = 0, creado_en = now()`, [s.u, secreto]);
    const emp = (await pool.query<{ n: string }>("SELECT COALESCE(nombre_comercial, 'FactPOS') AS n FROM empresas WHERE id = $1", [s.e])).rows[0]?.n ?? "FactPOS";
    return { secreto, uri: uriOtp(secreto, s.n, `FactPOS ${emp}`.slice(0, 40)) };
  });
  /** Paso 2: confirma con un código de la app. Entrega los códigos de recuperación (se ven una sola vez). */
  app.post("/central/sesion/2fa/activar", async (req) => {
    const s = sesionAdmin(req);
    const b = z.object({ codigo: z.string().trim().max(10) }).parse(req.body);
    llaveDos(s.u);
    const r = (await pool.query<{ secreto: string }>("SELECT secreto FROM usuarios_2fa WHERE usuario_id = $1 AND NOT activo", [s.u])).rows[0];
    if (!r) throw new ErrorNegocio("Primero genere la clave para su app de códigos", 409);
    const paso = verificarCodigo(r.secreto, b.codigo);
    if (paso === null) { fallo(`2fa:${s.u}`, 5); throw new ErrorNegocio("Ese código no coincide. Revise la hora de su teléfono e intente con el código actual.", 400); }
    const { codigos, huellas } = nuevosCodigosRecuperacion();
    await pool.query("UPDATE usuarios_2fa SET activo = TRUE, recuperacion = $2, ultimo_paso = $3, activado_en = now() WHERE usuario_id = $1", [s.u, huellas, paso]);
    fallos.delete(`2fa:${s.u}`);
    return { ok: true, recuperacion: codigos };
  });
  /** Desactivar: pide la contraseña (y un código si está activa). */
  app.post("/central/sesion/2fa/desactivar", async (req) => {
    const s = sesionAdmin(req);
    const b = z.object({ clave: z.string().max(200) }).parse(req.body);
    llaveDos(s.u);
    const r = await pool.query<{ clave_hash: string }>("SELECT clave_hash FROM usuarios WHERE id = $1", [s.u]);
    if (!(await verificarClave(b.clave, r.rows[0]?.clave_hash))) { fallo(`2fa:${s.u}`, 5); throw new ErrorNegocio("La contraseña no es correcta", 400); }
    await pool.query("DELETE FROM usuarios_2fa WHERE usuario_id = $1", [s.u]);
    return { ok: true };
  });
  const llaveDos = (u: string) => frenar(`2fa:${u}`);

  /** Administrador: quién tiene verificación en dos pasos y restablecerla si alguien perdió su teléfono. */
  app.get("/central/usuarios-2fa", async (req) => {
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, COALESCE(d.activo, FALSE) AS activo, d.activado_en AS "activadoEn"
         FROM usuarios u LEFT JOIN usuarios_2fa d ON d.usuario_id = u.id WHERE u.empresa_id = $1 AND u.activo ORDER BY u.nombre`, [sesionAdmin(req).e]);
    return r.rows;
  });
  app.delete("/central/usuarios-2fa/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await pool.query("DELETE FROM usuarios_2fa WHERE usuario_id = $1 AND usuario_id IN (SELECT id FROM usuarios WHERE empresa_id = $2)", [id, sesionAdmin(req).e]);
    return { ok: true };
  });

  app.post("/central/sesion/clave", async (req) => {
    const s = sesionAdmin(req);
    const b = z.object({ actual: z.string(), nueva: z.string().max(200) }).parse(req.body);
    const r = await pool.query<{ clave_hash: string }>("SELECT clave_hash FROM usuarios WHERE id = $1", [s.u]);
    if (!(await verificarClave(b.actual, r.rows[0]?.clave_hash))) throw new ErrorNegocio("La contraseña actual no es correcta", 400);
    const malo = claveSegura(b.nueva);
    if (malo) throw new ErrorNegocio(malo);
    await pool.query("UPDATE usuarios SET clave_hash = $2 WHERE id = $1", [s.u, await hashClave(b.nueva)]);
    return { ok: true };
  });

  // ------------------------------------------------------------- Usuarios
  app.get("/central/usuarios", async (req) => {
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.activo, u.rol_id AS "rolId", ro.nombre AS rol,
              u.pin_hash IS NOT NULL AS "tienePin", u.clave_hash LIKE 'scrypt$%' AS "tieneClave", u.sucursales
         FROM usuarios u JOIN roles ro ON ro.id = u.rol_id
        WHERE u.empresa_id = $1 ORDER BY u.activo DESC, u.nombre`,
      [sesionAdmin(req).e],
    );
    return r.rows;
  });

  const esquemaUsuario = z.object({
    nombre: z.string().trim().min(2).max(80),
    usuario: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, "Usuario: 3 a 30 letras, números, punto o guion, sin espacios"),
    rolId: uuid,
    clave: z.string().max(200).optional(),
    pin: pinValido.optional(),
    /** null = todas las sucursales */
    sucursales: z.array(uuid).min(1).max(500).nullable().default(null),
  });
  const sucursalesDeEmpresa = async (empresaId: string, ids: string[] | null) => {
    if (!ids) return null;
    const unicos = [...new Set(ids)];
    const r = await pool.query("SELECT COUNT(*)::int AS n FROM sucursales WHERE empresa_id = $1 AND id = ANY($2::uuid[])", [empresaId, unicos]);
    if (r.rows[0].n !== unicos.length) throw new ErrorNegocio("Alguna de las sucursales elegidas no existe");
    return unicos;
  };

  const guardarPin = async (empresaId: string, id: string, pin: string | null) => {
    try {
      await pool.query("UPDATE usuarios SET pin_hash = $2 WHERE id = $1", [id, pin === null ? null : hashPin(empresaId, pin)]);
    } catch (e: any) {
      if (e.code === "23505") throw new ErrorNegocio("Ese PIN ya lo usa otra persona: elija otro", 409);
      throw e;
    }
  };
  const rolDeEmpresa = async (empresaId: string, rolId: string) => {
    const r = await pool.query("SELECT 1 FROM roles WHERE id = $1 AND empresa_id = $2", [rolId, empresaId]);
    if (!r.rowCount) throw new ErrorNegocio("Rol no encontrado", 404);
  };

  app.post("/central/usuarios", async (req, rep) => {
    const s = sesionAdmin(req);
    const b = esquemaUsuario.parse(req.body);
    await rolDeEmpresa(s.e, b.rolId);
    if (b.clave) { const m = claveSegura(b.clave); if (m) throw new ErrorNegocio(m); }
    const id = uuidv7();
    try {
      await pool.query(
        "INSERT INTO usuarios (id, empresa_id, rol_id, nombre, usuario, clave_hash, pin_hash, sucursales) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, s.e, b.rolId, b.nombre, b.usuario, b.clave ? await hashClave(b.clave) : "pendiente", b.pin ? hashPin(s.e, b.pin) : null,
         await sucursalesDeEmpresa(s.e, b.sucursales)],
      );
    } catch (e: any) {
      if (e.code === "23505") {
        throw new ErrorNegocio(e.constraint === "ux_usuarios_pin" ? "Ese PIN ya lo usa otra persona: elija otro" : "Ya existe ese nombre de usuario", 409);
      }
      throw e;
    }
    rep.code(201);
    return { id };
  });

  app.patch("/central/usuarios/:id", async (req) => {
    const s = sesionAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({
      nombre: z.string().trim().min(2).max(80).optional(),
      rolId: uuid.optional(),
      activo: z.boolean().optional(),
      clave: z.string().max(200).optional(),
      pin: pinValido.nullable().optional(),
      sucursales: z.array(uuid).min(1).max(500).nullable().optional(),
    }).parse(req.body);
    const u = (await pool.query("SELECT id FROM usuarios WHERE id = $1 AND empresa_id = $2", [id, s.e])).rows[0];
    if (!u) throw new ErrorNegocio("Usuario no encontrado", 404);
    if (id === s.u && (b.activo === false || b.rolId)) throw new ErrorNegocio("No puede desactivarse ni cambiarse el rol a usted mismo");
    if (b.rolId) await rolDeEmpresa(s.e, b.rolId);
    if (b.clave !== undefined) { const m = claveSegura(b.clave); if (m) throw new ErrorNegocio(m); }
    await pool.query(
      `UPDATE usuarios SET nombre = COALESCE($2, nombre), rol_id = COALESCE($3, rol_id), activo = COALESCE($4, activo),
              clave_hash = COALESCE($5, clave_hash) WHERE id = $1`,
      [id, b.nombre ?? null, b.rolId ?? null, b.activo ?? null, b.clave ? await hashClave(b.clave) : null],
    );
    if (b.pin !== undefined) await guardarPin(s.e, id, b.pin);
    if (b.sucursales !== undefined) {
      if (id === s.u && b.sucursales) throw new ErrorNegocio("No puede limitarse las sucursales a usted mismo");
      await pool.query("UPDATE usuarios SET sucursales = $2 WHERE id = $1", [id, await sucursalesDeEmpresa(s.e, b.sucursales)]);
    }
    olvidarUsuario(id);
    // Siempre debe quedar al menos un administrador activo
    const admins = await pool.query(
      `SELECT COUNT(*)::int AS n FROM usuarios u JOIN roles ro ON ro.id = u.rol_id
        WHERE u.empresa_id = $1 AND u.activo AND '*' = ANY(ro.permisos)`,
      [s.e],
    );
    if (admins.rows[0].n === 0) {
      await pool.query("UPDATE usuarios SET activo = true WHERE id = $1", [id]);
      throw new ErrorNegocio("Debe quedar al menos un administrador activo");
    }
    return { ok: true };
  });

  // ------------------------------------------------------------- Roles
  app.get("/central/roles/permisos", async () => PERMISOS);

  app.get("/central/roles", async (req) => {
    const r = await pool.query(
      `SELECT ro.id, ro.nombre, ro.permisos,
              (SELECT COUNT(*)::int FROM usuarios u WHERE u.rol_id = ro.id AND u.activo) AS usuarios
         FROM roles ro WHERE ro.empresa_id = $1 ORDER BY ('*' = ANY(ro.permisos)) DESC, ro.nombre`,
      [sesionAdmin(req).e],
    );
    return r.rows;
  });

  const permisosValidos = z.array(z.string()).max(60).transform((ps) => {
    const ids = new Set(PERMISOS.map((p) => p.id));
    return [...new Set(ps)].filter((p) => p === "*" || ids.has(p));
  });

  app.post("/central/roles", async (req, rep) => {
    const b = z.object({ nombre: z.string().trim().min(2).max(40), permisos: permisosValidos }).parse(req.body);
    const id = uuidv7();
    await pool.query("INSERT INTO roles (id, empresa_id, nombre, permisos) VALUES ($1,$2,$3,$4)", [id, sesionAdmin(req).e, b.nombre, b.permisos]);
    rep.code(201);
    return { id };
  });

  app.patch("/central/roles/:id", async (req) => {
    const s = sesionAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nombre: z.string().trim().min(2).max(40).optional(), permisos: permisosValidos.optional() }).parse(req.body);
    const ro = (await pool.query<{ permisos: string[] }>("SELECT permisos FROM roles WHERE id = $1 AND empresa_id = $2", [id, s.e])).rows[0];
    if (!ro) throw new ErrorNegocio("Rol no encontrado", 404);
    if (ro.permisos.includes("*") && b.permisos && !b.permisos.includes("*")) {
      throw new ErrorNegocio("El rol Administrador conserva todos los permisos; cree otro rol con menos permisos");
    }
    await pool.query("UPDATE roles SET nombre = COALESCE($2, nombre), permisos = COALESCE($3, permisos) WHERE id = $1",
      [id, b.nombre ?? null, b.permisos ?? null]);
    olvidarUsuario();
    return { ok: true };
  });

  // ------------------------------------------------------------- Clave de conexión de cada sucursal
  /** Genera (o cambia) la clave con la que el servidor de una sucursal se conecta a la nube. Se muestra una sola vez. */
  app.post("/central/sucursales/:id/clave-conexion", async (req) => {
    const s = sesionAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const ok = await pool.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2", [id, s.e]);
    if (!ok.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    const clave = `fps_${randomBytes(24).toString("base64url")}`;
    await pool.query(
      `INSERT INTO sucursal_claves (sucursal_id, clave_hash, creada_por) VALUES ($1, $2, $3)
       ON CONFLICT (sucursal_id) DO UPDATE SET clave_hash = $2, creada_en = now(), creada_por = $3`,
      [id, huellaConexion(clave), s.u],
    );
    return { clave };
  });
}

/** La clave de conexión se guarda como huella (sha256): es aleatoria y larga, no hace falta más. */
export const huellaConexion = (clave: string) => createHash("sha256").update(clave).digest("hex");

/** Verifica el token de administración (lo usa el gancho general). */
export const leerSesionAdmin = (req: FastifyRequest) => {
  const h = req.headers.authorization;
  const s = leerToken(h?.startsWith("Bearer ") ? h.slice(7) : undefined);
  return s?.t === "admin" ? s : null;
};

/** Estado vigente del usuario (activo y permisos de su rol), con 30 s de memoria. */
const vigentes = new Map<string, { activo: boolean; permisos: string[]; sucursales: string[] | null; t: number }>();
export async function usuarioVigente(id: string) {
  const v = vigentes.get(id);
  if (v && v.t > Date.now() - 30_000) return v;
  const r = await pool.query<{ activo: boolean; permisos: string[]; sucursales: string[] | null }>(
    "SELECT u.activo, ro.permisos, u.sucursales FROM usuarios u JOIN roles ro ON ro.id = u.rol_id WHERE u.id = $1", [id]);
  const n = { activo: !!r.rows[0]?.activo, permisos: r.rows[0]?.permisos ?? [], sucursales: r.rows[0]?.sucursales ?? null, t: Date.now() };
  vigentes.set(id, n);
  return n;
}
export const olvidarUsuario = (id?: string) => (id ? vigentes.delete(id) : vigentes.clear());
