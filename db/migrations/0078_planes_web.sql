-- =====================================================================
-- 0078 · Planes para la página web
--   Las funciones que incluye cada plan, si va destacado, su etiqueta y el descuento por pago anual se manejan desde el portal;
--   la página web los lee de ahí.
-- =====================================================================
ALTER TABLE portal_planes
    ADD COLUMN IF NOT EXISTS funciones TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS destacado BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS etiqueta  TEXT;
ALTER TABLE portal_config
    ADD COLUMN IF NOT EXISTS descuento_anual INTEGER NOT NULL DEFAULT 10 CHECK (descuento_anual BETWEEN 0 AND 50);
