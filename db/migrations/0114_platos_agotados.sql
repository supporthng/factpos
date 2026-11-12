-- =====================================================================
-- 0114 · Platos agotados («86»): la cocina o el cajero marca un plato como agotado y ninguna caja de la sucursal lo deja ordenar
--   Operación de la sucursal: no se sincroniza.
-- =====================================================================
CREATE TABLE IF NOT EXISTS platos_agotados (
    sucursal_id      UUID NOT NULL REFERENCES sucursales(id),
    presentacion_id  UUID NOT NULL REFERENCES presentaciones(id),
    marcado_por      UUID,
    marcado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (sucursal_id, presentacion_id)
);

REVOKE ALL ON platos_agotados FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON platos_agotados FROM anon, authenticated';
    END IF;
END $$;
