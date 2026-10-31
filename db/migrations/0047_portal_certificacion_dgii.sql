-- Portal de FactPOS: avance de la certificación del SOFTWARE ante la DGII (una sola, no por cliente).
CREATE TABLE IF NOT EXISTS portal_certificacion_dgii (
    id               INT PRIMARY KEY CHECK (id = 1),
    tipo_registro    VARCHAR(20) NOT NULL DEFAULT 'EMISOR' CHECK (tipo_registro IN ('EMISOR','PROVEEDOR')),
    software_nombre  VARCHAR(80) NOT NULL DEFAULT 'FactPOS',
    software_version VARCHAR(40),
    url_recepcion    TEXT,
    url_aprobacion   TEXT,
    url_autenticacion TEXT,
    pasos            JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { "1": {"estado":"HECHO","nota":"","fecha":"2026-11-02"}, … }
    autorizado       BOOLEAN NOT NULL DEFAULT FALSE,
    autorizado_fecha DATE,
    referencia       VARCHAR(120),
    notas            TEXT,
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_por  UUID
);
INSERT INTO portal_certificacion_dgii (id) VALUES (1) ON CONFLICT DO NOTHING;
