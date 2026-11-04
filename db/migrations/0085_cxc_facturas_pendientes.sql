-- Cuentas por cobrar por factura.
-- Cada abono puede quedar aplicado a una factura (cxc_movimientos.venta_id) o «a la cuenta» (venta_id NULL).
-- Un abono «a la cuenta» paga primero la factura más antigua, y lo que sobre pasa a la siguiente (igual que antes en la antigüedad de saldos).
-- Esta vista da lo pendiente de cada factura a crédito: cargo, lo aplicado directamente a ella y el resto pendiente.
CREATE OR REPLACE VIEW rpt_cxc_facturas AS
WITH cargos AS (
    SELECT m.id AS cargo_id, m.cliente_id, m.venta_id, m.sucursal_id, m.creado_en, m.monto AS cargo
      FROM cxc_movimientos m
     WHERE m.tipo = 'CARGO' AND m.monto > 0 AND m.venta_id IS NOT NULL
), aplicado AS (
    -- abonos y ajustes ligados a una factura (incluye la reversión de una factura anulada)
    SELECT venta_id, SUM(monto) AS neto
      FROM cxc_movimientos WHERE venta_id IS NOT NULL AND tipo <> 'CARGO' GROUP BY venta_id
), base AS (
    SELECT c.*, GREATEST(0, c.cargo + COALESCE(a.neto, 0)) AS pendiente_directo
      FROM cargos c LEFT JOIN aplicado a ON a.venta_id = c.venta_id
), libres AS (
    -- abonos «a la cuenta» (sin factura)
    SELECT cliente_id, -SUM(monto) AS total FROM cxc_movimientos WHERE venta_id IS NULL AND monto < 0 GROUP BY cliente_id
), acumulado AS (
    SELECT b.*, SUM(b.pendiente_directo) OVER (PARTITION BY b.cliente_id ORDER BY b.creado_en, b.cargo_id) AS acum
      FROM base b
)
SELECT a.cliente_id, a.venta_id, a.sucursal_id, a.creado_en, a.cargo,
       a.cargo - a.pendiente_directo AS aplicado_factura,
       GREATEST(0, LEAST(a.pendiente_directo, a.acum - COALESCE(l.total, 0))) AS pendiente
  FROM acumulado a LEFT JOIN libres l ON l.cliente_id = a.cliente_id;
