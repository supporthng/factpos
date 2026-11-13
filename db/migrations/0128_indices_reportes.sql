-- Índices para que los reportes pesados no recorran todo el historial (no cambian datos ni resultados).

-- Reportes de ventas por sucursal y rango de fechas (utilidad, más vendidos, margen, rotación ABC…)
CREATE INDEX IF NOT EXISTS ix_ventas_sucursal_fecha ON ventas (sucursal_id, creado_en);

-- Líneas de cada venta: casi todos los reportes de ventas unen por venta_id
CREATE INDEX IF NOT EXISTS ix_venta_items_venta ON venta_items (venta_id);

-- Última venta de un producto en una sucursal (stock muerto, sin stock) y consumo de insumos
CREATE INDEX IF NOT EXISTS ix_kardex_venta_producto_sucursal ON kardex_movimientos (producto_id, sucursal_id, creado_en DESC) WHERE tipo = 'VENTA';
