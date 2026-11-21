-- =====================================================================
-- 0139 · Recuperación de mercancía por incumplimiento de pago (mueblería)
--   · recuperaciones: el acta (RM-000001 por sucursal) de lo que se recoge a un cliente en mora, con su valoración.
--     Al aplicarla se descuenta lo valorado de la deuda (ajuste de cuenta) y la mercancía entra al almacén «Recuperada».
--   · recuperacion_items: cada artículo recogido (con su serie), su estado físico, lo que se le reconoce al cliente,
--     la reparación y el precio de usado, y en qué proceso va (revisión, reparación, lista, vendida).
--   Es operación de la sucursal (no se sincroniza). La nota de crédito fiscal (E34) y la reventa como USADO van aparte.
-- =====================================================================
CREATE TABLE IF NOT EXISTS recuperaciones (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    numero          BIGINT NOT NULL,
    cliente_id      UUID NOT NULL REFERENCES clientes(id),
    plan_id         UUID REFERENCES cxc_planes(id),
    venta_id        UUID,                                   -- factura de origen
    estado          VARCHAR(10) NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA','APLICADA','CANCELADA')),
    motivo          TEXT NOT NULL,
    fecha_recogida  DATE NOT NULL DEFAULT CURRENT_DATE,
    saldo_antes     NUMERIC(14,2),                          -- deuda del cliente al aplicar
    valor_total     NUMERIC(14,2) NOT NULL DEFAULT 0,       -- suma de lo valorado
    saldo_despues   NUMERIC(14,2),
    ajuste_id       UUID,                                   -- el movimiento de cuenta que descontó la deuda
    creada_por      UUID REFERENCES usuarios(id),
    aplicada_por    UUID REFERENCES usuarios(id),
    creada_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    aplicada_en     TIMESTAMPTZ,
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_recuperaciones_cliente ON recuperaciones (cliente_id, creada_en DESC);

CREATE TABLE IF NOT EXISTS recuperacion_items (
    id              UUID PRIMARY KEY,
    recuperacion_id UUID NOT NULL REFERENCES recuperaciones(id) ON DELETE CASCADE,
    producto_id     UUID NOT NULL REFERENCES productos(id),
    presentacion_id UUID REFERENCES presentaciones(id),
    descripcion     TEXT NOT NULL,
    serie           TEXT,
    cantidad        NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),   -- en unidad base
    estado_fisico   VARCHAR(10) NOT NULL DEFAULT 'REGULAR' CHECK (estado_fisico IN ('BUENO','REGULAR','DANADO')),
    valoracion      NUMERIC(14,2) NOT NULL CHECK (valoracion >= 0), -- lo que se le reconoce al cliente por este artículo
    costo_reparacion NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo_reparacion >= 0),
    precio_usado    NUMERIC(14,2) CHECK (precio_usado IS NULL OR precio_usado >= 0),
    proceso         VARCHAR(12) NOT NULL DEFAULT 'EN_REVISION' CHECK (proceso IN ('EN_REVISION','EN_REPARACION','LISTA','VENDIDA')),
    nota            TEXT
);
CREATE INDEX IF NOT EXISTS ix_recuperacion_items_acta ON recuperacion_items (recuperacion_id);
