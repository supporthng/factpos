import type { PoolClient } from "pg";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { ErrorNegocio } from "../db.js";

export interface AbonoParams {
  clienteId: string; sucursalId: string; usuarioId: string; turnoId?: string | null;
  monto: Decimal; formaPago: string; referencia?: string | null; notas?: string | null;
  /** "CUENTA": paga primero la factura más antigua y el sobrante pasa a la siguiente. "FACTURA": todo a una factura. */
  modo: "CUENTA" | "FACTURA"; ventaId?: string | null;
}
export interface Aplicacion { id: string; ventaId: string | null; monto: string }

/**
 * Registra un abono ya validado (cliente bloqueado y monto <= saldo) repartido por factura.
 * Cada parte es un movimiento ABONO propio con su factura (venta_id); lo que no corresponda a ninguna factura
 * (p. ej. deuda por ajustes) queda como abono «a la cuenta» (venta_id NULL). Devuelve las partes creadas.
 */
export async function aplicarAbono(c: PoolClient, p: AbonoParams): Promise<Aplicacion[]> {
  const partes: { ventaId: string | null; monto: Decimal }[] = [];
  if (p.modo === "FACTURA") {
    if (!p.ventaId) throw new ErrorNegocio("Elija la factura a la que se aplica el pago");
    const f = await c.query<{ pendiente: string }>("SELECT pendiente FROM rpt_cxc_facturas WHERE cliente_id = $1 AND venta_id = $2", [p.clienteId, p.ventaId]);
    if (!f.rowCount) throw new ErrorNegocio("Esa factura no es una factura a crédito de este cliente");
    const pendiente = new Decimal(f.rows[0].pendiente);
    if (pendiente.lte(0)) throw new ErrorNegocio("Esa factura ya está pagada");
    if (p.monto.gt(pendiente)) throw new ErrorNegocio(`La factura debe ${pendiente.toFixed(2)}: el pago no puede ser mayor`);
    partes.push({ ventaId: p.ventaId, monto: p.monto });
  } else {
    const fs = await c.query<{ venta_id: string; pendiente: string }>(
      "SELECT venta_id, pendiente FROM rpt_cxc_facturas WHERE cliente_id = $1 AND pendiente > 0 ORDER BY creado_en, venta_id", [p.clienteId]);
    let resto = p.monto;
    for (const f of fs.rows) {
      if (resto.lte(0)) break;
      const parte = Decimal.min(resto, new Decimal(f.pendiente));
      partes.push({ ventaId: f.venta_id, monto: parte });
      resto = resto.minus(parte);
    }
    if (resto.gt(0)) partes.push({ ventaId: null, monto: resto });
  }
  const hechas: Aplicacion[] = [];
  for (const parte of partes) {
    const id = uuidv7();
    await c.query(
      `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, venta_id, turno_id, usuario_id, forma_pago, referencia, notas)
       VALUES ($1,$2,$3,'ABONO',$4,$5,$6,$7,$8,$9,$10)`,
      [id, p.sucursalId, p.clienteId, parte.monto.neg().toFixed(2), parte.ventaId, p.turnoId ?? null, p.usuarioId, p.formaPago, p.referencia ?? null, p.notas ?? null],
    );
    hechas.push({ id, ventaId: parte.ventaId, monto: parte.monto.toFixed(2) });
  }
  return hechas;
}
