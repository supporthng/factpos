-- =====================================================================
-- 0119 · Las actualizaciones se envían solo a los clientes que el proveedor elige
--   version_aprobada: la última versión que el proveedor habilitó para esa licencia (NULL = ninguna: no se le ofrece).
--   actualizar_todas: interruptor del portal para volver a enviar cada versión a todos automáticamente.
-- =====================================================================
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS version_aprobada TEXT;
ALTER TABLE portal_config ADD COLUMN IF NOT EXISTS actualizar_todas BOOLEAN NOT NULL DEFAULT FALSE;
