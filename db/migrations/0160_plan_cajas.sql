-- =====================================================================
-- 0160 · Cajas de venta por sucursal según el plan
--   Los niveles que se venden en Onetech (Básico, Pro, Empresarial) se diferencian por las cajas de cada sucursal.
--   El plan dice cuántas cajas de venta (tipo CAJA) puede tener cada sucursal; viaja firmado en la licencia y el
--   servidor del cliente no deja crear más. Vacío = sin límite (así quedan los planes y licencias que ya existen).
--   La caja de facturación (tipo FACTURACION) no cuenta.
-- =====================================================================
ALTER TABLE portal_planes
    ADD COLUMN IF NOT EXISTS cajas_por_sucursal INTEGER CHECK (cajas_por_sucursal IS NULL OR cajas_por_sucursal BETWEEN 1 AND 999);
