-- =====================================================================
-- 0113 · Reglas por grupo de modificadores (guarniciones: «elija una», obligatorio, máximo)
--   Un grupo sin fila aquí se comporta como hasta hoy (opcional y sin límite).
-- =====================================================================
CREATE TABLE IF NOT EXISTS modificador_grupos (
    empresa_id    UUID NOT NULL REFERENCES empresas(id),
    nombre        TEXT NOT NULL,
    obligatorio   BOOLEAN NOT NULL DEFAULT FALSE,
    max_opciones  SMALLINT NOT NULL DEFAULT 99 CHECK (max_opciones BETWEEN 1 AND 99),
    PRIMARY KEY (empresa_id, nombre)
);

REVOKE ALL ON modificador_grupos FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON modificador_grupos FROM anon, authenticated';
    END IF;
END $$;
