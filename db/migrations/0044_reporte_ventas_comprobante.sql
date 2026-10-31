-- Ventas por tipo de comprobante: familia con su prefijo (E = e-CF, B = NCF serie B, FI- = sin comprobante).
-- Las notas de crédito (E34) y anulaciones (ANU) restan en la familia y el tipo de la factura original.
CREATE OR REPLACE VIEW rpt_ventas_comprobante AS
SELECT v.sucursal_id, s.nombre AS sucursal,
       (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       CASE WHEN COALESCE(o.tipo_documento, v.tipo_documento) LIKE 'E%' THEN 'e-CF electrónico'
            WHEN COALESCE(o.tipo_documento, v.tipo_documento) LIKE 'B%' THEN 'NCF serie B'
            ELSE 'Sin comprobante' END AS familia,
       CASE WHEN COALESCE(o.tipo_documento, v.tipo_documento) LIKE 'E%' THEN 'E'
            WHEN COALESCE(o.tipo_documento, v.tipo_documento) LIKE 'B%' THEN 'B'
            ELSE 'FI-' END AS prefijo,
       COALESCE(o.tipo_documento, v.tipo_documento) AS tipo,
       COUNT(*) FILTER (WHERE v.tipo_documento NOT IN ('E34','ANU')) AS facturas,
       COUNT(*) FILTER (WHERE v.tipo_documento IN ('E34','ANU'))     AS anuladas,
       SUM(CASE WHEN v.tipo_documento IN ('E34','ANU') THEN -v.subtotal ELSE v.subtotal END) AS subtotal,
       SUM(CASE WHEN v.tipo_documento IN ('E34','ANU') THEN -v.itbis ELSE v.itbis END)       AS itbis,
       SUM(CASE WHEN v.tipo_documento IN ('E34','ANU') THEN -v.total ELSE v.total END)       AS venta_total
  FROM ventas v
  JOIN sucursales s ON s.id = v.sucursal_id
  LEFT JOIN ventas o ON o.id = v.venta_origen_id AND v.tipo_documento IN ('E34','ANU')
 GROUP BY v.sucursal_id, s.nombre, 3, 4, 5, 6;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON rpt_ventas_comprobante FROM anon, authenticated';
    END IF;
END $$;
