-- =====================================================================
-- 0015 · Compras y ofertas con tope de unidades
--
-- * Ofertas con tope: "20 whiskies a 800". Al venderse las 20 unidades la
--   oferta se acaba sola y el resto se cobra a precio normal. El tope se
--   cuenta por sucursal (cada servidor local cuenta sus propias ventas).
-- * Compras: cada línea puede marcarse "comprada en oferta del proveedor"
--   con su costo normal, para saber a cuánto se compró en oferta y hasta
--   dónde se puede bajar el precio de venta.
-- =====================================================================

-- ---- Ofertas con tope ------------------------------------------------
ALTER TABLE ofertas ADD COLUMN unidades_maximas NUMERIC(14,3) CHECK (unidades_maximas IS NULL OR unidades_maximas > 0);

-- Unidades base que llevaron la oferta en cada línea (una caja x12 cuenta 12)
ALTER TABLE venta_items ADD COLUMN unidades_oferta NUMERIC(14,3) NOT NULL DEFAULT 0;
CREATE INDEX ix_venta_items_oferta ON venta_items (oferta_id) WHERE oferta_id IS NOT NULL;

-- Unidades vendidas en cada oferta por sucursal (las notas de crédito las devuelven)
CREATE VIEW v_oferta_vendidas AS
SELECT i.oferta_id, v.sucursal_id,
       SUM(CASE WHEN v.tipo_documento = 'E34' THEN -i.unidades_oferta ELSE i.unidades_oferta END) AS unidades
FROM venta_items i
JOIN ventas v ON v.id = i.venta_id
WHERE i.oferta_id IS NOT NULL
GROUP BY i.oferta_id, v.sucursal_id;

-- ---- Compras ----------------------------------------------------------
ALTER TABLE compras ADD COLUMN numero_factura VARCHAR(30);          -- número de la factura del proveedor
ALTER TABLE compras ADD COLUMN notas TEXT;
CREATE INDEX ix_compras_sucursal_fecha ON compras (sucursal_id, fecha_factura DESC);

ALTER TABLE compra_items ADD COLUMN linea SMALLINT;
ALTER TABLE compra_items ADD COLUMN en_oferta BOOLEAN NOT NULL DEFAULT FALSE;   -- el proveedor la dio en oferta
ALTER TABLE compra_items ADD COLUMN costo_regular NUMERIC(14,4);                -- costo normal (por presentación) cuando vino en oferta
ALTER TABLE compra_items ADD CONSTRAINT ck_costo_regular
    CHECK (NOT en_oferta OR costo_regular IS NULL OR costo_regular >= costo_unitario);
CREATE INDEX ix_compra_items_presentacion ON compra_items (presentacion_id);

-- Las compras registradas no se editan: se corrigen con un ajuste o una devolución
CREATE TRIGGER tr_compras_inmutable      BEFORE UPDATE OR DELETE ON compras      FOR EACH ROW EXECUTE FUNCTION fn_inmutable();
CREATE TRIGGER tr_compra_items_inmutable BEFORE UPDATE OR DELETE ON compra_items FOR EACH ROW EXECUTE FUNCTION fn_inmutable();

-- Historial de costos de compra por producto, por unidad base y sin ITBIS
CREATE VIEW rpt_costos_compra AS
SELECT pr.producto_id, c.sucursal_id, c.id AS compra_id, c.fecha_factura, c.creado_en,
       pv.nombre AS proveedor, ci.en_oferta,
       ROUND(ci.costo_unitario / ci.factor, 4) AS costo_unidad,
       ROUND(ci.costo_regular / ci.factor, 4) AS costo_regular_unidad,
       ci.cantidad * ci.factor AS unidades
FROM compra_items ci
JOIN compras c ON c.id = ci.compra_id
JOIN presentaciones pr ON pr.id = ci.presentacion_id
JOIN proveedores pv ON pv.id = c.proveedor_id;
