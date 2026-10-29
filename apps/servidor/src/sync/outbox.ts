/**
 * Cola de subida (sync_outbox): cada cambio que nace en la sucursal y la
 * central debe conocer se anota aquí DENTRO de la misma transacción, así
 * nunca se pierde aunque se vaya el internet o se apague el servidor.
 */
type Consultable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Tablas que pueden subir como filas sueltas (la central las acepta). */
export const TABLAS_FILAS = ["clientes", "turnos", "pedidos_delivery", "movimientos_caja", "auditoria", "ecf_estado", "cxc_movimientos", "incidentes"] as const;
export type TablaFilas = (typeof TABLAS_FILAS)[number];

export async function encolarFilas(c: Consultable, tabla: TablaFilas, ids: string[]) {
  if (!ids.length) return;
  // El estado de un e-CF sube sin el XML (pesa y la central no lo necesita)
  const fuente = tabla === "ecf_estado"
    ? `(SELECT id, estado, track_id, mensajes, enviado_en, intentos, actualizado_en FROM ecf_documentos)`
    : tabla;
  await c.query(
    `INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
     SELECT $1, t.id, 'UPSERT', jsonb_build_object('filas', jsonb_build_array(to_jsonb(t)))
       FROM ${fuente} t WHERE t.id = ANY($2::uuid[])`,
    [tabla, ids],
  );
}
