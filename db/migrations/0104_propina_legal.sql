-- Propina legal (10 %) cobrada en la venta: es dinero del personal, no ingreso ni base de ITBIS.
-- ventas.total y los comprobantes quedan igual; lo que paga el cliente es total + propina_legal (los pagos la incluyen).
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS propina_legal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (propina_legal >= 0);
