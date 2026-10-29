-- =====================================================================
-- 0027 · Alta de servidores con código
--   El servidor de una tienda se instala, pide un código a la central
--   (ej. K7PD-4QX9) y lo muestra. En Administración › Sucursales se escribe
--   ese código y se elige (o crea) la sucursal: el servidor recibe solo su
--   identificador, su clave de conexión y el PIN_SECRETO, y empieza a
--   sincronizar. Solo en la central; no se sincroniza.
-- =====================================================================
CREATE TABLE altas_servidor (
    codigo        TEXT PRIMARY KEY,                    -- 8 letras/números sin ambigüedad
    sondeo_hash   TEXT NOT NULL,                       -- huella del token que solo tiene el servidor
    equipo        TEXT,                                -- nombre de la computadora
    version       TEXT,
    ip            TEXT,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_en     TIMESTAMPTZ NOT NULL,
    empresa_id    UUID REFERENCES empresas(id),
    sucursal_id   UUID REFERENCES sucursales(id),
    aprobado_por  UUID REFERENCES usuarios(id),
    aprobado_en   TIMESTAMPTZ,
    entregado_en  TIMESTAMPTZ
);
CREATE INDEX ix_altas_servidor_expira ON altas_servidor (expira_en);

REVOKE ALL ON altas_servidor FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON altas_servidor FROM anon, authenticated';
    END IF;
END $$;
