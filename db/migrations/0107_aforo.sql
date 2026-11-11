-- =====================================================================
-- 0107 · Entradas y aforo (discotecas, bares). Apagado por defecto: se activa por empresa.
--   Las entradas se venden como cualquier producto (con su comprobante) de una categoría elegida; cada unidad cuenta como una persona.
--   Las salidas, las entradas sin cobro y el reinicio de la noche se anotan aquí (operación de la sucursal, no se sincroniza).
-- =====================================================================
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS aforo_activo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS aforo_maximo INTEGER CHECK (aforo_maximo IS NULL OR aforo_maximo > 0);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS aforo_categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS aforo_eventos (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    tipo            VARCHAR(18) NOT NULL CHECK (tipo IN ('SALIDA','ENTRADA_SIN_COBRO','REINICIO')),
    cantidad        INTEGER NOT NULL DEFAULT 0,
    motivo          TEXT,
    usuario_id      UUID REFERENCES usuarios(id),
    autorizado_por  UUID REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_aforo_eventos ON aforo_eventos (sucursal_id, creado_en);
REVOKE ALL ON aforo_eventos FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON aforo_eventos FROM anon, authenticated';
    END IF;
END $$;
