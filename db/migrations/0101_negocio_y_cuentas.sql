-- =====================================================================
-- 0101 · Tipo de negocio y cuentas abiertas (restaurantes, bares, discotecas)
--   Todo es aditivo y queda APAGADO: una empresa es 'TIENDA' (como hasta hoy) mientras no se cambie.
--   Una cuenta agrupa lo que consume una mesa o un cliente; se divide en «asientos» (personas) ANTES de ordenar
--   y se puede dividir DESPUÉS, al cobrar. No se sincroniza: es operación de la sucursal.
-- =====================================================================
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tipo_negocio VARCHAR(12) NOT NULL DEFAULT 'TIENDA'
    CHECK (tipo_negocio IN ('TIENDA','RESTAURANTE','BAR','DISCOTECA','COMIDA_RAPIDA'));

CREATE TABLE IF NOT EXISTS cuentas (
    id           UUID PRIMARY KEY,
    sucursal_id  UUID NOT NULL REFERENCES sucursales(id),
    numero       BIGINT NOT NULL,                       -- consecutivo por sucursal
    nombre       TEXT NOT NULL,                         -- «Mesa 4», «Juan», «VIP 2»
    mesa         TEXT,
    estado       VARCHAR(10) NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA','COBRADA','ANULADA')),
    nota         TEXT,
    abierta_por  UUID REFERENCES usuarios(id),
    abierta_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    cerrada_en   TIMESTAMPTZ,
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_cuentas_abiertas ON cuentas (sucursal_id) WHERE estado = 'ABIERTA';

CREATE TABLE IF NOT EXISTS cuenta_asientos (
    id         UUID PRIMARY KEY,
    cuenta_id  UUID NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
    nombre     TEXT NOT NULL,                           -- «Persona 1», «María»
    orden      SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cuenta_lineas (
    id               UUID PRIMARY KEY,
    cuenta_id        UUID NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
    asiento_id       UUID REFERENCES cuenta_asientos(id) ON DELETE SET NULL,   -- null = de toda la mesa
    presentacion_id  UUID NOT NULL REFERENCES presentaciones(id),
    descripcion      TEXT NOT NULL,
    cantidad         NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
    precio_unitario  NUMERIC(14,2) NOT NULL,
    tasa_itbis       NUMERIC(7,4) NOT NULL,
    nota             TEXT,
    enviada_en       TIMESTAMPTZ,                       -- ya salió a la barra o cocina: moverla o anularla pide supervisor
    anulada          BOOLEAN NOT NULL DEFAULT FALSE,
    creada_por       UUID REFERENCES usuarios(id),
    creada_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cuenta_lineas ON cuenta_lineas (cuenta_id);

REVOKE ALL ON cuentas, cuenta_asientos, cuenta_lineas FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON cuentas, cuenta_asientos, cuenta_lineas FROM anon, authenticated';
    END IF;
END $$;
