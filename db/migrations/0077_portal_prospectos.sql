-- =====================================================================
-- 0077 · Prospectos del portal
--   Quien quiere probar FactPOS llena una solicitud en la página web (nombre, negocio, WhatsApp) y recién entonces recibe
--   el instalador. Así cada instalación de prueba llega al portal con un contacto real.
-- =====================================================================
CREATE TABLE IF NOT EXISTS portal_prospectos (
    id           UUID PRIMARY KEY,
    nombre       TEXT NOT NULL,
    negocio      TEXT NOT NULL,
    telefono     TEXT NOT NULL,
    correo       TEXT,
    sucursales   INTEGER,
    mensaje      TEXT,
    estado       TEXT NOT NULL DEFAULT 'NUEVO' CHECK (estado IN ('NUEVO', 'CONTACTADO', 'CLIENTE', 'DESCARTADO')),
    nota         TEXT,
    descargas    INTEGER NOT NULL DEFAULT 0,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_prospectos_estado ON portal_prospectos (estado, creado_en DESC);
REVOKE ALL ON portal_prospectos FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON portal_prospectos FROM anon, authenticated';
    END IF;
END $$;
