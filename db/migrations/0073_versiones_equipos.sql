-- =====================================================================
-- 0073 · Versiones de los equipos
--   verificador_equipos: cada app del verificador que consulta este servidor (versión de la app y último contacto).
--   sync_sucursales.verificadores: lo que cada sucursal reporta a la central (para verlo en la administración).
-- =====================================================================
CREATE TABLE IF NOT EXISTS verificador_equipos (
    id              TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 64),
    so              TEXT NOT NULL,
    equipo          TEXT NOT NULL DEFAULT '',
    build           INTEGER NOT NULL DEFAULT 0,
    sucursal_id     UUID,
    ultimo_contacto TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sync_sucursales ADD COLUMN IF NOT EXISTS verificadores JSONB NOT NULL DEFAULT '[]'::jsonb;
