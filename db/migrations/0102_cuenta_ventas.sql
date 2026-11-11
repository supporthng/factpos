-- Las ventas (comprobantes) en que se cobró una cuenta: una por persona al dividir por producto o por asiento,
-- o una sola con varios pagos al dividir en partes iguales o por monto.
CREATE TABLE IF NOT EXISTS cuenta_ventas (
    cuenta_id  UUID NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
    venta_id   UUID NOT NULL REFERENCES ventas(id),
    PRIMARY KEY (cuenta_id, venta_id)
);
REVOKE ALL ON cuenta_ventas FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON cuenta_ventas FROM anon, authenticated';
    END IF;
END $$;
