-- Productos con existencia 0 o negativa en el almacén principal de cada sucursal (solo los que controlan stock y están activos en esa sucursal),
-- con lo que se vendía (últimos 30 días) y cuándo fue la última venta: sirve para decidir qué reponer primero.
CREATE OR REPLACE VIEW rpt_sin_stock AS
SELECT a.sucursal_id, a.id AS almacen_id, p.id AS producto_id, p.sku, p.nombre,
       COALESCE(e.cantidad, 0) AS existencia,
       COALESCE((SELECT -SUM(k.cantidad) FROM kardex_movimientos k
                  WHERE k.producto_id = p.id AND k.sucursal_id = a.sucursal_id AND k.tipo = 'VENTA'
                    AND k.creado_en >= now() - interval '30 days'), 0) AS vendido_30d,
       (SELECT (MAX(k.creado_en) AT TIME ZONE 'America/Santo_Domingo')::date FROM kardex_movimientos k
         WHERE k.producto_id = p.id AND k.sucursal_id = a.sucursal_id AND k.tipo = 'VENTA') AS ultima_venta
  FROM almacenes a
  JOIN producto_sucursal ps ON ps.sucursal_id = a.sucursal_id AND ps.activo
  JOIN productos p ON p.id = ps.producto_id AND p.activo AND p.controla_stock
  LEFT JOIN existencias e ON e.almacen_id = a.id AND e.producto_id = p.id
 WHERE a.es_principal AND COALESCE(e.cantidad, 0) <= 0;
