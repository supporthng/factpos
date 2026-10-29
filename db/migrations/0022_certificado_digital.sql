-- =====================================================================
-- 0022 · Certificado digital (.p12) administrado desde la central
--
-- Se sube una sola vez en Administración › Facturación electrónica ›
-- Certificado. Se guarda CIFRADO (AES-256-GCM, llave derivada de
-- PIN_SECRETO, que es el mismo en la central y en las sucursales) y cada
-- servidor de sucursal lo baja y lo usa para firmar al vender, aunque
-- después se quede sin internet.
-- =====================================================================

CREATE TABLE certificados_digitales (
    id            UUID PRIMARY KEY,
    empresa_id    UUID NOT NULL REFERENCES empresas(id),
    titular       TEXT NOT NULL,
    emisor        TEXT,
    numero_serie  TEXT,
    valido_desde  TIMESTAMPTZ NOT NULL,
    vence         TIMESTAMPTZ NOT NULL,
    huella        CHAR(64) NOT NULL,          -- SHA-256 del certificado (DER), para comparar sin descifrar
    cifrado       TEXT NOT NULL,              -- el .p12 y su contraseña, cifrados
    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    subido_por    UUID,                       -- usuario (sin FK: en la sucursal puede no existir aún)
    subido_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_certificado_activo ON certificados_digitales (empresa_id) WHERE activo;

-- Qué certificado tiene cargado cada servidor de sucursal (lo informa al sincronizar)
ALTER TABLE sync_sucursales ADD COLUMN certificado_huella CHAR(64);
ALTER TABLE sync_sucursales ADD COLUMN certificado_error  TEXT;
ALTER TABLE sync_sucursales ADD COLUMN certificado_en     TIMESTAMPTZ;

REVOKE ALL ON certificados_digitales FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON certificados_digitales FROM anon, authenticated';
    END IF;
END $$;
