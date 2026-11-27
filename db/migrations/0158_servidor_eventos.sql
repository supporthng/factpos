-- =====================================================================
-- 0158 · Qué le pasó al servidor (para explicar por qué una caja trabajó sin servidor)
--   Cada arranque del servidor queda anotado con su causa probable (actualización, reinicio de Windows, error interno o
--   servicio reiniciado), y también los ratos en que se quedó ocupado sin responder. El aviso «Caja trabajó sin servidor» lo
--   usa para decir la causa en el correo.
-- =====================================================================
CREATE TABLE IF NOT EXISTS servidor_eventos (
    id       UUID PRIMARY KEY,
    tipo     TEXT NOT NULL CHECK (tipo IN ('ARRANQUE', 'SERVIDOR_LENTO')),
    motivo   TEXT,                       -- ACTUALIZACION | ERROR_FATAL | REINICIO_WINDOWS | SERVICIO_REINICIADO
    desde    TIMESTAMPTZ NOT NULL,       -- ARRANQUE: último latido antes de caerse · SERVIDOR_LENTO: inicio del bloqueo
    hasta    TIMESTAMPTZ NOT NULL,       -- ARRANQUE: cuando volvió a arrancar
    detalle  JSONB,
    version  TEXT,
    equipo   TEXT
);
CREATE INDEX IF NOT EXISTS servidor_eventos_hasta ON servidor_eventos (hasta DESC);
REVOKE ALL ON servidor_eventos FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON servidor_eventos FROM anon, authenticated';
    END IF;
END $$;
