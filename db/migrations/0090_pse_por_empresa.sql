-- Proveedor e-CF (PSE) por empresa: nombre del proveedor y su llave de API (cifrada).
-- Antes la llave era una sola por servidor (PSE_TOKEN); con varias empresas cada una tiene su cuenta.
ALTER TABLE configuracion_fiscal ADD COLUMN IF NOT EXISTS pse_nombre VARCHAR(40);
ALTER TABLE configuracion_fiscal ADD COLUMN IF NOT EXISTS pse_token TEXT;
