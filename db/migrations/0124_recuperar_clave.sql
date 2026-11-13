-- Códigos de un solo uso para recuperar la contraseña de la administración («¿Olvidó su contraseña?»).
-- Se guarda solo la huella del código; vence a los 15 minutos y se anula tras 5 intentos fallidos.
CREATE TABLE IF NOT EXISTS recuperacion_clave (
    usuario_id UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    huella     TEXT NOT NULL,
    vence_en   TIMESTAMPTZ NOT NULL,
    intentos   SMALLINT NOT NULL DEFAULT 0,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
