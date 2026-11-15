-- =====================================================================
-- 0132 · Devolución parcial: nota de crédito (E34) o devolución interna (ANU) por parte de una factura.
--   parcial = true: no anula la factura (sigue vigente); solo devuelve algunas líneas/cantidades.
-- =====================================================================
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS parcial BOOLEAN NOT NULL DEFAULT false;
