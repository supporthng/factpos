-- Consultas hechas en los verificadores de precios: qué se consulta más y qué códigos no tenían precio.
-- Tabla local (no se sincroniza): cada servidor de sucursal anota las suyas.
CREATE TABLE IF NOT EXISTS verificador_consultas (
    id          BIGSERIAL PRIMARY KEY,
    sucursal_id UUID NOT NULL,
    codigo      TEXT NOT NULL,
    encontrado  BOOLEAN NOT NULL,
    descripcion TEXT,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verificador_consultas_fecha ON verificador_consultas (sucursal_id, creado_en DESC);
