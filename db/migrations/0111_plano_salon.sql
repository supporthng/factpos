-- =====================================================================
-- 0111 · Diseño del salón: cada mesa tiene su lugar (en % del plano de su zona) y su forma
--   Sin posición (NULL) la mesa se acomoda sola en cuadrícula, así lo ya creado sigue viéndose.
-- =====================================================================
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS pos_x NUMERIC(5,2) CHECK (pos_x BETWEEN 0 AND 100);
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS pos_y NUMERIC(5,2) CHECK (pos_y BETWEEN 0 AND 100);
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS forma VARCHAR(8) NOT NULL DEFAULT 'CUADRADA' CHECK (forma IN ('CUADRADA','REDONDA','LARGA'));
