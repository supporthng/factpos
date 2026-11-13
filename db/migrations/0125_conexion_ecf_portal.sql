-- Estado de la conexión de facturación electrónica de cada cliente, reportado a su licencia (panel «MSeller» del portal):
-- proveedor, ambiente, si tiene credenciales, y comprobantes aceptados / rechazados / pendientes del mes.
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS ecf_conexion JSONB;
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS ecf_conexion_en TIMESTAMPTZ;
