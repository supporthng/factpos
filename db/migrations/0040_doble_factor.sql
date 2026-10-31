-- =====================================================================
-- 0040 · Verificación en dos pasos (TOTP) para la administración
--   Cada usuario puede activarla con una app de códigos (Google Authenticator, Microsoft
--   Authenticator, Authy…). Los códigos de recuperación se guardan solo como huella.
-- =====================================================================
CREATE TABLE IF NOT EXISTS usuarios_2fa (
    usuario_id     UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    secreto        TEXT NOT NULL,                 -- base32
    activo         BOOLEAN NOT NULL DEFAULT FALSE,
    recuperacion   TEXT[] NOT NULL DEFAULT '{}',  -- sha256 de cada código sin usar
    ultimo_paso    BIGINT NOT NULL DEFAULT 0,     -- evita reusar el mismo código
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    activado_en    TIMESTAMPTZ
);
