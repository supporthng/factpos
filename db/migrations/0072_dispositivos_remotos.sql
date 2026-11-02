-- =====================================================================
-- 0072 · Dispositivos autorizados para entrar a la administración desde internet
--   Cada app (o navegador) pide acceso una vez; un administrador lo autoriza o lo niega desde el servidor.
--   Guarda solo el hash del secreto del dispositivo.
-- =====================================================================
CREATE TABLE IF NOT EXISTS dispositivos_remotos (
    id             UUID PRIMARY KEY,
    empresa_id     UUID NOT NULL REFERENCES empresas(id),
    nombre         TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 60),
    plataforma     TEXT NOT NULL DEFAULT '',
    secreto_hash   TEXT NOT NULL,
    estado         TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','AUTORIZADO','DENEGADO','REVOCADO')),
    ip             TEXT,
    solicitado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resuelto_en    TIMESTAMPTZ,
    resuelto_por   UUID REFERENCES usuarios(id),
    ultimo_uso     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS dispositivos_remotos_empresa ON dispositivos_remotos (empresa_id, estado);

REVOKE ALL ON dispositivos_remotos FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON dispositivos_remotos FROM anon, authenticated';
    END IF;
END $$;
