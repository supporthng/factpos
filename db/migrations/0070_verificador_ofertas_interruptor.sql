-- Ajustes del verificador de precios por empresa (hoy: {"mostrarOfertas": false} oculta las ofertas en la pantalla de espera).
-- Vive en configuracion_marca, que ya se sincroniza y se puede editar desde la administración local.
ALTER TABLE configuracion_marca ADD COLUMN IF NOT EXISTS verificador JSONB NOT NULL DEFAULT '{}'::jsonb;
