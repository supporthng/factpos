import type { PoolClient } from "pg";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { ErrorNegocio } from "./db.js";

/**
 * Lotes y vencimientos.
 *
 *  - registrarLote: al recibir mercancía, el lote (número y fecha de vencimiento) de cada línea.
 *  - repartirPorLotes: las salidas (venta, traspaso, merma…) se reparten entre los lotes con
 *    existencia de ese almacén, PRIMERO EL QUE VENCE ANTES (FEFO). Los lotes ya vencidos se usan
 *    al final; en una salida por VENCIMIENTO, al revés: primero los vencidos.
 *    Lo que no alcanza a cubrirse con lotes sale sin lote (mercancía sin control de vencimiento).
 *
 * El saldo de cada lote (existencias_lote) lo lleva el trigger del kardex (migración 0032).
 */

/** Crea (o reutiliza) el lote de un producto. Sin número ni fecha → sin lote. */
export async function registrarLote(c: Pick<PoolClient, "query">, productoId: string, numeroLote?: string | null, venceEn?: string | null): Promise<string | null> {
  const numero = (numeroLote ?? "").trim() || (venceEn ? `V${venceEn.replace(/-/g, "")}` : "");
  if (!numero) return null;
  const r = await c.query<{ id: string }>(
    `INSERT INTO lotes (id, producto_id, numero_lote, vence_en) VALUES ($1, $2, $3, $4)
     ON CONFLICT (producto_id, numero_lote) DO UPDATE SET vence_en = COALESCE(EXCLUDED.vence_en, lotes.vence_en)
     RETURNING id`,
    [uuidv7(), productoId, numero.slice(0, 40), venceEn ?? null],
  );
  return r.rows[0].id;
}

/** Valida lote/vencimiento de una línea de entrada según el producto. */
export function revisarLoteEntrada(nombre: string, controlaLotes: boolean, numeroLote?: string | null, venceEn?: string | null) {
  if (controlaLotes && !(numeroLote ?? "").trim() && !venceEn) {
    throw new ErrorNegocio(`${nombre} controla lotes: indique la fecha de vencimiento (y el lote si lo trae)`);
  }
  if (venceEn && !/^\d{4}-\d{2}-\d{2}$/.test(venceEn)) throw new ErrorNegocio(`Fecha de vencimiento inválida en ${nombre}`);
}

export interface Salida { productoId: string; cantidad: string }            // cantidad NEGATIVA, unidades base
export interface SalidaConLote extends Salida { loteId: string | null; indice: number }

export async function repartirPorLotes(
  c: Pick<PoolClient, "query">, almacenId: string, salidas: Salida[], opciones: { vencidosPrimero?: boolean } = {},
): Promise<SalidaConLote[]> {
  const productos = [...new Set(salidas.filter((s) => new Decimal(s.cantidad).lt(0)).map((s) => s.productoId))];
  const disponibles = new Map<string, { loteId: string; queda: Decimal }[]>();
  if (productos.length) {
    const r = await c.query<{ producto_id: string; lote_id: string; cantidad: string }>(
      `SELECT el.producto_id, el.lote_id, el.cantidad::text AS cantidad
         FROM existencias_lote el JOIN lotes l ON l.id = el.lote_id
        WHERE el.almacen_id = $1 AND el.producto_id = ANY($2::uuid[]) AND el.cantidad > 0
        ORDER BY el.producto_id,
                 (COALESCE(l.vence_en, 'infinity'::date) < CURRENT_DATE) ${opciones.vencidosPrimero ? "DESC" : "ASC"},
                 l.vence_en NULLS LAST, l.numero_lote
          FOR UPDATE OF el`,
      [almacenId, productos],
    );
    for (const f of r.rows) {
      const lista = disponibles.get(f.producto_id) ?? [];
      lista.push({ loteId: f.lote_id, queda: new Decimal(f.cantidad) });
      disponibles.set(f.producto_id, lista);
    }
  }
  const resultado: SalidaConLote[] = [];
  salidas.forEach((s, indice) => {
    let falta = new Decimal(s.cantidad).neg();
    if (falta.lte(0)) { resultado.push({ ...s, loteId: null, indice }); return; }
    for (const lote of disponibles.get(s.productoId) ?? []) {
      if (falta.lte(0)) break;
      if (lote.queda.lte(0)) continue;
      const toma = Decimal.min(falta, lote.queda);
      lote.queda = lote.queda.minus(toma);
      falta = falta.minus(toma);
      resultado.push({ productoId: s.productoId, cantidad: toma.neg().toFixed(3), loteId: lote.loteId, indice });
    }
    if (falta.gt(0)) resultado.push({ productoId: s.productoId, cantidad: falta.neg().toFixed(3), loteId: null, indice });
  });
  return resultado;
}
