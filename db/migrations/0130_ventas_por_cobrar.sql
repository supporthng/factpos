-- =====================================================================
-- 0130 · Ventas por cobrar: el vendedor arma la venta en administración y la envía a una caja; la caja la cobra.
--   Es operación de la sucursal (no se sincroniza). El comprobante fiscal se emite al cobrar.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ventas_por_cobrar (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    numero          BIGINT NOT NULL,                       -- consecutivo por sucursal
    caja_id         UUID NOT NULL REFERENCES cajas(id),    -- la caja que la cobra
    cliente_id      UUID REFERENCES clientes(id),
    items           JSONB NOT NULL,                        -- [{presentacionId, cantidad, descuentoManual?, precioVariable?, precioLibre?}]
    total           NUMERIC(14,2) NOT NULL,                -- total al enviarla (referencia; al cobrar se recalcula)
    notas           TEXT,
    motivo_descuento TEXT,
    motivo_precio   TEXT,
    estado          VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','COBRADA','ANULADA')),
    creada_por      UUID REFERENCES usuarios(id),
    creada_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    cerrada_en      TIMESTAMPTZ,
    cerrada_por     UUID REFERENCES usuarios(id),
    venta_id        UUID,
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_ventas_por_cobrar_caja ON ventas_por_cobrar (caja_id) WHERE estado = 'PENDIENTE';
