-- =====================================================================
-- 0116 · Modificadores anidados: elegir una opción puede abrir otro grupo de preguntas
--   Ej.: «Combo» abre el grupo «Bebida»; «Refresco» abre «Tamaño». Un grupo que ninguna opción abre se pregunta siempre.
-- =====================================================================
ALTER TABLE modificadores ADD COLUMN IF NOT EXISTS abre_grupo TEXT;
