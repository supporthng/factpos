-- =====================================================================
-- 0029 · Licencias de FactPOS
--   * licencia: en la nube de CADA CLIENTE (y copiada a sus sucursales).
--     Guarda la licencia firmada por el proveedor y el inicio de la prueba.
--   * portal_*: solo en el PORTAL del proveedor (MODO=portal). Clientes,
--     licencias y activaciones. Ningún dato de ventas ni de productos.
-- =====================================================================
CREATE TABLE licencia (
    id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    instalacion_id   UUID NOT NULL,                  -- identifica esta nube ante el portal
    token            TEXT,                           -- licencia firmada (null = prueba)
    secreto          TEXT,                           -- para renovar (solo en la nube del cliente)
    portal_url       TEXT,
    prueba_desde     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_contacto  TIMESTAMPTZ,
    ultimo_error     TEXT,
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE portal_clientes (
    id          UUID PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
    nombre      TEXT NOT NULL,
    rnc         VARCHAR(11),
    contacto    TEXT,
    correo      TEXT,
    telefono    TEXT,
    api_url     TEXT,                                -- la API de SU nube (Vercel del cliente)
    notas       TEXT,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE portal_licencias (
    id                UUID PRIMARY KEY,
    cliente_id        UUID NOT NULL UNIQUE REFERENCES portal_clientes(id),
    sucursales        INTEGER NOT NULL CHECK (sucursales BETWEEN 1 AND 999),
    modulos           TEXT[] NOT NULL DEFAULT '{}',
    vence             DATE NOT NULL,
    estado            TEXT NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA', 'SUSPENDIDA')),
    clave_hash        TEXT UNIQUE,                   -- clave de activación (solo su huella)
    clave_pista       TEXT,                          -- últimos 4 caracteres, para reconocerla
    instalacion_id    UUID,                          -- nube del cliente donde quedó activada
    secreto_hash      TEXT,
    activada_en       TIMESTAMPTZ,
    ultimo_contacto   TIMESTAMPTZ,
    version_app       TEXT,
    sucursales_en_uso INTEGER,
    notas             TEXT,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE portal_eventos (
    id          UUID PRIMARY KEY,
    licencia_id UUID REFERENCES portal_licencias(id),
    cliente_id  UUID REFERENCES portal_clientes(id),
    tipo        TEXT NOT NULL,          -- CREADA, RENOVADA, ACTIVADA, LIBERADA, SUSPENDIDA, CLAVE_NUEVA, CONTACTO_RECHAZADO
    detalle     JSONB,
    usuario_id  UUID REFERENCES usuarios(id),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_portal_eventos ON portal_eventos (cliente_id, creado_en DESC);

REVOKE ALL ON licencia, portal_clientes, portal_licencias, portal_eventos FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON licencia, portal_clientes, portal_licencias, portal_eventos FROM anon, authenticated';
    END IF;
END $$;
