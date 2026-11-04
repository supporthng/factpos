-- «Pérdidas» mostraba también las ENTRADAS (existencia inicial del importador, ajustes de entrada) y las sumaba como si fueran pérdida.
-- Ahora solo muestra lo que sale: mermas, vencimientos, ajustes de salida, consumo interno y diferencias negativas de conteo.
-- El valor se muestra en positivo (lo que costó la pérdida). Las entradas siguen en el reporte «Detalle de ajustes».
CREATE OR REPLACE VIEW rpt_perdidas AS
SELECT k.sucursal_id,
       (k.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       k.tipo, p.sku, p.nombre, k.usuario_id, k.motivo,
       k.cantidad, ROUND(ABS(k.cantidad * k.costo_unitario), 2) AS valor
FROM kardex_movimientos k
JOIN productos p ON p.id = k.producto_id
WHERE k.tipo IN ('MERMA','VENCIMIENTO','AJUSTE_SALIDA','CONSUMO_INTERNO')
   OR (k.tipo = 'CONTEO_FISICO' AND k.cantidad < 0);
