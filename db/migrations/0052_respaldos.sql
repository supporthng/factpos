-- Módulo de respaldos: configuración, historial local/nube y aviso de respaldo atrasado.
CREATE TABLE IF NOT EXISTS respaldo_config (
    id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    hora          TEXT NOT NULL DEFAULT '23:35' CHECK (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    carpeta_extra TEXT,                            -- copia extra: USB o carpeta sincronizada (OneDrive, Google Drive)
    dias_local    INTEGER NOT NULL DEFAULT 14 CHECK (dias_local BETWEEN 1 AND 365),
    nube_activa   BOOLEAN NOT NULL DEFAULT FALSE,  -- copia cifrada en la nube de FactPOS
    clave_nube    TEXT,                            -- clave de cifrado (el cliente guarda su copia: clave de recuperación)
    incidente_id  UUID,                            -- aviso abierto de respaldo atrasado
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO respaldo_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS respaldos (
    id           UUID PRIMARY KEY,
    archivo      TEXT NOT NULL UNIQUE,             -- nombre dentro de la carpeta de respaldos
    tipo         TEXT NOT NULL CHECK (tipo IN ('AUTO','MANUAL','SEGURIDAD')),
    tamano       BIGINT NOT NULL DEFAULT 0,
    filas        INTEGER,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    extra_estado TEXT NOT NULL DEFAULT 'NO' CHECK (extra_estado IN ('NO','PENDIENTE','COPIADO','ERROR')),
    extra_error  TEXT,
    nube_estado  TEXT NOT NULL DEFAULT 'NO' CHECK (nube_estado IN ('NO','PENDIENTE','SUBIDO','ERROR')),
    nube_objeto  TEXT,
    nube_error   TEXT,
    nube_intento TIMESTAMPTZ,
    borrado      BOOLEAN NOT NULL DEFAULT FALSE    -- el archivo local ya se eliminó por antigüedad
);
CREATE INDEX IF NOT EXISTS ix_respaldos_creado ON respaldos (creado_en DESC);

-- Portal: respaldos cifrados que cada licencia guarda en la nube de FactPOS
CREATE TABLE IF NOT EXISTS portal_respaldos (
    id          UUID PRIMARY KEY,
    licencia_id UUID NOT NULL REFERENCES portal_licencias(id),
    objeto      TEXT NOT NULL UNIQUE,
    tamano      BIGINT NOT NULL DEFAULT 0,
    confirmado  BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_portal_respaldos_lic ON portal_respaldos (licencia_id, creado_en DESC);

-- Aviso a soporte cuando una instalación pasa más de 24 horas sin respaldo
ALTER TABLE incidentes DROP CONSTRAINT IF EXISTS incidentes_tipo_check;
ALTER TABLE incidentes ADD CONSTRAINT incidentes_tipo_check
    CHECK (tipo IN ('CAJA_SIN_SERVIDOR','SERVIDOR_APAGADO','SUCURSAL_SIN_COMUNICACION','PRUEBA','RESPALDO_ATRASADO'));
