-- =====================================================================
-- 0140 · Entregas programadas (mueblería y electrodomésticos)
--   · entregas: la entrega de una factura (todo o parte) a la casa del cliente, con fecha, franja, chofer y camión.
--     Estados: PROGRAMADA → EN_RUTA → ENTREGADA (o NO_ENTREGADA para reprogramar, o CANCELADA).
--     Al entregar queda quién recibió (nombre y cédula) y las observaciones de daños o faltantes.
--   · entrega_items: lo que lleva cada entrega (con sus series). Una factura puede entregarse en varias veces.
--   El documento que se le da al chofer no lleva precios ni saldos. Es operación de la sucursal (no se sincroniza).
-- =====================================================================
CREATE TABLE IF NOT EXISTS entregas (
    id               UUID PRIMARY KEY,
    sucursal_id      UUID NOT NULL REFERENCES sucursales(id),
    numero           BIGINT NOT NULL,
    venta_id         UUID NOT NULL REFERENCES ventas(id),
    cliente_id       UUID REFERENCES clientes(id),
    estado           VARCHAR(12) NOT NULL DEFAULT 'PROGRAMADA' CHECK (estado IN ('PROGRAMADA','EN_RUTA','ENTREGADA','NO_ENTREGADA','CANCELADA')),
    fecha_programada DATE NOT NULL,
    franja           VARCHAR(12) NOT NULL DEFAULT 'DIA' CHECK (franja IN ('MANANA','TARDE','DIA')),
    direccion        TEXT NOT NULL,
    referencia       TEXT,
    telefono         VARCHAR(30),
    telefono2        VARCHAR(30),
    instrucciones    TEXT,                           -- escaleras, armado, retirar mueble viejo, hora preferida…
    repartidor_id    UUID REFERENCES repartidores(id),
    vehiculo         VARCHAR(40),                    -- camión o placa
    orden            SMALLINT NOT NULL DEFAULT 0,    -- posición en la hoja de ruta del día
    salida_en        TIMESTAMPTZ,
    entregada_en     TIMESTAMPTZ,
    recibe_nombre    TEXT,
    recibe_cedula    VARCHAR(20),
    observaciones    TEXT,                           -- daños o faltantes anotados al entregar
    motivo_no_entrega TEXT,
    creada_por       UUID REFERENCES usuarios(id),
    creada_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_entregas_fecha ON entregas (sucursal_id, fecha_programada, estado);
CREATE INDEX IF NOT EXISTS ix_entregas_venta ON entregas (venta_id);

CREATE TABLE IF NOT EXISTS entrega_items (
    id             UUID PRIMARY KEY,
    entrega_id     UUID NOT NULL REFERENCES entregas(id) ON DELETE CASCADE,
    venta_item_id  UUID NOT NULL REFERENCES venta_items(id),
    descripcion    TEXT NOT NULL,
    cantidad       NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
    series         TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_entrega_items_entrega ON entrega_items (entrega_id);
CREATE INDEX IF NOT EXISTS ix_entrega_items_venta_item ON entrega_items (venta_item_id);
