-- =====================================================================
-- 0117 · El mesero avisa al cajero que cobre una cuenta (o toda la mesa)
--   Operación de la sucursal: no se sincroniza. El aviso solo cuenta mientras haya algo pendiente de cobrar.
-- =====================================================================
ALTER TABLE cuenta_asientos ADD COLUMN IF NOT EXISTS pedido_cobro_en TIMESTAMPTZ;
ALTER TABLE cuentas ADD COLUMN IF NOT EXISTS pedido_cobro_en TIMESTAMPTZ;
