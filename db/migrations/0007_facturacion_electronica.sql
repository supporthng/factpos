-- =====================================================================
-- 0007 · Facturación electrónica (e-CF, DGII)
--
-- * La DGII autoriza a la empresa rangos de e-NCF por tipo (E31, E32…).
-- * La central reparte esos rangos en BLOQUES por sucursal. Así cada
--   servidor local numera sin internet y dos sucursales nunca repiten un
--   e-NCF.
-- * Cada venta recibe su e-NCF, se genera el XML, se firma en el servidor
--   local (el código de seguridad sale de la firma y va impreso en el
--   ticket) y queda en cola para enviarse a la DGII o al PSE.
-- =====================================================================

-- Configuración fiscal de la empresa (datos del emisor y del envío)
CREATE TABLE configuracion_fiscal (
    empresa_id      UUID PRIMARY KEY REFERENCES empresas(id),
    direccion_emisor TEXT NOT NULL DEFAULT '',
    municipio       VARCHAR(6),
    provincia       VARCHAR(6),
    ambiente        VARCHAR(10) NOT NULL DEFAULT 'SIMULADO'
                    CHECK (ambiente IN ('SIMULADO','TESTECF','CERTECF','ECF')),
    transmisor      VARCHAR(10) NOT NULL DEFAULT 'SIMULADO'
                    CHECK (transmisor IN ('SIMULADO','DGII','PSE')),
    pse_url         TEXT,
    alerta_restantes INTEGER NOT NULL DEFAULT 500,   -- avisar cuando quedan menos e-NCF
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER tr_configuracion_fiscal_version BEFORE INSERT OR UPDATE ON configuracion_fiscal
    FOR EACH ROW EXECUTE FUNCTION fn_version();

-- Rangos autorizados por la DGII a la empresa
CREATE TABLE ecf_autorizaciones (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    tipo_ecf        VARCHAR(3) NOT NULL CHECK (tipo_ecf ~ '^E(31|32|33|34|41|43|44|45|46|47)$'),
    desde           BIGINT NOT NULL CHECK (desde >= 1),
    hasta           BIGINT NOT NULL CHECK (hasta <= 9999999999),
    vence_en        DATE NOT NULL,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (hasta >= desde)
);

-- Bloques asignados a cada sucursal (sub-rangos de una autorización)
CREATE TABLE ecf_rangos (
    id              UUID PRIMARY KEY,
    autorizacion_id UUID NOT NULL REFERENCES ecf_autorizaciones(id),
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    tipo_ecf        VARCHAR(3) NOT NULL,
    desde           BIGINT NOT NULL,
    hasta           BIGINT NOT NULL,
    siguiente       BIGINT NOT NULL,             -- próximo número a usar
    vence_en        DATE NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (hasta >= desde),
    CHECK (siguiente BETWEEN desde AND hasta + 1)
);
CREATE INDEX ix_ecf_rangos_uso ON ecf_rangos (sucursal_id, tipo_ecf, desde) WHERE activo;
CREATE TRIGGER tr_ecf_rangos_version BEFORE INSERT OR UPDATE ON ecf_rangos
    FOR EACH ROW EXECUTE FUNCTION fn_version();

-- Ningún número puede pertenecer a dos bloques del mismo tipo
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE ecf_rangos ADD CONSTRAINT ex_ecf_rangos_solapados
    EXCLUDE USING gist (tipo_ecf WITH =, int8range(desde, hasta, '[]') WITH &&);

-- Documento electrónico de cada venta
-- (encf ya existe desde 0001)
ALTER TABLE ecf_documentos ADD COLUMN rango_id UUID REFERENCES ecf_rangos(id);
ALTER TABLE ecf_documentos ADD COLUMN modo_envio VARCHAR(5) CHECK (modo_envio IN ('ECF','RFCE'));
ALTER TABLE ecf_documentos ADD COLUMN monto_total NUMERIC(14,2);
ALTER TABLE ecf_documentos ADD COLUMN rnc_comprador VARCHAR(11);
ALTER TABLE ecf_documentos ADD COLUMN fecha_emision DATE;
ALTER TABLE ecf_documentos ADD COLUMN fecha_firma TIMESTAMPTZ;
ALTER TABLE ecf_documentos ADD COLUMN xml TEXT;                 -- e-CF firmado (se conserva)
ALTER TABLE ecf_documentos ADD COLUMN xml_envio TEXT;           -- lo que se transmite (e-CF o RFCE)
ALTER TABLE ecf_documentos ADD COLUMN track_id TEXT;
ALTER TABLE ecf_documentos ADD COLUMN mensajes JSONB;
ALTER TABLE ecf_documentos ADD COLUMN enviado_en TIMESTAMPTZ;
ALTER TABLE ecf_documentos ADD COLUMN proximo_intento TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ecf_documentos DROP CONSTRAINT ecf_documentos_estado_check;
ALTER TABLE ecf_documentos ADD CONSTRAINT ecf_documentos_estado_check
    CHECK (estado IN ('PENDIENTE','ENVIADO','EN_PROCESO','ACEPTADO','ACEPTADO_COND','RECHAZADO','CONTINGENCIA','SIN_FIRMA'));
CREATE UNIQUE INDEX ux_ecf_encf ON ecf_documentos (encf) WHERE encf IS NOT NULL;
DROP INDEX ix_ecf_pendientes;
CREATE INDEX ix_ecf_cola ON ecf_documentos (proximo_intento)
    WHERE estado IN ('PENDIENTE','ENVIADO','EN_PROCESO','CONTINGENCIA');

-- Disponibilidad de e-NCF por sucursal y tipo
CREATE VIEW rpt_ecf_secuencias AS
SELECT s.empresa_id, r.sucursal_id, s.nombre AS sucursal, r.tipo_ecf,
       SUM(r.hasta - r.siguiente + 1) FILTER (WHERE r.activo AND r.vence_en >= CURRENT_DATE) AS disponibles,
       MIN(r.vence_en) FILTER (WHERE r.activo AND r.siguiente <= r.hasta) AS proximo_vencimiento,
       MAX(r.siguiente - 1) FILTER (WHERE r.siguiente > r.desde) AS ultimo_usado
FROM ecf_rangos r JOIN sucursales s ON s.id = r.sucursal_id
GROUP BY s.empresa_id, r.sucursal_id, s.nombre, r.tipo_ecf;

-- Estado de los envíos
CREATE VIEW rpt_ecf_estado AS
SELECT d.sucursal_id, (d.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       d.tipo_ecf, d.estado, COUNT(*) AS documentos, SUM(d.monto_total) AS monto
FROM ecf_documentos d
GROUP BY 1, 2, 3, 4;
