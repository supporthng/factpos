-- =====================================================================
-- 0042 · Formato de impresión del ticket (diseño que elige el administrador)
--   Papel (58/80 mm), tamaño de letra y de logo, qué datos se muestran, líneas extra del encabezado y pie.
--   Viaja con la marca a todas las sucursales.
-- =====================================================================
ALTER TABLE configuracion_marca ADD COLUMN IF NOT EXISTS formato_ticket JSONB NOT NULL DEFAULT '{}'::jsonb;
