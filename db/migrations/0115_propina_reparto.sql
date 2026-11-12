-- =====================================================================
-- 0115 · Reparto de la propina legal entre el personal (porcentajes por sucursal)
--   Sin fila = todo para los meseros (como hasta hoy). Operación de la sucursal: no se sincroniza.
-- =====================================================================
CREATE TABLE IF NOT EXISTS propina_reparto (
    sucursal_id   UUID PRIMARY KEY REFERENCES sucursales(id),
    pct_meseros   NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (pct_meseros BETWEEN 0 AND 100),
    pct_cocina    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (pct_cocina BETWEEN 0 AND 100),
    pct_barra     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (pct_barra BETWEEN 0 AND 100),
    pct_otros     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (pct_otros BETWEEN 0 AND 100),
    CHECK (pct_meseros + pct_cocina + pct_barra + pct_otros = 100)
);

REVOKE ALL ON propina_reparto FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON propina_reparto FROM anon, authenticated';
    END IF;
END $$;
