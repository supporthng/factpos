-- Los precios 2 y 3 se definen una sola vez como un % de descuento sobre el precio 1 (0 = se usan los precios por producto de siempre).
ALTER TABLE listas_precio ADD COLUMN IF NOT EXISTS descuento_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct < 100);
-- Lo que se descontó en la línea por el nivel de precio del cliente (sale en la factura como descuento)
ALTER TABLE venta_items ADD COLUMN IF NOT EXISTS descuento_nivel NUMERIC(14,2) NOT NULL DEFAULT 0;
