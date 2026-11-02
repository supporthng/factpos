-- Comprobantes y aprobaciones que otros contribuyentes (o la DGII, en las pruebas) nos envían.
CREATE TABLE IF NOT EXISTS ecf_recibidos (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    rnc_emisor      VARCHAR(11) NOT NULL,
    encf            VARCHAR(13) NOT NULL,
    monto_total     NUMERIC(18,2),
    fecha_emision   VARCHAR(10),
    xml             TEXT NOT NULL,
    firma_valida    BOOLEAN NOT NULL,
    acuse_estado    SMALLINT NOT NULL,          -- 0 recibido, 1 no recibido
    acuse_motivo    SMALLINT,                   -- 1 especificación, 2 firma, 3 duplicado, 4 RNC comprador
    recibido_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, rnc_emisor, encf)
);

CREATE TABLE IF NOT EXISTS ecf_aprobaciones_recibidas (
    id              UUID PRIMARY KEY,
    empresa_id      UUID REFERENCES empresas(id),
    rnc_emisor      VARCHAR(11) NOT NULL,
    rnc_comprador   VARCHAR(11),
    encf            VARCHAR(13) NOT NULL,
    monto_total     NUMERIC(18,2),
    estado          SMALLINT,                   -- 1 aceptado, 2 rechazado
    motivo          TEXT,
    xml             TEXT NOT NULL,
    firma_valida    BOOLEAN NOT NULL,
    resultado       VARCHAR(10) NOT NULL,       -- OK | Error
    recibido_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ecf_aprob_recibidas ON ecf_aprobaciones_recibidas (empresa_id, encf);
