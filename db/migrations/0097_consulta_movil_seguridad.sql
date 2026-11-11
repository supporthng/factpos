-- Consulta de precios por internet: código renovable del enlace/QR de cada sucursal y registro de intentos bloqueados.
ALTER TABLE configuracion_sucursal ADD COLUMN IF NOT EXISTS codigo_consulta TEXT;

CREATE TABLE IF NOT EXISTS consulta_movil_bloqueos (
  id          BIGSERIAL PRIMARY KEY,
  sucursal_id UUID NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  motivo      TEXT NOT NULL,
  distancia_m INTEGER,
  equipo      TEXT
);
CREATE INDEX IF NOT EXISTS ix_consulta_movil_bloqueos ON consulta_movil_bloqueos (sucursal_id, creado_en DESC);
