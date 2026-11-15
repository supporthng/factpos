-- Caja de «Facturación»: para tiendas que facturan desde la administración sin punto de venta (computadoras, equipos...).
-- No es una terminal: no se asigna a ninguna PC, no cuenta para la licencia y su turno se abre solo al facturar.
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'CAJA';
ALTER TABLE cajas DROP CONSTRAINT IF EXISTS cajas_tipo_chk;
ALTER TABLE cajas ADD CONSTRAINT cajas_tipo_chk CHECK (tipo IN ('CAJA', 'FACTURACION'));
