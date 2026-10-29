import type pg from "pg";

/**
 * Aplicar filas que llegan de otro servidor (central ⇄ sucursal).
 *
 * Las filas viajan tal como las da to_jsonb(fila) y se guardan con
 * jsonb_populate_recordset, así el código no repite la lista de columnas
 * de cada tabla. Columnas que el otro lado no conoce se ignoran.
 *
 * Modos:
 *  - "reemplazar": la fila que llega manda (datos maestros que bajan de la central).
 *  - "ultimo":     gana el último cambio por actualizado_en (clientes, que se crean en las dos puntas).
 *  - "insertar":   solo si no existe (documentos inmutables: ventas, kardex, pagos...).
 *                  Se filtra ANTES de insertar: los triggers BEFORE INSERT (el del kardex
 *                  mueve la existencia) se disparan aunque luego haya conflicto.
 */
export type Modo = "reemplazar" | "ultimo" | "insertar";
type Cliente = pg.PoolClient;

interface Tabla { columnas: string[]; llave: string[] }
const cache = new Map<string, Tabla>();

export async function estructura(c: Cliente, tabla: string): Promise<Tabla> {
  const hay = cache.get(tabla);
  if (hay) return hay;
  const r = await c.query<{ attname: string; llave: boolean }>(
    `SELECT a.attname, COALESCE(a.attnum = ANY(i.indkey), false) AS llave
       FROM pg_attribute a
       JOIN pg_class t ON t.oid = a.attrelid AND t.relnamespace = 'public'::regnamespace
       LEFT JOIN pg_index i ON i.indrelid = t.oid AND i.indisprimary
      WHERE t.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      ORDER BY a.attnum`,
    [tabla],
  );
  if (!r.rowCount) throw new Error(`Tabla desconocida: ${tabla}`);
  const t = {
    // La versión la pone cada base con su propio contador
    columnas: r.rows.map((x) => x.attname).filter((n) => n !== "version"),
    llave: r.rows.filter((x) => x.llave).map((x) => x.attname),
  };
  cache.set(tabla, t);
  return t;
}

const id = (n: string) => `"${n.replaceAll('"', '""')}"`;

/** Marca la transacción como sincronización: se conservan las fechas de cambio originales. */
export async function modoSincronizacion(c: Cliente) {
  await c.query("SELECT set_config('factpos.sincronizando', 'si', true)");
}

export async function aplicarFilas(
  c: Cliente,
  tabla: string,
  filas: unknown[] | null | undefined,
  modo: Modo,
  opciones: { orden?: string; extraSet?: Record<string, string> } = {},
): Promise<number> {
  if (!filas?.length) return 0;
  const t = await estructura(c, tabla);
  const cols = t.columnas.map(id).join(", ");
  const llave = t.llave.map(id).join(", ");
  const origen = `jsonb_populate_recordset(NULL::${id(tabla)}, $1::jsonb) AS r`;
  // Primero las filas desactivadas: así no chocan con índices únicos "solo activos"
  const ordenSql = opciones.orden ?? (t.columnas.includes("activo") ? "ORDER BY r.activo ASC NULLS FIRST" : "");

  let sql: string;
  if (modo === "insertar") {
    const existe = t.llave.map((k) => `x.${id(k)} = r.${id(k)}`).join(" AND ");
    sql = `INSERT INTO ${id(tabla)} (${cols})
           SELECT ${t.columnas.map((n) => `r.${id(n)}`).join(", ")} FROM ${origen}
            WHERE NOT EXISTS (SELECT 1 FROM ${id(tabla)} x WHERE ${existe})
           ${ordenSql}
           ON CONFLICT (${llave}) DO NOTHING`;
  } else {
    const otras = t.columnas.filter((n) => !t.llave.includes(n));
    const set = otras.map((n) => `${id(n)} = ${opciones.extraSet?.[n] ?? `EXCLUDED.${id(n)}`}`).join(", ");
    // No se reescribe una fila igual: así no cambia su versión local y las cajas
    // no vuelven a descargar el catálogo sin motivo.
    const condiciones = [
      `ROW(${otras.map((n) => `${id(tabla)}.${id(n)}`).join(", ")}) IS DISTINCT FROM ROW(${otras.map((n) => `EXCLUDED.${id(n)}`).join(", ")})`,
    ];
    if (modo === "ultimo" && otras.includes("actualizado_en")) condiciones.push(`EXCLUDED.actualizado_en >= ${id(tabla)}.actualizado_en`);
    const donde = otras.length ? `WHERE ${condiciones.join(" AND ")}` : "";
    // Y ni siquiera se propone: el trigger BEFORE INSERT (versión) correría igual y
    // gastaría un número de versión aunque luego no se actualice nada.
    const misma = t.llave.map((k) => `x.${id(k)} = r.${id(k)}`).join(" AND ");
    const sinCambio = [`ROW(${otras.map((n) => `x.${id(n)}`).join(", ")}) IS NOT DISTINCT FROM ROW(${otras.map((n) => `r.${id(n)}`).join(", ")})`];
    if (modo === "ultimo" && otras.includes("actualizado_en")) sinCambio.push("x.actualizado_en > r.actualizado_en");
    const filtro = otras.length ? `WHERE NOT EXISTS (SELECT 1 FROM ${id(tabla)} x WHERE ${misma} AND (${sinCambio.join(" OR ")}))` : "";
    sql = `INSERT INTO ${id(tabla)} (${cols})
           SELECT ${t.columnas.map((n) => `r.${id(n)}`).join(", ")} FROM ${origen} ${filtro} ${ordenSql}
           ON CONFLICT (${llave}) DO ${set ? `UPDATE SET ${set} ${donde}` : "NOTHING"}`;
  }
  const r = await c.query(sql, [JSON.stringify(filas)]);
  return r.rowCount ?? 0;
}

/**
 * Movimientos de inventario: se insertan en orden de fecha y una sola vez.
 * El trigger del kardex de esta base recalcula existencia y costo promedio.
 */
export function aplicarKardex(c: Cliente, filas: unknown[] | null | undefined) {
  return aplicarFilas(c, "kardex_movimientos", filas, "insertar", { orden: "ORDER BY r.creado_en, r.id" });
}

/** Ejecuta fn dentro de un SAVEPOINT: si falla, se deshace solo eso y se devuelve el error. */
export async function conPuntoDeGuardado<T>(c: Cliente, fn: () => Promise<T>): Promise<{ ok: true; valor: T } | { ok: false; error: Error & { code?: string } }> {
  await c.query("SAVEPOINT sp_sync");
  try {
    const valor = await fn();
    await c.query("RELEASE SAVEPOINT sp_sync");
    return { ok: true, valor };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_sync");
    return { ok: false, error: e as Error };
  }
}
