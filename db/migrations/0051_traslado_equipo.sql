-- Traslado de la licencia a otro equipo: la licencia viaja junto con toda la base de datos.
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS traslado_hash TEXT;      -- huella del código de traslado vigente
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS traslado_en   TIMESTAMPTZ; -- cuándo se inició (pendiente de completar)
ALTER TABLE licencia         ADD COLUMN IF NOT EXISTS traslado_en   TIMESTAMPTZ; -- este equipo ya fue trasladado: solo consulta
