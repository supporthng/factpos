-- 0108 · Reporte de entradas por noche (discotecas, bares): cuántas entradas de cada tipo y cuánto ingresaron.
--   Una «noche» empieza y termina a las 6:00 a. m. (lo vendido de madrugada cuenta para la noche anterior).
--   Las entradas son los productos de la categoría elegida en Datos de la empresa › Entradas y aforo; las devoluciones (E34) restan.
CREATE OR REPLACE VIEW rpt_entradas_noche AS
SELECT v.sucursal_id, s.nombre AS sucursal,
       ((v.creado_en AT TIME ZONE 'America/Santo_Domingo') - interval '6 hours')::date AS fecha,
       p.nombre AS entrada,
       SUM(CASE WHEN v.tipo_documento = 'E34' THEN -i.cantidad ELSE i.cantidad END) AS cantidad,
       SUM(CASE WHEN v.tipo_documento = 'E34' THEN -i.total ELSE i.total END) AS importe,
       COUNT(DISTINCT v.id) AS ventas
  FROM ventas v
  JOIN sucursales s ON s.id = v.sucursal_id
  JOIN empresas e ON e.id = s.empresa_id AND e.aforo_categoria_id IS NOT NULL
  JOIN venta_items i ON i.venta_id = v.id
  JOIN presentaciones pr ON pr.id = i.presentacion_id
  JOIN productos p ON p.id = pr.producto_id AND p.categoria_id = e.aforo_categoria_id
 GROUP BY 1, 2, 3, 4;
