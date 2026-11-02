-- Cada PC queda ligada a su caja de forma definitiva la primera vez que abre FactPOS.
-- Tabla local (no se sincroniza): cada servidor sabe qué equipos atiende.
CREATE TABLE IF NOT EXISTS cajas_equipos (
    caja_id    UUID PRIMARY KEY REFERENCES cajas(id),
    equipo_id  TEXT NOT NULL UNIQUE,
    asignado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
