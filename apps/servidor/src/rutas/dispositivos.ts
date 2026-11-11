import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";
import { ipCliente } from "../tunel.js";

/**
 * DISPOSITIVOS REMOTOS. Con «Exigir dispositivo autorizado» (Sistema › Seguridad) encendido, quien entra a la
 * administración por internet (túnel) necesita que un administrador haya autorizado ese equipo: el app (o el navegador)
 * pide acceso una vez, el administrador lo autoriza o lo niega desde el servidor y, desde entonces, el equipo manda su
 * credencial en la cabecera x-dispositivo. En la red local no se pide.
 */
const huella = (s: string) => createHash("sha256").update(s).digest("hex");

/** Rutas del túnel que no exigen dispositivo autorizado (son las que sirven para pedirlo). */
export const rutaDeAltaDispositivo = (ruta: string) => ruta === "/central/dispositivo/solicitar" || ruta === "/central/dispositivo/estado";

/**
 * Rutas que usan los SERVIDORES de las sucursales para hablar con la central (alta y sincronización).
 * No pasan por un navegador, así que no tienen «dispositivo»: se identifican con su propio código o clave
 * de sucursal. Sin esta excepción, «Exigir dispositivo autorizado» las bloquea por el túnel.
 */
const RUTAS_DE_SERVIDOR = new Set([
  "/central/alta/solicitar", "/central/alta/estado", "/central/alta/canjear", "/central/alta/verificar",
  "/central/sync/subir", "/central/sync/equipo", "/central/sync/cambios", "/central/sync/certificado", "/central/vigilancia",
]);
export const rutaDeServidor = (ruta: string) => RUTAS_DE_SERVIDOR.has(ruta);

let cache: { v: boolean; t: number } | null = null;
export const olvidarCacheDispositivos = () => { cache = null; };
export async function dispositivoExigido() {
  if (cache && Date.now() - cache.t < 5_000) return cache.v;
  const r = await pool.query<{ habilitada: boolean }>("SELECT habilitada FROM seguridad_funciones WHERE clave = 'exigir_dispositivo' ORDER BY actualizado_en DESC LIMIT 1")
    .catch(() => ({ rows: [] as { habilitada: boolean }[] }));
  const v = r.rows[0]?.habilitada ?? true; // viene activada: solo se apaga si un administrador la desactiva
  cache = { v, t: Date.now() };
  return v;
}

/** Estado del dispositivo que manda esta cabecera («id.secreto»). Anota el último uso (como mucho cada minuto). */
export async function estadoDispositivo(cabecera: unknown): Promise<"AUTORIZADO" | "PENDIENTE" | "DENEGADO" | "REVOCADO" | "DESCONOCIDO"> {
  if (typeof cabecera !== "string") return "DESCONOCIDO";
  const [id, secreto] = cabecera.split(".");
  if (!id || !secreto || !z.string().uuid().safeParse(id).success) return "DESCONOCIDO";
  const r = await pool.query<{ estado: "AUTORIZADO" | "PENDIENTE" | "DENEGADO" | "REVOCADO" }>(
    `UPDATE dispositivos_remotos SET ultimo_uso = CASE WHEN estado = 'AUTORIZADO' AND (ultimo_uso IS NULL OR ultimo_uso < now() - interval '1 minute') THEN now() ELSE ultimo_uso END
      WHERE id = $1 AND secreto_hash = $2 RETURNING estado`, [id, huella(secreto)]);
  return r.rows[0]?.estado ?? "DESCONOCIDO";
}

export async function rutasDispositivos(app: FastifyInstance) {
  const recientes = new Map<string, number[]>();

  /** El equipo pide acceso (sin sesión). Devuelve su credencial; queda PENDIENTE hasta que un administrador lo resuelva. */
  app.post("/central/dispositivo/solicitar", async (req) => {
    const b = z.object({ nombre: z.string().trim().min(1).max(60), plataforma: z.string().trim().max(40).default("") }).parse(req.body);
    const ahora = Date.now();
    const lista = (recientes.get(ipCliente(req)) ?? []).filter((t) => ahora - t < 3600_000);
    if (lista.length >= 5) throw new ErrorNegocio("Demasiadas solicitudes desde este equipo: espere un rato", 429);
    // La autorización vale para todo el servidor (se comprueba por credencial, no por empresa): con varias empresas el equipo
    // se anota en la primera y los administradores de cualquiera de ellas lo ven y lo resuelven.
    const emp = await pool.query<{ id: string }>("SELECT id FROM empresas WHERE activo ORDER BY id LIMIT 1");
    if (!emp.rowCount) throw new ErrorNegocio("Este servidor no tiene empresas activas: no se puede registrar el dispositivo", 409);
    const pend = await pool.query("SELECT 1 FROM dispositivos_remotos WHERE estado = 'PENDIENTE'");
    if ((pend.rowCount ?? 0) >= 30) throw new ErrorNegocio("Hay demasiadas solicitudes pendientes: un administrador debe resolverlas", 429);
    lista.push(ahora); recientes.set(ipCliente(req), lista);
    const id = randomUUID(), secreto = randomBytes(24).toString("base64url");
    await pool.query("INSERT INTO dispositivos_remotos (id, empresa_id, nombre, plataforma, secreto_hash, ip) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, emp.rows[0].id, b.nombre, b.plataforma, huella(secreto), ipCliente(req)]);
    return { dispositivo: `${id}.${secreto}`, estado: "PENDIENTE" };
  });

  /** El equipo pregunta cómo va su solicitud (manda x-dispositivo). */
  app.get("/central/dispositivo/estado", async (req) => ({ estado: await estadoDispositivo(req.headers["x-dispositivo"]), exigido: await dispositivoExigido() }));

  // ----- administración: solo administradores (permiso «*»), también para leer
  const soloAdmin = (req: unknown) => {
    const ses = (req as { sesion?: { p: string[] } }).sesion;
    if (!ses || !ses.p.includes("*")) throw new ErrorNegocio("Solo un administrador", 403);
  };
  app.get("/central/dispositivos", async (req) => {
    soloAdmin(req);
    const r = await pool.query(
      `SELECT d.id, d.nombre, d.plataforma, d.estado, d.ip, d.solicitado_en AS "solicitadoEn", d.resuelto_en AS "resueltoEn", d.ultimo_uso AS "ultimoUso", u.nombre AS "resueltoPor"
         FROM dispositivos_remotos d LEFT JOIN usuarios u ON u.id = d.resuelto_por
        ORDER BY (d.estado = 'PENDIENTE') DESC, d.solicitado_en DESC LIMIT 200`);
    return r.rows;
  });
  /** Solicitudes esperando respuesta (para la campana de avisos del admin; se consulta cada pocos segundos). */
  app.get("/central/dispositivos/pendientes", async (req) => {
    soloAdmin(req);
    const r = await pool.query(
      `SELECT id, nombre, plataforma, ip, solicitado_en AS "solicitadoEn" FROM dispositivos_remotos
        WHERE estado = 'PENDIENTE' ORDER BY solicitado_en DESC LIMIT 20`);
    return { pendientes: r.rowCount ?? 0, solicitudes: r.rows };
  });
  app.put("/central/dispositivos/:id", async (req) => {
    soloAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ estado: z.enum(["AUTORIZADO", "DENEGADO", "REVOCADO"]) }).parse(req.body);
    const r = await pool.query(
      "UPDATE dispositivos_remotos SET estado = $2, resuelto_en = now(), resuelto_por = $3 WHERE id = $1",
      [id, b.estado, z.string().uuid().safeParse(req.headers["x-usuario-id"]).data ?? null]);
    if (!r.rowCount) throw new ErrorNegocio("Dispositivo no encontrado", 404);
    return { ok: true };
  });
  app.delete("/central/dispositivos/:id", async (req) => {
    soloAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await pool.query("DELETE FROM dispositivos_remotos WHERE id = $1", [id]);
    return { ok: true };
  });
}
