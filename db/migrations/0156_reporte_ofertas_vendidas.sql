-- Ofertas vendidas, por oferta y producto: unidades, venta, descuento dado, costo y utilidad
-- (la utilidad sirve para ver si una oferta se vendió con pérdida).
CREATE OR REPLACE VIEW rpt_ofertas_vendidas AS
SELECT v.sucursal_id,
       (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       o.id AS oferta_id, o.nombre AS oferta, o.tipo,
       p.id AS producto_id, p.sku, p.nombre AS producto,
       v.id AS venta_id,
       i.cantidad * i.factor                                          AS unidades,
       i.total                                                        AS venta_total,
       i.descuento_oferta                                             AS descuento_dado,
       i.total - i.itbis - i.isc                                      AS venta_neta,
       i.cantidad * i.factor * i.costo_unitario                       AS costo
  FROM venta_items i
  JOIN ventas v         ON v.id = i.venta_id AND v.tipo_documento <> 'E34'
  JOIN ofertas o        ON o.id = i.oferta_id
  JOIN presentaciones pr ON pr.id = i.presentacion_id
  JOIN productos p      ON p.id = pr.producto_id;
