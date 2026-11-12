-- =====================================================================
-- 0122 · Clientes permitidos: reciben cada versión nueva sin que haya que enviársela una por una
--   (los demás siguen necesitando que el proveedor se la habilite).
-- =====================================================================
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS actualiza_siempre BOOLEAN NOT NULL DEFAULT FALSE;
