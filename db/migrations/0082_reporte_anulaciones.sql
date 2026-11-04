-- Reportes de control: anulaciones de facturas (notas de crédito E34 y anulaciones internas) por cajero y supervisor.
CREATE VIEW rpt_anulaciones AS
SELECT n.sucursal_id, s.nombre AS sucursal,
       (n.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       n.creado_en AS hora, c.nombre AS caja,
       o.numero_interno AS factura, o.tipo_documento AS tipo_factura,
       n.tipo_documento AS anulacion, n.total,
       uo.nombre AS cajero_factura, ua.nombre AS anulo, us.nombre AS autorizo, n.motivo
FROM ventas n
JOIN ventas o      ON o.id = n.venta_origen_id
JOIN sucursales s  ON s.id = n.sucursal_id
LEFT JOIN cajas c  ON c.id = n.caja_id
LEFT JOIN usuarios uo ON uo.id = o.usuario_id
LEFT JOIN usuarios ua ON ua.id = n.usuario_id
LEFT JOIN usuarios us ON us.id = n.autorizado_por
WHERE n.tipo_documento IN ('E34', 'ANU');

CREATE VIEW rpt_anulaciones_cajero AS
SELECT sucursal_id, sucursal, fecha, anulo AS cajero, COUNT(*) AS anulaciones, SUM(total) AS total,
       COUNT(DISTINCT autorizo) AS supervisores
FROM rpt_anulaciones
GROUP BY sucursal_id, sucursal, fecha, anulo;
