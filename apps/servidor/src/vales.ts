import type { PoolClient } from "pg";
import { randomInt } from "node:crypto";
import { uuidv7 } from "@factpos/compartido";

/**
 * Vales de consumo (entradas con tragos incluidos): un producto con «consumos incluidos» (productos.vale_consumos > 0) genera
 * un vale por cada unidad vendida, con un código corto que sale en el ticket y se canjea en la cuenta.
 */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin letras que se confunden (I, L, O, 0, 1)
const codigoNuevo = () => Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("");

export interface ValeCreado { codigo: string; descripcion: string; consumos: number }

export async function crearVales(
  c: Pick<PoolClient, "query">, sucursalId: string, ventaId: string,
  lineas: { productoId: string; descripcion: string; cantidad: string }[],
): Promise<ValeCreado[]> {
  if (!lineas.length) return [];
  const conVale = new Map((await c.query<{ id: string; v: number }>(
    "SELECT id, vale_consumos AS v FROM productos WHERE id = ANY($1::uuid[]) AND vale_consumos > 0", [[...new Set(lineas.map((l) => l.productoId))]])).rows.map((r) => [r.id, r.v]));
  const creados: ValeCreado[] = [];
  for (const l of lineas) {
    const consumos = conVale.get(l.productoId);
    if (!consumos) continue;
    const unidades = Math.min(200, Math.max(0, Math.floor(Number(l.cantidad))));
    for (let i = 0; i < unidades; i++) {
      for (let intento = 0; intento < 8; intento++) {
        const codigo = codigoNuevo();
        const r = await c.query(
          `INSERT INTO vales_consumo (id, sucursal_id, venta_id, codigo, descripcion, consumos) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (sucursal_id, codigo) DO NOTHING`,
          [uuidv7(), sucursalId, ventaId, codigo, l.descripcion, consumos]);
        if (r.rowCount) { creados.push({ codigo, descripcion: l.descripcion, consumos }); break; }
      }
    }
  }
  return creados;
}
