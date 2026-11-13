-- Reportes nuevos de inventario y cuentas por cobrar (solo vistas: no cambian datos).

-- Rotación y clasificación ABC: ventas de los últimos 90 días por sucursal. A = el 80 % de la venta, B = el siguiente 15 %, C = el resto.
CREATE OR REPLACE VIEW rpt_rotacion_abc AS
WITH v AS (
    SELECT u.sucursal_id, u.producto_id, SUM(u.unidades) AS unidades, SUM(u.venta_neta) AS venta, SUM(u.utilidad) AS utilidad
      FROM rpt_utilidad_producto u
     WHERE u.fecha >= (now() AT TIME ZONE 'America/Santo_Domingo')::date - 90
     GROUP BY u.sucursal_id, u.producto_id
    HAVING SUM(u.venta_neta) > 0
), t AS (
    SELECT v.*, SUM(v.venta) OVER (PARTITION BY v.sucursal_id) AS total_suc,
           SUM(v.venta) OVER (PARTITION BY v.sucursal_id ORDER BY v.venta DESC, v.producto_id) AS acumulado
      FROM v
)
SELECT t.sucursal_id, t.producto_id, p.sku, p.nombre, c.nombre AS categoria,
       CASE WHEN t.acumulado - t.venta < 0.80 * t.total_suc THEN 'A'
            WHEN t.acumulado - t.venta < 0.95 * t.total_suc THEN 'B' ELSE 'C' END AS clase,
       t.unidades AS vendido_90d, t.venta AS venta_neta_90d, t.utilidad,
       ROUND(100 * t.venta / t.total_suc, 2) AS participacion_pct,
       ROUND(100 * t.acumulado / t.total_suc, 2) AS acumulado_pct,
       COALESCE(ex.cantidad, 0) AS existencia,
       CASE WHEN t.unidades > 0 THEN ROUND(COALESCE(ex.cantidad, 0) / (t.unidades / 90.0), 1) END AS dias_inventario,
       CASE WHEN COALESCE(ex.cantidad, 0) > 0 THEN ROUND(t.unidades * 365.0 / 90 / ex.cantidad, 1) END AS rotacion_anual
  FROM t
  JOIN productos p ON p.id = t.producto_id
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN LATERAL (SELECT SUM(e.cantidad) AS cantidad FROM existencias e JOIN almacenes a ON a.id = e.almacen_id
                      WHERE a.sucursal_id = t.sucursal_id AND e.producto_id = t.producto_id) ex ON TRUE;

-- Stock muerto: con existencia pero sin venderse en 60 días (o nunca). Es dinero parado.
CREATE OR REPLACE VIEW rpt_stock_muerto AS
SELECT x.sucursal_id, x.producto_id, p.sku, p.nombre, c.nombre AS categoria,
       x.existencia, x.costo_promedio, x.valor, x.ultima_venta,
       CASE WHEN x.ultima_venta IS NULL THEN NULL ELSE (now() AT TIME ZONE 'America/Santo_Domingo')::date - x.ultima_venta END AS dias_sin_vender,
       x.ultima_entrada
  FROM (
    SELECT a.sucursal_id, e.producto_id, SUM(e.cantidad) AS existencia,
           ROUND(SUM(e.cantidad * e.costo_promedio) / NULLIF(SUM(e.cantidad), 0), 4) AS costo_promedio,
           ROUND(SUM(e.cantidad * e.costo_promedio), 2) AS valor,
           MAX(e.ultima_entrada)::date AS ultima_entrada,
           (SELECT (MAX(k.creado_en) AT TIME ZONE 'America/Santo_Domingo')::date FROM kardex_movimientos k
             WHERE k.producto_id = e.producto_id AND k.sucursal_id = a.sucursal_id AND k.tipo = 'VENTA') AS ultima_venta
      FROM existencias e JOIN almacenes a ON a.id = e.almacen_id
     GROUP BY a.sucursal_id, e.producto_id
    HAVING SUM(e.cantidad) > 0
  ) x
  JOIN productos p ON p.id = x.producto_id AND p.activo AND p.controla_stock
  LEFT JOIN categorias c ON c.id = p.categoria_id
 WHERE x.ultima_venta IS NULL OR x.ultima_venta < (now() AT TIME ZONE 'America/Santo_Domingo')::date - 60;

-- Utilidad por producto con su categoría y su proveedor principal, para agrupar por cualquiera de los dos
CREATE OR REPLACE VIEW rpt_margen_base AS
SELECT u.sucursal_id, u.fecha, u.producto_id, COALESCE(c.nombre, 'Sin categoría') AS categoria,
       COALESCE(pv.nombre, 'Sin proveedor') AS proveedor,
       u.unidades, u.venta_neta, u.costo, u.utilidad
  FROM rpt_utilidad_producto u
  JOIN productos p ON p.id = u.producto_id
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN LATERAL (SELECT pr.nombre FROM producto_proveedores pp JOIN proveedores pr ON pr.id = pp.proveedor_id
                      WHERE pp.producto_id = p.id AND pp.activo ORDER BY pp.principal DESC, pr.nombre LIMIT 1) pv ON TRUE;

-- Consumo de insumos (los que forman parte de alguna receta o combo): lo gastado al vender frente a mermas y diferencias de conteo
CREATE OR REPLACE VIEW rpt_consumo_insumos AS
SELECT k.sucursal_id, (k.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha, p.id AS producto_id, p.sku, p.nombre, p.unidad_base AS unidad,
       COALESCE(-SUM(k.cantidad) FILTER (WHERE k.tipo = 'VENTA'), 0) AS consumo_teorico,
       COALESCE(-SUM(k.cantidad) FILTER (WHERE k.tipo IN ('MERMA','VENCIMIENTO','CONSUMO_INTERNO')), 0) AS mermas,
       COALESCE(SUM(k.cantidad) FILTER (WHERE k.tipo IN ('AJUSTE_SALIDA','AJUSTE_ENTRADA','CONTEO_FISICO')), 0) AS faltante_sobrante,
       ROUND(COALESCE(-SUM(k.cantidad) FILTER (WHERE k.tipo = 'VENTA'), 0) * p.costo_promedio, 2) AS costo_consumo
  FROM kardex_movimientos k
  JOIN productos p ON p.id = k.producto_id
 WHERE k.tipo IN ('VENTA','MERMA','VENCIMIENTO','CONSUMO_INTERNO','AJUSTE_SALIDA','AJUSTE_ENTRADA','CONTEO_FISICO')
   AND EXISTS (SELECT 1 FROM producto_componentes pc WHERE pc.componente_id = p.id)
 GROUP BY 1, 2, p.id, p.sku, p.nombre, p.unidad_base, p.costo_promedio;

-- Cartera: lo que se debe por antigüedad (lo más viejo se cobra primero), con porcentaje de la cartera
CREATE OR REPLACE VIEW rpt_cartera AS
WITH cargos AS (
    SELECT m.cliente_id, m.creado_en, m.monto,
           SUM(m.monto) OVER (PARTITION BY m.cliente_id ORDER BY m.creado_en, m.id) AS acumulado
      FROM cxc_movimientos m WHERE m.monto > 0
), pagado AS (
    SELECT cliente_id, -COALESCE(SUM(monto), 0) AS total FROM cxc_movimientos WHERE monto < 0 GROUP BY cliente_id
), pendiente AS (
    SELECT c.cliente_id, c.creado_en, GREATEST(0, LEAST(c.monto, c.acumulado - COALESCE(p.total, 0))) AS debe
      FROM cargos c LEFT JOIN pagado p ON p.cliente_id = c.cliente_id
), r AS (
    SELECT cl.empresa_id, cl.id AS cliente_id, cl.nombre, cl.documento, cl.telefono, cl.dias_credito, cl.limite_credito,
           COALESCE(SUM(p.debe), 0) AS cartera,
           COALESCE(SUM(p.debe) FILTER (WHERE now() - p.creado_en <= make_interval(days => cl.dias_credito)), 0) AS al_dia,
           COALESCE(SUM(p.debe) FILTER (WHERE now() - p.creado_en >  make_interval(days => cl.dias_credito)
                                          AND now() - p.creado_en <= make_interval(days => cl.dias_credito + 30)), 0) AS vencido_1_30,
           COALESCE(SUM(p.debe) FILTER (WHERE now() - p.creado_en >  make_interval(days => cl.dias_credito + 30)
                                          AND now() - p.creado_en <= make_interval(days => cl.dias_credito + 60)), 0) AS vencido_31_60,
           COALESCE(SUM(p.debe) FILTER (WHERE now() - p.creado_en >  make_interval(days => cl.dias_credito + 60)
                                          AND now() - p.creado_en <= make_interval(days => cl.dias_credito + 90)), 0) AS vencido_61_90,
           COALESCE(SUM(p.debe) FILTER (WHERE now() - p.creado_en >  make_interval(days => cl.dias_credito + 90)), 0) AS vencido_mas_90,
           MIN(p.creado_en) FILTER (WHERE p.debe > 0) AS deuda_desde,
           (SELECT MAX(x.creado_en) FROM cxc_movimientos x WHERE x.cliente_id = cl.id AND x.tipo = 'ABONO') AS ultimo_abono
      FROM clientes cl LEFT JOIN pendiente p ON p.cliente_id = cl.id
     WHERE EXISTS (SELECT 1 FROM cxc_movimientos x WHERE x.cliente_id = cl.id)
     GROUP BY cl.id
)
SELECT r.empresa_id, r.cliente_id, r.nombre, r.documento, r.telefono, r.dias_credito AS plazo_dias, r.limite_credito,
       r.cartera, r.al_dia, r.vencido_1_30, r.vencido_31_60, r.vencido_61_90, r.vencido_mas_90,
       ROUND(100 * r.cartera / NULLIF(SUM(r.cartera) OVER (PARTITION BY r.empresa_id), 0), 2) AS participacion_pct,
       (r.deuda_desde AT TIME ZONE 'America/Santo_Domingo')::date AS deuda_desde,
       (r.ultimo_abono AT TIME ZONE 'America/Santo_Domingo')::date AS ultimo_abono
  FROM r WHERE r.cartera > 0;

-- Cobros (abonos de clientes): por día, usuario y forma de pago
CREATE OR REPLACE VIEW rpt_cobros AS
SELECT m.sucursal_id, s.empresa_id, (m.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       cl.nombre AS cliente, u.nombre AS cobrado_por, COALESCE(m.forma_pago, 'EFECTIVO') AS forma_pago, m.referencia,
       -m.monto AS cobrado
  FROM cxc_movimientos m
  JOIN sucursales s ON s.id = m.sucursal_id
  JOIN clientes cl ON cl.id = m.cliente_id
  JOIN usuarios u ON u.id = m.usuario_id
 WHERE m.tipo = 'ABONO' AND m.monto < 0;
