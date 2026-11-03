-- =====================================================================
-- 0075 · Equipos de la caja
--   Configuración por terminal de sus equipos: impresora de tickets, gaveta, báscula y datáfono.
-- =====================================================================
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS equipos JSONB NOT NULL DEFAULT '{}'::jsonb;
