-- Anulación de rangos de e-NCF no usados (ANECF) informada a la DGII
CREATE TABLE ecf_anulaciones (
    id          UUID PRIMARY KEY,
    empresa_id  UUID NOT NULL REFERENCES empresas(id),
    tipo_ecf    VARCHAR(3) NOT NULL,
    desde       BIGINT NOT NULL,
    hasta       BIGINT NOT NULL,
    cantidad    BIGINT NOT NULL,
    estado      VARCHAR(12) NOT NULL CHECK (estado IN ('ENVIADA','RECHAZADA','SIMULADA')),
    respuesta   TEXT,
    xml         TEXT NOT NULL,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (hasta >= desde)
);
CREATE INDEX ix_ecf_anulaciones_empresa ON ecf_anulaciones (empresa_id, creado_en DESC);
