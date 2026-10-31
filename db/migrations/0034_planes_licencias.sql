-- =====================================================================
-- 0034 · Planes y reglas de licenciamiento (solo se usan en el PORTAL)
--   * portal_planes: lo que se vende (precio por sucursal, módulos, si incluye actualizaciones).
--   * portal_config: reglas globales (¿la prueba puede actualizar?) y datos de contacto
--     del proveedor que ven los clientes en su pantalla de Licencia.
--   * portal_licencias: plan contratado y, si hay, un precio especial por sucursal.
-- Los precios sembrados están en 0: el proveedor los define en Portal › Planes.
-- =====================================================================
CREATE TABLE portal_planes (
    id                      UUID PRIMARY KEY,
    codigo                  TEXT NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9-]{2,30}$'),
    nombre                  TEXT NOT NULL,
    descripcion             TEXT,
    precio_sucursal         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (precio_sucursal >= 0),
    periodo                 TEXT NOT NULL DEFAULT 'ANUAL' CHECK (periodo IN ('MENSUAL', 'ANUAL')),
    sucursales_incluidas    INTEGER NOT NULL DEFAULT 1 CHECK (sucursales_incluidas BETWEEN 1 AND 999),
    modulos                 TEXT[] NOT NULL DEFAULT '{}',
    permite_actualizaciones BOOLEAN NOT NULL DEFAULT TRUE,
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    orden                   INTEGER NOT NULL DEFAULT 0,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE portal_config (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    prueba_actualiza    BOOLEAN NOT NULL DEFAULT FALSE,   -- ¿una instalación en prueba puede descargar actualizaciones?
    contacto_nombre     TEXT,
    contacto_telefono   TEXT,
    contacto_whatsapp   TEXT,
    contacto_correo     TEXT,
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO portal_config (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE portal_licencias
    ADD COLUMN plan_id UUID REFERENCES portal_planes(id),
    ADD COLUMN precio_sucursal NUMERIC(12,2) CHECK (precio_sucursal IS NULL OR precio_sucursal >= 0);   -- precio especial (null = el del plan)

INSERT INTO portal_planes (id, codigo, nombre, descripcion, sucursales_incluidas, orden) VALUES
    (gen_random_uuid(), 'basico',        'Básico',        'Una tienda: caja, inventario y facturación electrónica.', 1, 1),
    (gen_random_uuid(), 'profesional',   'Profesional',   'Hasta 3 tiendas con administración central.', 3, 2),
    (gen_random_uuid(), 'multisucursal', 'Multisucursal', 'Cadenas: más de 3 tiendas y soporte prioritario.', 10, 3);

REVOKE ALL ON portal_planes, portal_config FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON portal_planes, portal_config FROM anon, authenticated';
    END IF;
END $$;
