import type { PoolClient } from 'pg';
import { ErrorNegocio } from '../db.js';

/** Debe ejecutarse dentro de la transacción de venta, con la caja bloqueada. */
export async function asignarNumeroNoElectronico(c: PoolClient, sucursalId: string, tipo: 'B01' | 'B02' | 'SIN'): Promise<string> {
  if (tipo === 'SIN') {
    const r = await c.query<{ ultimo: string }>(
      `INSERT INTO facturacion_contadores(sucursal_id, modalidad, ultimo) VALUES ($1,'SIN',1)
       ON CONFLICT(sucursal_id,modalidad) DO UPDATE SET ultimo=facturacion_contadores.ultimo+1
       RETURNING ultimo`, [sucursalId]);
    return `FI-${String(r.rows[0].ultimo).padStart(6, '0')}`;
  }
  const r = await c.query<{ id: string; siguiente: string }>(
    `SELECT id, siguiente FROM facturacion_rangos_ncf
      WHERE sucursal_id=$1 AND tipo=$2 AND activo AND vence_en >= CURRENT_DATE AND siguiente <= hasta
      ORDER BY vence_en, desde FOR UPDATE LIMIT 1`, [sucursalId, tipo]);
  if (!r.rowCount) throw new ErrorNegocio(`No hay rango ${tipo} vigente y disponible para esta sucursal`, 409);
  await c.query('UPDATE facturacion_rangos_ncf SET siguiente=siguiente+1 WHERE id=$1', [r.rows[0].id]);
  return `${tipo}${String(r.rows[0].siguiente).padStart(8, '0')}`;
}
