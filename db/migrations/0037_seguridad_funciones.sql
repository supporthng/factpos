-- =====================================================================
-- 0037 · Seguridad: funciones que un administrador habilita o deshabilita
--   Una fila por función y empresa. Si no hay fila, vale el valor por defecto que define el servidor
--   (p. ej. «agregar_existencia» viene desactivada).
-- =====================================================================
CREATE TABLE IF NOT EXISTS seguridad_funciones (
    empresa_id     UUID NOT NULL REFERENCES empresas(id),
    clave          TEXT NOT NULL CHECK (clave ~ '^[a-z_]{3,60}$'),
    habilitada     BOOLEAN NOT NULL,
    usuario_id     UUID REFERENCES usuarios(id),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (empresa_id, clave)
);

REVOKE ALL ON seguridad_funciones FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON seguridad_funciones FROM anon, authenticated';
    END IF;
END $$;
