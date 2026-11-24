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
  c: Pick<PoolClient, "query">, almacenId: string, salidas: Salida[], opciones: { vencidosPrimero?: boolean; excluirVencidos?: boolean } = {},
): Promise<SalidaConLote[]> {
  const productos = [...new Set(salidas.filter((s) => new Decimal(s.cantidad).lt(0)).map((s) => s.productoId))];
  const disponibles = new Map<string, { loteId: string; queda: Decimal }[]>();
  if (productos.length) {
    const r = await c.query<{ producto_id: string; lote_id: string; cantidad: string }>(
      `SELECT el.producto_id, el.lote_id, el.cantidad::text AS cantidad
         FROM existencias_lote el JOIN lotes l ON l.id = el.lote_id
        WHERE el.almacen_id = $1 AND el.producto_id = ANY($2::uuid[]) AND el.cantidad > 0${opciones.excluirVencidos ? " AND (l.vence_en IS NULL OR l.vence_en >= CURRENT_DATE)" : ""}
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

/**
 * Farmacias: lo vencido NO se factura. Para cada producto que controla lotes, lo que se pide no puede pasar de lo vigente
 * (lotes sin vencer o sin fecha) más lo que está sin lote (existencia anterior al control de lotes). Si no alcanza porque lo que
 * queda está vencido, se dice cuántas unidades hay vencidas para retirarlas. Hay que llamarla ANTES de repartirPorLotes con excluirVencidos.
 */
export async function exigirVigentes(c: Pick<PoolClient, "query">, almacenId: string, salidas: Salida[]) {
  const pedido = new Map<string, Decimal>();
  for (const s of salidas) {
    const q = new Decimal(s.cantidad);
    if (q.lt(0)) pedido.set(s.productoId, (pedido.get(s.productoId) ?? new Decimal(0)).plus(q.neg()));
  }
  if (!pedido.size) return;
  const r = await c.query<{ producto_id: string; nombre: string; controla: boolean; total: string; vigente: string; vencido: string }>(
    `SELECT p.id AS producto_id, p.nombre, COALESCE(p.controla_lotes, false) AS controla,
            COALESCE(e.cantidad, 0)::text AS total,
            COALESCE(SUM(el.cantidad) FILTER (WHERE l.vence_en IS NULL OR l.vence_en >= CURRENT_DATE), 0)::text AS vigente,
            COALESCE(SUM(el.cantidad) FILTER (WHERE l.vence_en < CURRENT_DATE), 0)::text AS vencido
       FROM productos p
       LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = $1
       LEFT JOIN existencias_lote el ON el.producto_id = p.id AND el.almacen_id = $1 AND el.cantidad > 0
       LEFT JOIN lotes l ON l.id = el.lote_id
      WHERE p.id = ANY($2::uuid[])
      GROUP BY p.id, p.nombre, p.controla_lotes, e.cantidad`,
    [almacenId, [...pedido.keys()]],
  );
  for (const f of r.rows) {
    if (!f.controla) continue;
    const vencido = new Decimal(f.vencido);
    if (vencido.lte(0)) continue;
    const enLotes = new Decimal(f.vigente).plus(vencido);
    const sinLote = Decimal.max(new Decimal(f.total).minus(enLotes), 0);
    const utiles = new Decimal(f.vigente).plus(sinLote);
    if (pedido.get(f.producto_id)!.gt(utiles)) {
      throw new ErrorNegocio(`${f.nombre}: vencido. Solo hay ${utiles.toDecimalPlaces(3).toString()} unidad(es) vigente(s) y ${vencido.toDecimalPlaces(3).toString()} vencida(s) que no se pueden facturar: retírelas con una baja por vencimiento`, 409);
    }
  }
}
