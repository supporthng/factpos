-- Datos generales de la empresa (se editan en Configuración › Datos de la empresa).
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS direccion      TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS municipio      TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS provincia      TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS telefono       VARCHAR(20);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS correo         TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS sitio_web      TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS representante  TEXT;
