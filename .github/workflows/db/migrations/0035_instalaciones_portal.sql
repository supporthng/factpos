-- =====================================================================
-- 0035 · Instalaciones detectadas por el portal (solicitudes de activación)
--   Cada FactPOS instalado sin licencia le avisa al portal que existe. Queda aquí como
--   PENDIENTE hasta que el proveedor la asigna a un cliente (ASIGNADA) o la rechaza.
--   Solo se usa en el PORTAL; no viaja ningún dato de ventas ni de productos.
-- =====================================================================
CREATE TABLE IF NOT EXISTS portal_instalaciones (
    id                 UUID PRIMARY KEY,                 -- = licencia.instalacion_id de la nube del cliente
    estado             TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'ASIGNADA', 'RECHAZADA', 'LIBERADA')),
    secreto_hash       TEXT NOT NULL,                    -- lo que prueba que quien consulta es esa instalación
    empresa            TEXT,                             -- como se llama la empresa en esa instalación
    rnc                VARCHAR(11),
    equipo             TEXT,                             -- nombre del equipo (PC o servidor)
    version_app        TEXT,
    sucursales_en_uso  INTEGER,
    api_url            TEXT,
    licencia_id        UUID REFERENCES portal_licencias(id),
    solicitada_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_contacto    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resuelta_en        TIMESTAMPTZ,
    nota               TEXT
);
CREATE INDEX IF NOT EXISTS ix_portal_instalaciones_estado ON portal_instalaciones (estado, solicitada_en DESC);

REVOKE ALL ON portal_instalaciones FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON portal_instalaciones FROM anon, authenticated';
    END IF;
END $$;
