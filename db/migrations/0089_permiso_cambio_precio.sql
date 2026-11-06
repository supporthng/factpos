-- Permiso propio para aprobar el cambio de precio de una línea (los 3 precios definidos):
-- antes se aprobaba con "Aprobar descuentos". Los roles que ya aprobaban descuentos lo reciben para que nada cambie.
UPDATE roles SET permisos = array_append(permisos, 'venta.precio')
 WHERE 'venta.descuento' = ANY(permisos) AND NOT ('venta.precio' = ANY(permisos)) AND NOT ('*' = ANY(permisos));
