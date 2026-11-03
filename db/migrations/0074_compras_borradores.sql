-- =====================================================================
-- 0074 · Borradores de compra
--   Una compra a medio llenar (por ejemplo, la factura que se fotografió con el celular) queda guardada en el
--   servidor para seguir editándola desde la PC u otro equipo.
-- =====================================================================
CREATE TABLE IF NOT EXISTS compras_borradores (
    id             UUID PRIMARY KEY,
    empresa_id     UUID NOT NULL,
    usuario_id     UUID,
    titulo         TEXT NOT NULL DEFAULT '',
    datos          JSONB NOT NULL DEFAULT '{}'::jsonb,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compras_borradores_empresa ON compras_borradores (empresa_id, actualizado_en DESC);
