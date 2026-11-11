-- =====================================================================
-- 0112 · Reservas de mesa (restaurantes, bares, discotecas). Operación de la sucursal: no se sincroniza.
-- =====================================================================
CREATE TABLE IF NOT EXISTS reservas (
    id           UUID PRIMARY KEY,
    sucursal_id  UUID NOT NULL REFERENCES sucursales(id),
    mesa_id      UUID REFERENCES mesas(id),               -- puede quedar sin mesa hasta que llegue el cliente
    nombre       TEXT NOT NULL,
    telefono     TEXT,
    personas     SMALLINT NOT NULL CHECK (personas BETWEEN 1 AND 200),
    para         TIMESTAMPTZ NOT NULL,                    -- fecha y hora de la reserva
    nota         TEXT,
    estado       VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','SENTADA','CANCELADA','NO_LLEGO')),
    cuenta_id    UUID REFERENCES cuentas(id),             -- la cuenta que se abrió al sentarlos
    creada_por   UUID REFERENCES usuarios(id),
    creada_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reservas_pendientes ON reservas (sucursal_id, para) WHERE estado = 'PENDIENTE';

REVOKE ALL ON reservas FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON reservas FROM anon, authenticated';
    END IF;
END $$;
