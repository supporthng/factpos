-- =====================================================================
-- 0131 · Números de serie / IMEI y garantía por producto (tiendas de equipos, celulares, computadoras)
--   productos.usa_series: al facturar se piden las series (una por unidad); productos.garantia_meses: vigencia desde la venta.
--   series_producto es operación de la sucursal (no se sincroniza).
-- =====================================================================
ALTER TABLE productos ADD COLUMN IF NOT EXISTS usa_series BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS garantia_meses SMALLINT NOT NULL DEFAULT 0 CHECK (garantia_meses BETWEEN 0 AND 120);

CREATE TABLE IF NOT EXISTS series_producto (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    producto_id     UUID NOT NULL REFERENCES productos(id),
    presentacion_id UUID REFERENCES presentaciones(id),
    serie           TEXT NOT NULL,                       -- serie o IMEI, en mayúsculas y sin espacios
    venta_id        UUID NOT NULL REFERENCES ventas(id),
    venta_item_id   UUID REFERENCES venta_items(id),
    cliente_id      UUID REFERENCES clientes(id),
    vendida_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    garantia_hasta  DATE,                                -- null = sin garantía
    devuelta_en     TIMESTAMPTZ                          -- una serie devuelta (venta anulada) puede venderse otra vez
);
CREATE INDEX IF NOT EXISTS ix_series_serie ON series_producto (serie);
CREATE UNIQUE INDEX IF NOT EXISTS ux_series_vigente ON series_producto (producto_id, serie) WHERE devuelta_en IS NULL;
CREATE INDEX IF NOT EXISTS ix_series_venta ON series_producto (venta_id);
CREATE INDEX IF NOT EXISTS ix_series_cliente ON series_producto (cliente_id);
