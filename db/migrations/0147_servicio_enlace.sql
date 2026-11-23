-- Enlace web para que el cliente apruebe o rechace la cotización de su reparación desde el celular (se envía por WhatsApp).
-- Solo se guarda la huella (hash) del enlace; vence a los 7 días y se puede volver a generar (el anterior deja de servir).
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS enlace_hash TEXT;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS enlace_vence TIMESTAMPTZ;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS aprobacion_ip TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_servicios_enlace ON servicios_tecnicos (enlace_hash) WHERE enlace_hash IS NOT NULL;
