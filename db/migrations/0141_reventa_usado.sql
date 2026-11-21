-- =====================================================================
-- 0141 · Reventa de mercancía recuperada como USADO
--   Al marcar «Lista para la venta» un artículo recuperado, se crea un producto «… (USADO)» con su precio de usado y garantía
--   reducida, la mercancía sale del almacén «Recuperada» y entra al piso de venta. Se factura con la venta de siempre (con su serie).
--   recuperacion_items.producto_usado_id enlaza el artículo recuperado con ese producto.
-- =====================================================================
ALTER TABLE recuperacion_items ADD COLUMN IF NOT EXISTS producto_usado_id UUID REFERENCES productos(id);
ALTER TABLE recuperacion_items ADD COLUMN IF NOT EXISTS garantia_meses SMALLINT NOT NULL DEFAULT 3 CHECK (garantia_meses BETWEEN 0 AND 60);
