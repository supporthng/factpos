-- Módulos que una empresa enciende además de los de su tipo de negocio (p. ej. un autolavado con cafetería usa MESAS).
-- Vacío = solo lo que ya trae el tipo: los clientes actuales no cambian.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulos_extra TEXT[] NOT NULL DEFAULT '{}'
    CHECK (modulos_extra <@ ARRAY['MESAS','LAVADO']::TEXT[]);
