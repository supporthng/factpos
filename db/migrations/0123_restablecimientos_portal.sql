-- Códigos de un solo uso para restablecer la contraseña del administrador del portal (variable PORTAL_ADMIN_RESTABLECER).
-- Se guarda solo la huella del código: usado una vez, dejarlo puesto en Vercel no vuelve a tocar la contraseña.
CREATE TABLE IF NOT EXISTS portal_restablecimientos (
    huella  TEXT PRIMARY KEY,
    usado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
