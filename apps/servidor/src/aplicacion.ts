import { contextoCaja } from "./contexto.js";
import { rutasActualizacion } from "./actualizacion.js";
import { permitidoPorTunel, tunelActivo, vieneDelTunel } from "./tunel.js";
import { rutasCentralCorreo } from "./rutas/central-correo.js";
import { rutasCentralAlta } from "./rutas/central-alta.js";
import { rutasPortal } from "./licencia/portal.js";
import { rutasPortalRespaldo } from "./respaldo/portal.js";
import { rutasPortalLector } from "./lector/portal.js";
import { rutasLectorFacturas } from "./lector/central.js";
import { rutasRespaldos, rutasRestaurarRespaldo } from "./respaldo/respaldo.js";
import { rutasInicio } from "./rutas/inicio.js";
import { rutasLicenciaCentral, rutasLicenciaSucursal } from "./licencia/cliente.js";
import { rutasAltaLocal } from "./sync/alta.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { ZodError } from "zod";
import { pool, ErrorNegocio } from "./db.js";
import { rutasProductos } from "./rutas/productos.js";
import { rutasTurnos } from "./rutas/turnos.js";
import { rutasVentas } from "./rutas/ventas.js";
import { rutasReportes } from "./rutas/reportes.js";
import { rutasTraspasos } from "./rutas/traspasos.js";
import { rutasVerificador } from "./rutas/verificador.js";
import { rutasDelivery } from "./rutas/delivery.js";
import { rutasFacturas } from "./rutas/facturas.js";
import { rutasCierre } from "./rutas/cierre.js";
import { rutasPadronCaja, rutasPadronCentral } from "./rutas/padron.js";
import { rutasCentral } from "./rutas/central.js";
import { rutasCentralInventario } from "./rutas/central-inventario.js";
import { rutasCentralMovil } from "./rutas/central-movil.js";
import { rutasCentralSeguridad, accesoWebPermitido } from "./rutas/central-seguridad.js";
import { rutasCentralFiscal } from "./rutas/central-fiscal.js";
import { rutasCentralOrganizacion } from "./rutas/central-organizacion.js";
import { rutasCentralProductos } from "./rutas/central-productos.js";
import { rutasCentralCompras } from "./rutas/central-compras.js";
import { rutasCentralSync } from "./rutas/central-sync.js";
import { rutasCentralTraspasos } from "./rutas/central-traspasos.js";
import { estadoSincronizacion, sincronizarAhora, syncActiva } from "./sync/sucursal.js";
import { config } from "./config.js";
import { datosDescubrimiento } from "./red.js";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { timingSafeEqual, createHash } from "node:crypto";
import { leerToken, permisoDeRuta, tienePermiso } from "./sesion.js";
import { rutasCajaMovimientos } from "./rutas/caja-movimientos.js";
import { rutasCentralCxc } from "./rutas/central-cxc.js";
import { rutasCentralClientes } from "./rutas/central-clientes.js";
import { rutasPedidos } from "./rutas/pedidos.js";
import { rutasCentralFacturas } from "./rutas/central-facturas.js";
import { rutasContingencia } from "./rutas/contingencia.js";
import { rutasCentralIncidentes } from "./rutas/central-incidentes.js";
import { leerSesionAdmin, rutasSesionCaja, rutasSesionCentral, usuarioVigente } from "./rutas/sesion.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function crearApp() {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "warn" : "info" } });

  await app.register(cors, { origin: true });

  // Compresión de las respuestas (JSON, texto): el catálogo de una tienda pasa de megabytes a unos cientos de KB
  // y la caja lo recibe mucho antes, aunque la red sea lenta o esté ocupada.
  const comprimir = promisify(gzip);
  app.addHook("onSend", async (req, reply, payload) => {
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload; // archivos en flujo: sin tocar
    if (reply.getHeader("content-encoding") || !/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) return payload;
    if (!/json|text|javascript|css|svg|xml/.test(String(reply.getHeader("content-type") ?? ""))) return payload;
    const buf = typeof payload === "string" ? Buffer.from(payload) : payload;
    if (buf.length < 1024) return payload;
    const z = await comprimir(buf, { level: 5 });
    reply.header("content-encoding", "gzip");
    reply.header("vary", "accept-encoding");
    reply.removeHeader("content-length");
    return z;
  });

  // Clave de acceso de la nube (CLAVE_ACCESO): protege las rutas de caja y de
  // diagnóstico. La administración (/central/...) tiene su propio inicio de sesión
  // y la sincronización usa la clave de conexión de cada sucursal.
  const clave = process.env.CLAVE_ACCESO;
  if (clave && config.modo !== "portal") { // el portal no tiene rutas de caja
    const huella = (t: string) => createHash("sha256").update(t).digest();
    const esperada = huella(clave);
    app.addHook("onRequest", async (req, rep) => {
      const ruta = req.url.split("?")[0];
      if (ruta === "/salud" || ruta === "/actualizacion/estado" || ruta === "/descubrir" || ruta === "/alta" || ruta === "/alta.json" || ruta === "/licencia/estado" || ruta.startsWith("/licencias/") || ruta.startsWith("/admin") || ruta.startsWith("/imagenes/") || ruta.startsWith("/terminal") || ruta.startsWith("/central/")) return;
      const dada = req.headers["x-clave-acceso"];
      if (typeof dada !== "string" || !timingSafeEqual(huella(dada), esperada)) {
        return rep.code(401).send({ error: "Clave de acceso incorrecta" });
      }
    });
  }

  // Servidor MASTER con túnel: desde internet solo entra la administración (las cajas, en la red local)
  if (tunelActivo()) {
    app.addHook("onRequest", async (req, rep) => {
      if (!vieneDelTunel(req.headers)) return;
      const ruta = req.url.split("?")[0];
      if (!permitidoPorTunel(ruta) || ruta === "/central/inicio") return rep.code(404).send({ error: "No disponible desde internet" });
      if (ruta !== "/salud" && !(await accesoWebPermitido())) return rep.code(403).send({ error: "El acceso web está desactivado. Un administrador puede activarlo en Configuración › Conexión web, desde la red local." });
    });
  }

  // Sesiones y permisos (después de leer el cuerpo de la petición)
  app.addHook("preHandler", async (req, rep) => {
    const ruta = req.url.split("?")[0];
    const metodo = req.method;

    // Administración: sesión de usuario con permiso para la sección
    if (ruta.startsWith("/central/")) {
      // Administración LOCAL (servidor de sucursal): lo que necesita a todas las sucursales o a la nube se hace allá
      // (una tienda que trabaja sola, sin CENTRAL_URL, lo hace todo aquí)
      if (config.modo === "sucursal" && syncActiva() && metodo !== "GET" && metodo !== "HEAD" && soloEnLaNube(metodo, ruta)) {
        return rep.code(409).send({ error: "Esto se hace en la Administración en la nube (necesita internet): afecta a otras sucursales o a la facturación de toda la empresa." });
      }
      if (ruta === "/central/entrar" || ruta === "/central/sync/subir" || ruta === "/central/sync/cambios" || ruta === "/central/sync/certificado" || ruta === "/central/vigilancia"
        || ruta === "/central/alta/solicitar" || ruta === "/central/alta/estado" || ruta === "/central/alta/canjear" || ruta === "/central/inicio") return;
      const s = leerSesionAdmin(req);
      if (!s) return rep.code(401).send({ error: "Inicie sesión en la administración", sesion: true });
      // Si lo desactivaron o le cambiaron el rol, aplica de inmediato (no espera a que venza la sesión)
      const v = await usuarioVigente(s.u);
      if (!v.activo) return rep.code(401).send({ error: "Su usuario fue desactivado", sesion: true });
      s.p = v.permisos;
      // Sucursales a las que tiene acceso: se revisa toda sucursal que venga en la petición
      delete req.headers["x-sucursales"];
      // En la administración local solo se ve y se toca ESTA sucursal
      const propia = config.modo === "sucursal" ? process.env.SUCURSAL_ID || null : null;
      if (propia && v.sucursales && !v.sucursales.includes(propia)) return rep.code(403).send({ error: "Su usuario no tiene acceso a esta sucursal" });
      const permitidas = propia ? [propia] : v.sucursales;
      if (permitidas) {
        const fuera = sucursalesPedidas(req).filter((id) => !permitidas.includes(id));
        if (fuera.length) return rep.code(403).send({ error: propia ? "Desde aquí solo se administra esta sucursal" : "Su usuario no tiene acceso a esa sucursal" });
        req.headers["x-sucursales"] = permitidas.join(",");
      }
      const p = permisoDeRuta(metodo, ruta);
      if (p && !tienePermiso(s.p, p)) {
        return rep.code(403).send({ error: "Su usuario no tiene permiso para esta acción" });
      }
      // La empresa y el usuario salen de la sesión, nunca de lo que mande el navegador
      req.headers["x-empresa-id"] = s.e;
      req.headers["x-usuario-id"] = s.u;
      if (req.body && typeof req.body === "object" && !Array.isArray(req.body) && "usuarioId" in req.body) {
        (req.body as Record<string, unknown>).usuarioId = s.u;
      }
      (req as typeof req & { sesion: unknown }).sesion = s;
      return;
    }

    // Caja: toda operación que cambia algo necesita la sesión del cajero en ESA caja
    const esCaja = ruta.startsWith("/cajas/") || ruta.startsWith("/delivery/");
    if (esCaja && metodo !== "GET" && metodo !== "HEAD" && !/^\/cajas\/[^/]+\/(entrar|cotizar)$/.test(ruta)) {
      const s = leerToken(req.headers["x-sesion-caja"] as string | undefined);
      if (!s || s.t !== "caja") return rep.code(401).send({ error: "Su sesión en la caja terminó: vuelva a entrar con su PIN", sesion: true });
      const v = await usuarioVigente(s.u);
      if (!v.activo) return rep.code(401).send({ error: "Su usuario fue desactivado", sesion: true });
      const cajaId = ruta.startsWith("/cajas/") ? ruta.split("/")[2] : null;
      if (cajaId && cajaId !== s.c) return rep.code(403).send({ error: "La sesión es de otra caja" });
      if (v.sucursales && cajaId && !v.sucursales.includes((await contextoCaja(cajaId)).sucursalId)) {
        return rep.code(401).send({ error: "Su usuario ya no tiene acceso a esta sucursal", sesion: true });
      }
      (req as typeof req & { sesionCaja: unknown }).sesionCaja = { ...s, p: v.permisos };
      // Quien hace la operación es quien entró con su PIN
      if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) (req.body as Record<string, unknown>).usuarioId = s.u;
    }
  });

  app.setErrorHandler((err, _req, rep) => {
    if (err instanceof ZodError) {
      return rep.code(400).send({ error: err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") });
    }
    if (err instanceof ErrorNegocio) return rep.code(err.estado).send({ error: err.message });
    app.log.error(err);
    return rep.code(500).send({ error: "Error interno del servidor" });
  });

  /** Para que las cajas (y quien instala) confirmen que esto es un servidor FactPOS y vean sus direcciones. */
  app.get("/descubrir", async () => datosDescubrimiento(config.puerto));

  app.get("/salud", async (req, rep) => {
    try {
      const r = await pool.query("SELECT now() AS hora");
      return { estado: "ok", modo: config.modo, ...r.rows[0] };
    } catch (e) {
      const err = e as Error & { code?: string };
      req.log.error(err);
      return rep.code(503).send({ estado: "sin_base_de_datos", modo: config.modo, codigo: err.code ?? null, causa: causaBase(err) });
    }
  });

  /** Estado de la sincronización con la central (servidor de sucursal). */
  app.get("/sync/estado", async () => estadoSincronizacion());
  app.post("/sync/ahora", async (_req, rep) => {
    if (!syncActiva()) return rep.code(409).send({ error: "Esta sucursal no tiene CENTRAL_URL configurada" });
    try {
      return await sincronizarAhora();
    } catch (e) {
      return rep.code(502).send({ error: (e as Error).message });
    }
  });

  // PORTAL del proveedor: solo inicio de sesión, clientes y licencias (y las páginas)
  if (config.modo === "portal") {
    await app.register(rutasInicio);
    await app.register(rutasSesionCentral);
    await app.register(rutasPortal);
    await app.register(rutasPortalRespaldo);
    await app.register(rutasPortalLector);
    return app;
  }

  await app.register(rutasSesionCaja);
  await app.register(rutasTurnos);
  await app.register(rutasCajaMovimientos);
  await app.register(rutasContingencia);
  await app.register(rutasProductos);
  await app.register(rutasVentas);
  await app.register(rutasReportes);
  await app.register(rutasTraspasos);
  await app.register(rutasVerificador);
  await app.register(rutasDelivery);
  await app.register(rutasPedidos);
  await app.register(rutasCentralFacturas);
  await app.register(rutasFacturas);
  await app.register(rutasCierre);
  await app.register(rutasPadronCaja);

  // Administración: en la nube (central) y también LOCAL en el servidor de cada tienda,
  // para trabajar sin internet. Lo hecho localmente sube solo (migración 0030).
  if (config.modo === "central" || config.modo === "sucursal") {
    // Configuración inicial: en la nube, o en una tienda que trabaja sola (sin nube)
    if (config.modo === "central" || !syncActiva()) await app.register(rutasInicio);
    await app.register(rutasSesionCentral);
    await app.register(rutasCentral);
    await app.register(rutasCentralInventario);
    await app.register(rutasCentralSeguridad);
  await app.register(rutasCentralMovil);
    await app.register(rutasCentralFiscal);
    await app.register(rutasCentralOrganizacion);
    await app.register(rutasCentralProductos);
    await app.register(rutasCentralCompras);
    await app.register(rutasLectorFacturas);
    if (config.modo === "central") await app.register(rutasCentralSync);
    await app.register(rutasCentralTraspasos);
    await app.register(rutasCentralCxc);
    await app.register(rutasCentralClientes);
    await app.register(rutasCentralIncidentes);
    await app.register(rutasCentralCorreo);
    if (config.modo === "central") await app.register(rutasCentralAlta);
    // La licencia se activa en la nube; una tienda que trabaja sola la activa aquí mismo
    if (config.modo === "central" || !syncActiva()) { await app.register(rutasLicenciaCentral); await app.register(rutasRespaldos); await app.register(rutasRestaurarRespaldo); }
    await app.register(rutasPadronCentral);
  }
  await app.register(rutasActualizacion); // el portal ya volvió antes
  if (config.modo === "sucursal") {
    await app.register(rutasAltaLocal); // http://<servidor>:3000/alta → código para darlo de alta
    await app.register(rutasLicenciaSucursal);
  }

  // Apps web servidas por este mismo servidor (si están compiladas):
  //   sucursal → http://<servidor>:3000/terminal/   (las cajas abren esta dirección)
  //   central  → https://<central>/admin/
  //   sucursal → http://<servidor>:3000/admin/      (administración local, sin internet)
  const apps: [string, string][] = [["admin", path.join(raiz, "admin/dist")], ["terminal", path.join(raiz, "terminal/dist")]];
  let primera = true;
  for (const [nombre, dir] of apps) {
    if (!existsSync(dir)) continue;
    await app.register(fastifyStatic, { root: dir, prefix: `/${nombre}/`, decorateReply: primera });
    app.get(`/${nombre}`, (_req, rep) => rep.redirect(`/${nombre}/`));
    primera = false;
  }
  return app;
}

/** Explica en palabras simples por qué no conecta la base (sin mostrar la contraseña). */
function causaBase(e: Error & { code?: string }): string {
  switch (e.code) {
    case "28P01": return "Contraseña o usuario de la base incorrectos: revise DATABASE_URL.";
    case "3D000": return "La base indicada en DATABASE_URL no existe (debe terminar en /postgres).";
    case "ENOTFOUND": return "No se encuentra el servidor de la base: revise el host de DATABASE_URL.";
    case "ENETUNREACH": case "EHOSTUNREACH":
      return "No hay ruta al servidor de la base. En Vercel use la conexión 'Transaction pooler' de Supabase (puerto 6543), no la 'Direct connection'.";
    case "ECONNREFUSED": return "El servidor de la base rechazó la conexión: revise host y puerto.";
    case "42P01": return "Faltan las tablas: corra las migraciones (GitHub › Actions › Base de datos en Supabase).";
    default:
      return /timeout/i.test(e.message)
        ? "La base no respondió a tiempo. En Vercel use la conexión 'Transaction pooler' de Supabase (puerto 6543)."
        : e.message;
  }
}


/** En la administración local: escrituras que solo se hacen en la nube. */
function soloEnLaNube(metodo: string, ruta: string) {
  if (/^\/central\/(alta|correo|cxc|empresa|pedidos-sucursal|traspasos|terminales|licencia)(\/|$)/.test(ruta)) return true;
  if (/^\/central\/fiscal\//.test(ruta) && !/^\/central\/fiscal\/documentos\/[^/]+\/reintentar$/.test(ruta)) return true;
  if (ruta === "/central/incidentes/prueba") return true;
  if (ruta === "/central/sucursales" || /^\/central\/sucursales\/[^/]+(\/(clave-conexion|terminales|tipo))?$/.test(ruta)) return true;
  void metodo;
  return false;
}

/** Toda sucursal que menciona una petición de la administración (para revisar el acceso). */
function sucursalesPedidas(req: { query: unknown; body: unknown; params: unknown; url: string }): string[] {
  const ids: string[] = [];
  const clave = /^(sucursal|origen|destino|surte)(Sucursal)?(Id|Ids)$|^sucursal(Origen|Destino)Id$|^sucursalIds$/i;
  const revisar = (o: unknown, nivel: number) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (clave.test(k)) {
        for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) ids.push(x.toLowerCase());
      } else if (nivel < 1 && Array.isArray(v)) v.forEach((x) => revisar(x, nivel + 1));
    }
  };
  revisar(req.query, 0);
  revisar(req.body, 0);
  // /central/sucursales/:id/...
  const m = /^\/central\/sucursales\/([0-9a-f-]{36})/i.exec(req.url);
  if (m) ids.push(m[1].toLowerCase());
  return ids;
}
