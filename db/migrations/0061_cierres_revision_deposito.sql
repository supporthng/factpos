-- Módulo Cierres de caja: revisión del supervisor para cierres con diferencia y depósito del efectivo
ALTER TABLE turnos
  ADD COLUMN IF NOT EXISTS revisado_en       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revisado_por      UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS nota_revision     VARCHAR(300),
  ADD COLUMN IF NOT EXISTS deposito_monto    NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS deposito_en       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposito_por      UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS deposito_referencia VARCHAR(80);

-- Ajustes del módulo por empresa: diferencia a partir de la cual el cierre queda «por revisar» (0 = nunca)
CREATE TABLE IF NOT EXISTS cierres_config (
  empresa_id         UUID PRIMARY KEY REFERENCES empresas(id),
  umbral_diferencia  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (umbral_diferencia >= 0),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
