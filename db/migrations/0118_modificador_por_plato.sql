-- =====================================================================
-- 0118 · Un modificador (guarnición, término…) puede aplicar a un plato en particular
--   Si no se indica plato, sigue aplicando por categoría (o a todos), como antes.
-- =====================================================================
ALTER TABLE modificadores ADD COLUMN IF NOT EXISTS aplica_presentacion_id UUID REFERENCES presentaciones(id) ON DELETE SET NULL;
