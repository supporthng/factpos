import pg from "pg";
import { config } from "./config.js";

// NUMERIC llega como texto: así no se pierde precisión en el dinero.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
// Las fechas (sin hora) se quedan como texto AAAA-MM-DD: sin corrimientos por zona horaria.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

/**
 * Supabase (y otras bases en la nube) exigen SSL. Se activa si la dirección
 * trae sslmode o apunta a Supabase. Con DATABASE_CA (certificado raíz de
 * Supabase, en texto PEM) además se verifica el servidor.
 */
/**
 * Lee DATABASE_URL aunque la contraseña traiga caracteres como @ # / ? % que
 * no se codificaron (pasa mucho al pegar la de Supabase). Si no se puede leer,
 * dice qué está mal en vez de tumbar el servidor con "Invalid URL".
 */
export function leerUrlBase(texto: string): URL {
  const limpio = texto.trim().replace(/^["']|["']$/g, "");
  // Se separa por la ÚLTIMA @: así una contraseña con @ # / ? no confunde al lector de direcciones
  const m = /^(postgres(?:ql)?):\/\/([^:/@]+):(.*)@([^@/?#]+)(\/[^?#]*)?(\?[^#]*)?$/s.exec(limpio);
  if (m) {
    const [, esquema, usuario, clave, host, base = "/postgres", resto = ""] = m;
    let real = clave;
    try { real = decodeURIComponent(clave); } catch { /* traía un % suelto: se usa tal cual */ }
    if (/^\[.*\]$/.test(real) && /YOUR|PASSWORD|CONTRASE/i.test(real)) {
      throw new Error("DATABASE_URL todavía tiene [YOUR-PASSWORD]: ponga la contraseña real de la base de Supabase, sin corchetes.");
    }
    try {
      return new URL(`${esquema}://${encodeURIComponent(usuario)}:${encodeURIComponent(real)}@${host}${base}${resto}`);
    } catch { /* cae al error */ }
  }
  try {
    return new URL(limpio);
  } catch { /* error claro abajo */ }
  throw new Error(
    "DATABASE_URL no tiene el formato correcto. Debe ser postgresql://usuario:contraseña@servidor:puerto/postgres " +
    "(cópiela de Supabase › Connect y ponga la contraseña real en lugar de [YOUR-PASSWORD], sin corchetes).",
  );
}

function opcionesConexion(): pg.PoolConfig {
  const url = leerUrlBase(config.databaseUrl);
  const ssl = url.searchParams.has("sslmode") || /supabase\.(co|com)$/.test(url.hostname) || process.env.DATABASE_SSL === "si";
  url.searchParams.delete("sslmode"); // lo controla la opción ssl de abajo
  return {
    connectionString: url.toString(),
    connectionTimeoutMillis: 10_000,
    max: config.maxConexiones,
    ssl: ssl ? (process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : { rejectUnauthorized: false }) : undefined,
    // En el servidor de una sucursal, los cambios hechos en su administración local se anotan
    // solos para subir a la nube (migración 0030). En la nube y el portal no aplica.
    ...(config.modo === "sucursal" ? { options: "-c factpos.modo=sucursal" } : {}),
  };
}

// Si DATABASE_URL está mal, el servidor igual arranca y cada consulta explica el problema
let errorConfiguracion: Error | null = null;
let opciones: pg.PoolConfig = {};
try {
  opciones = opcionesConexion();
} catch (e) {
  errorConfiguracion = e as Error;
  console.error(`[base de datos] ${errorConfiguracion.message}`);
}
export const pool = new pg.Pool(opciones);
if (errorConfiguracion) {
  const fallar = () => Promise.reject(errorConfiguracion);
  (pool as unknown as { query: unknown }).query = fallar;
  (pool as unknown as { connect: unknown }).connect = fallar;
}
// Una conexión inactiva que se cae (la base se reinicia, el pooler la cierra) no debe tumbar el servidor
pool.on("error", (e) => console.error(`[base de datos] conexión perdida: ${e.message}`));

/** Ejecuta una función dentro de una transacción; si algo falla, se revierte todo. */
export async function enTransaccion<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Error de negocio que se devuelve al cliente con un mensaje claro. */
export class ErrorNegocio extends Error {
  constructor(mensaje: string, public estado = 400) {
    super(mensaje);
  }
}
