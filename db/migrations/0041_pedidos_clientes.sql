-- =====================================================================
-- 0041 · Pedidos de clientes (venta al por mayor)
--   El vendedor anota el pedido en la Administración y lo envía a una caja como comanda.
--   La caja lo ve, lo va alistando (con el personal que lo prepara) y, cuando está completo,
--   lo factura como una venta normal.
--     PENDIENTE → LISTO (todo alistado) → FACTURADO      (o CANCELADO antes de facturar)
-- =====================================================================
CREATE TABLE IF NOT EXISTS pedidos_clientes (
    id             UUID PRIMARY KEY,
    numero         BIGSERIAL,
    empresa_id     UUID NOT NULL REFERENCES empresas(id),
    sucursal_id    UUID NOT NULL REFERENCES sucursales(id),
    caja_id        UUID REFERENCES cajas(id),            -- caja que lo atiende; vacío = cualquiera de la sucursal
    cliente_id     UUID REFERENCES clientes(id),
    cliente_nombre TEXT NOT NULL,
    telefono       VARCHAR(30),
    nota           TEXT,
    preparado_por  TEXT,                                 -- personal que alista el pedido
    estado         VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','LISTO','FACTURADO','CANCELADO')),
    creado_por     UUID REFERENCES usuarios(id),
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    listo_en       TIMESTAMPTZ,
    venta_id       UUID,                                 -- factura con la que se cerró
    facturado_en   TIMESTAMPTZ,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pedidos_clientes_estado ON pedidos_clientes (sucursal_id, estado);

CREATE TABLE IF NOT EXISTS pedidos_clientes_items (
    id              UUID PRIMARY KEY,
    pedido_id       UUID NOT NULL REFERENCES pedidos_clientes(id) ON DELETE CASCADE,
    presentacion_id UUID NOT NULL REFERENCES presentaciones(id),
    cantidad        NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
    nota            TEXT,
    alistado        BOOLEAN NOT NULL DEFAULT FALSE,
    orden           INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_pedidos_clientes_items ON pedidos_clientes_items (pedido_id);

REVOKE ALL ON pedidos_clientes, pedidos_clientes_items FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON pedidos_clientes, pedidos_clientes_items FROM anon, authenticated';
    END IF;
END $$;
