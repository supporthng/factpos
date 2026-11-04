-- Historial de ventas traído de otro sistema (p. ej. WilPOS): SOLO consulta y reportes.
-- No son facturas de FactPOS: no tienen e-NCF, no mueven existencias, caja ni cuentas por cobrar y no entran en los reportes fiscales.
CREATE TABLE ventas_historicas (
    id           UUID PRIMARY KEY,
    empresa_id   UUID NOT NULL REFERENCES empresas(id),
    sucursal_id  UUID NOT NULL REFERENCES sucursales(id),
    origen       TEXT NOT NULL,                 -- sistema de origen: 'WilPOS'
    origen_id    TEXT NOT NULL,                 -- número de la venta en ese sistema
    fecha        TIMESTAMPTZ NOT NULL,
    cliente      TEXT NOT NULL DEFAULT '',
    metodo       TEXT NOT NULL DEFAULT '',
    estado       TEXT NOT NULL DEFAULT '',
    descuento    NUMERIC(14,2) NOT NULL DEFAULT 0,
    itbis        NUMERIC(14,2) NOT NULL DEFAULT 0,
    total        NUMERIC(14,2) NOT NULL DEFAULT 0,
    lineas       JSONB NOT NULL DEFAULT '[]',   -- [{producto, cantidad, precio, subtotal}]
    importado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, origen, origen_id)
);
CREATE INDEX ventas_historicas_fecha ON ventas_historicas (empresa_id, fecha);

CREATE VIEW rpt_historial_ventas AS
SELECT h.sucursal_id, s.nombre AS sucursal, h.origen AS sistema, h.origen_id AS numero,
       (h.fecha AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       to_char(h.fecha AT TIME ZONE 'America/Santo_Domingo', 'HH24:MI') AS hora,
       h.cliente, h.metodo, h.estado, h.descuento, h.itbis, h.total,
       jsonb_array_length(h.lineas) AS lineas,
       (SELECT string_agg(l->>'cantidad' || ' x ' || (l->>'producto'), ' | ') FROM jsonb_array_elements(h.lineas) l) AS detalle
FROM ventas_historicas h JOIN sucursales s ON s.id = h.sucursal_id;

CREATE VIEW rpt_historial_ventas_producto AS
SELECT h.sucursal_id, s.nombre AS sucursal, h.origen AS sistema,
       (h.fecha AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       l->>'producto' AS producto,
       SUM(COALESCE(NULLIF(l->>'cantidad', '')::numeric, 0)) AS cantidad,
       SUM(COALESCE(NULLIF(l->>'subtotal', '')::numeric, 0)) AS importe,
       COUNT(DISTINCT h.id) AS ventas
FROM ventas_historicas h JOIN sucursales s ON s.id = h.sucursal_id, jsonb_array_elements(h.lineas) l
WHERE h.estado NOT ILIKE 'anulad%' AND h.estado NOT ILIKE 'cancelad%'
GROUP BY h.sucursal_id, s.nombre, h.origen, (h.fecha AT TIME ZONE 'America/Santo_Domingo')::date, l->>'producto';
