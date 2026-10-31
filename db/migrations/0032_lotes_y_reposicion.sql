-- =====================================================================
-- Lotes y vencimientos de verdad, y datos para la reposición inteligente
--
--  * Las compras guardan el lote y la fecha de vencimiento de cada línea.
--  * existencias_lote: cuánto queda de cada lote en cada almacén. La lleva el
--    mismo trigger del kardex (si el movimiento trae lote), así que también se
--    mantiene sola en la central y en cada sucursal al sincronizar el kardex.
--  * Las salidas (ventas, traspasos, mermas) toman primero lo que vence antes
--    (lo decide el servidor al registrar el movimiento).
--  * rpt_proximos_vencer ahora incluye lo ya vencido (días negativos).
-- =====================================================================

ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS numero_lote VARCHAR(40);
ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS vence_en DATE;

CREATE TABLE IF NOT EXISTS existencias_lote (
    almacen_id      UUID NOT NULL REFERENCES almacenes(id),
    producto_id     UUID NOT NULL REFERENCES productos(id),
    lote_id         UUID NOT NULL REFERENCES lotes(id),
    cantidad        NUMERIC(14,3) NOT NULL DEFAULT 0,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (almacen_id, lote_id)
);
CREATE INDEX IF NOT EXISTS ix_existencias_lote_producto ON existencias_lote (almacen_id, producto_id) WHERE cantidad > 0;
CREATE INDEX IF NOT EXISTS ix_lotes_vence ON lotes (vence_en) WHERE vence_en IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_kardex_venta_fecha ON kardex_movimientos (almacen_id, producto_id, creado_en) WHERE tipo IN ('VENTA', 'DEVOLUCION_VENTA');

-- El trigger del kardex: igual que antes y, además, el saldo por lote
CREATE OR REPLACE FUNCTION fn_kardex_aplicar() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    e existencias%ROWTYPE;
    nueva_cant NUMERIC(14,3);
    nuevo_prom NUMERIC(14,4);
BEGIN
    INSERT INTO existencias (almacen_id, producto_id)
    VALUES (NEW.almacen_id, NEW.producto_id)
    ON CONFLICT DO NOTHING;

    SELECT * INTO e FROM existencias
    WHERE almacen_id = NEW.almacen_id AND producto_id = NEW.producto_id
    FOR UPDATE;                                  -- serializa movimientos del mismo producto

    nueva_cant := e.cantidad + NEW.cantidad;

    IF NEW.cantidad > 0 AND NEW.tipo IN ('SALDO_INICIAL','COMPRA','AJUSTE_ENTRADA','TRANSFERENCIA_ENTRADA','CONTEO_FISICO','DEVOLUCION_VENTA') THEN
        IF NEW.tipo IN ('DEVOLUCION_VENTA','CONTEO_FISICO','AJUSTE_ENTRADA') AND e.costo_promedio > 0 THEN
            NEW.costo_unitario := e.costo_promedio;  -- reingreso al costo vigente
        END IF;
        IF nueva_cant > 0 AND e.cantidad > 0 THEN
            nuevo_prom := ((e.cantidad * e.costo_promedio) + (NEW.cantidad * NEW.costo_unitario)) / nueva_cant;
        ELSE
            nuevo_prom := NEW.costo_unitario;        -- sin existencia previa (o negativa)
        END IF;
    ELSE
        nuevo_prom := e.costo_promedio;
        IF NEW.cantidad < 0 THEN
            NEW.costo_unitario := e.costo_promedio;
        END IF;
    END IF;

    NEW.saldo_cantidad       := nueva_cant;
    NEW.saldo_costo_promedio := nuevo_prom;
    NEW.saldo_valor          := ROUND(nueva_cant * nuevo_prom, 2);

    UPDATE existencias SET
        cantidad       = nueva_cant,
        costo_promedio = nuevo_prom,
        ultimo_costo   = CASE WHEN NEW.tipo = 'COMPRA' THEN NEW.costo_unitario ELSE ultimo_costo END,
        ultima_entrada = CASE WHEN NEW.cantidad > 0 THEN NEW.creado_en ELSE ultima_entrada END,
        ultima_salida  = CASE WHEN NEW.cantidad < 0 THEN NEW.creado_en ELSE ultima_salida END,
        actualizado_en = now()
    WHERE almacen_id = NEW.almacen_id AND producto_id = NEW.producto_id;

    IF NEW.lote_id IS NOT NULL THEN
        INSERT INTO existencias_lote (almacen_id, producto_id, lote_id, cantidad)
        VALUES (NEW.almacen_id, NEW.producto_id, NEW.lote_id, NEW.cantidad)
        ON CONFLICT (almacen_id, lote_id) DO UPDATE
           SET cantidad = existencias_lote.cantidad + EXCLUDED.cantidad, actualizado_en = now();
    END IF;

    RETURN NEW;
END $$;

-- Lo que ya hubiera en el kardex con lote (instalaciones que lo usaron por fuera)
INSERT INTO existencias_lote (almacen_id, producto_id, lote_id, cantidad)
SELECT almacen_id, producto_id, lote_id, SUM(cantidad)
  FROM kardex_movimientos WHERE lote_id IS NOT NULL
 GROUP BY almacen_id, producto_id, lote_id
ON CONFLICT (almacen_id, lote_id) DO UPDATE SET cantidad = EXCLUDED.cantidad;

-- Próximos a vencer (60 días) y ya vencidos, con lo que queda de cada lote
DROP VIEW IF EXISTS rpt_proximos_vencer;
CREATE VIEW rpt_proximos_vencer AS
SELECT a.sucursal_id, el.almacen_id, p.sku, p.nombre, l.numero_lote, l.vence_en,
       el.cantidad,
       l.vence_en - CURRENT_DATE AS dias_para_vencer,
       p.id AS producto_id, a.nombre AS almacen,
       ROUND(el.cantidad * COALESCE(e.costo_promedio, 0), 2) AS valor_al_costo
FROM existencias_lote el
JOIN lotes l      ON l.id = el.lote_id
JOIN productos p  ON p.id = el.producto_id
JOIN almacenes a  ON a.id = el.almacen_id
LEFT JOIN existencias e ON e.almacen_id = el.almacen_id AND e.producto_id = el.producto_id
WHERE el.cantidad > 0 AND l.vence_en IS NOT NULL AND l.vence_en <= CURRENT_DATE + 60;

-- Traspasos: con qué lotes salió cada producto (viaja con el traspaso a la sucursal destino)
ALTER TABLE transferencia_items ADD COLUMN IF NOT EXISTS lotes JSONB;

-- Reposición inteligente: cuánto comprar según lo que REALMENTE se vende.
--   venta diaria = unidades vendidas en los últimos 30 días / 30 (menos devoluciones)
--   existencia útil = existencia − lo que está en lotes ya vencidos
--   objetivo = lo mayor entre el mínimo del producto y 21 días de venta
--              (7 de entrega del proveedor + 14 hasta el próximo pedido), sin pasar del máximo
--   sugerido = objetivo − existencia útil
DROP VIEW IF EXISTS rpt_reposicion;
CREATE VIEW rpt_reposicion AS
WITH vendido AS (
    SELECT k.almacen_id, k.producto_id, -SUM(k.cantidad) AS unidades
      FROM kardex_movimientos k
     WHERE k.tipo IN ('VENTA', 'DEVOLUCION_VENTA') AND k.creado_en >= now() - interval '30 days'
     GROUP BY k.almacen_id, k.producto_id
), vencido AS (
    SELECT el.almacen_id, el.producto_id, SUM(el.cantidad) AS unidades
      FROM existencias_lote el JOIN lotes l ON l.id = el.lote_id
     WHERE el.cantidad > 0 AND l.vence_en < CURRENT_DATE
     GROUP BY el.almacen_id, el.producto_id
), base AS (
    SELECT a.sucursal_id, e.almacen_id, p.id AS producto_id, p.sku, p.nombre,
           e.cantidad AS existencia,
           COALESCE(vc.unidades, 0) AS vencido,
           GREATEST(e.cantidad - COALESCE(vc.unidades, 0), 0) AS existencia_util,
           GREATEST(COALESCE(vd.unidades, 0), 0) / 30.0 AS diaria,
           ps.stock_minimo, ps.stock_maximo
      FROM existencias e
      JOIN almacenes a ON a.id = e.almacen_id AND a.es_principal
      JOIN productos p ON p.id = e.producto_id AND p.activo AND p.tipo = 'INVENTARIABLE'
      LEFT JOIN producto_sucursal ps ON ps.producto_id = p.id AND ps.sucursal_id = a.sucursal_id
      LEFT JOIN vendido vd ON vd.almacen_id = e.almacen_id AND vd.producto_id = e.producto_id
      LEFT JOIN vencido vc ON vc.almacen_id = e.almacen_id AND vc.producto_id = e.producto_id
), calculo AS (
    SELECT b.*,
           LEAST(GREATEST(COALESCE(b.stock_minimo, 0), b.diaria * 21), COALESCE(NULLIF(b.stock_maximo, 0), 1e12)) AS objetivo
      FROM base b
)
SELECT c.sucursal_id, c.almacen_id, c.producto_id, c.sku, c.nombre,
       ROUND(c.existencia, 3) AS existencia,
       ROUND(c.vencido, 3) AS vencido,
       ROUND(c.diaria, 2) AS venta_diaria,
       CASE WHEN c.diaria > 0 THEN ROUND(c.existencia_util / c.diaria, 1) END AS dias_de_inventario,
       c.stock_minimo AS minimo,
       CEIL(c.objetivo - c.existencia_util) AS sugerido_comprar,
       pr.proveedor,
       pr.ultimo_costo AS costo_unitario,
       ROUND(CEIL(c.objetivo - c.existencia_util) * COALESCE(pr.ultimo_costo, 0), 2) AS costo_estimado
  FROM calculo c
  LEFT JOIN LATERAL (
       SELECT pv.nombre AS proveedor, pp.ultimo_costo
         FROM producto_proveedores pp JOIN proveedores pv ON pv.id = pp.proveedor_id
        WHERE pp.producto_id = c.producto_id AND pp.activo
        ORDER BY pp.principal DESC, pp.ultimo_costo NULLS LAST LIMIT 1) pr ON true
 WHERE c.objetivo - c.existencia_util >= 1;
