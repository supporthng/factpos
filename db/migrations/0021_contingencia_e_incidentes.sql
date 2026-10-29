-- =====================================================================
-- 0021 · Cajas en contingencia e incidentes
--
-- Si el servidor de la sucursal se cae, cada caja sigue vendiendo
-- (solo factura de consumo E32, al contado) con su catálogo en memoria:
--   * Cada caja tiene apartado un bloque pequeño de e-NCF E32
--     (ecf_reservas). Mientras haya servidor, se repone solo.
--   * Las ventas se guardan en la caja y, al volver el servidor, se
--     registran con su hora real, su e-NCF apartado y se firman.
--   * Todo corte queda como INCIDENTE y se avisa al servicio técnico.
-- =====================================================================

ALTER TABLE ventas ADD COLUMN contingencia BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE ecf_reservas (
    id          UUID PRIMARY KEY,
    caja_id     UUID NOT NULL REFERENCES cajas(id),
    rango_id    UUID NOT NULL REFERENCES ecf_rangos(id),
    tipo_ecf    VARCHAR(3) NOT NULL,
    desde       BIGINT NOT NULL,
    hasta       BIGINT NOT NULL,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (hasta >= desde)
);
CREATE INDEX ix_ecf_reservas_caja ON ecf_reservas (caja_id, tipo_ecf);

-- Incidentes: servidor de sucursal sin comunicación, cajas que trabajaron sin servidor,
-- servidor que estuvo apagado. Nacen en la sucursal o en la central; se avisa a soporte.
CREATE TABLE incidentes (
    id              UUID PRIMARY KEY,
    empresa_id      UUID REFERENCES empresas(id),
    sucursal_id     UUID REFERENCES sucursales(id),
    caja_id         UUID REFERENCES cajas(id),
    tipo            VARCHAR(30) NOT NULL CHECK (tipo IN ('CAJA_SIN_SERVIDOR','SERVIDOR_APAGADO','SUCURSAL_SIN_COMUNICACION','PRUEBA')),
    gravedad        VARCHAR(10) NOT NULL DEFAULT 'ALTA' CHECK (gravedad IN ('ALTA','MEDIA','BAJA')),
    titulo          TEXT NOT NULL,
    detalle         JSONB,
    desde           TIMESTAMPTZ NOT NULL,
    hasta           TIMESTAMPTZ,                -- NULL = sigue pasando
    resuelto_en     TIMESTAMPTZ,
    resuelto_por    UUID REFERENCES usuarios(id),
    nota            TEXT,
    notificado_en   TIMESTAMPTZ,                -- aviso de inicio enviado a soporte
    notificado_fin  TIMESTAMPTZ,                -- aviso de "ya se resolvió"
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_incidentes_abiertos ON incidentes (sucursal_id, tipo) WHERE hasta IS NULL;
CREATE INDEX ix_incidentes_fecha ON incidentes (empresa_id, desde DESC);

-- Latido del servidor de la sucursal: si al arrancar el último latido es viejo,
-- el servidor estuvo apagado o caído ese tiempo.
CREATE TABLE servidor_latido (
    id        SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    ultimo    TIMESTAMPTZ NOT NULL,
    iniciado  TIMESTAMPTZ NOT NULL
);

REVOKE ALL ON ecf_reservas, incidentes, servidor_latido FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON ecf_reservas, incidentes, servidor_latido FROM anon, authenticated';
    END IF;
END $$;
