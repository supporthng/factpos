-- Precios 2 y 3 pueden definirse como un % de descuento sobre el precio 1.
--   base = 'COSTO'   → (comportamiento anterior) monto fijo, o costo + % de ganancia
--   base = 'PRECIO1' → precio = precio 1 menos «porcentaje» %; se recalcula al cambiar el precio 1
ALTER TABLE precios ADD COLUMN IF NOT EXISTS base TEXT NOT NULL DEFAULT 'COSTO' CHECK (base IN ('COSTO', 'PRECIO1'));
-- Datos de contacto del cliente (pantalla Clientes de la administración)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS correo TEXT;
