-- =====================================================================
-- 0020 · Entradas y salidas de caja; cuentas por cobrar
--   * Retiros de efectivo y gastos pagados desde la gaveta, con
--     aprobación del supervisor, que restan en el cuadre del turno.
--   * Abonos de clientes a crédito en la caja (efectivo, tarjeta o
--     transferencia) y en la oficina.
--   * Los movimientos de cuentas por cobrar bajan a todas las sucursales:
--     un cliente que compra fiado en una tienda y paga en otra tiene un
--     solo saldo.
-- =====================================================================

ALTER TABLE movimientos_caja ADD COLUMN forma_pago   VARCHAR(15) NOT NULL DEFAULT 'EFECTIVO'
    CHECK (forma_pago IN ('EFECTIVO','TARJETA','TRANSFERENCIA'));
ALTER TABLE movimientos_caja ADD COLUMN referencia   VARCHAR(40);   -- aprobación de la tarjeta / transferencia
ALTER TABLE movimientos_caja ADD COLUMN categoria    VARCHAR(30);   -- del gasto: Transporte, Limpieza...
ALTER TABLE movimientos_caja ADD COLUMN comprobante  VARCHAR(19);   -- NCF de la factura del gasto (para el 606)
ALTER TABLE movimientos_caja ADD COLUMN beneficiario TEXT;          -- a quién se le pagó / quién se llevó el dinero
ALTER TABLE movimientos_caja ADD COLUMN cliente_id   UUID REFERENCES clientes(id);
CREATE INDEX ix_movcaja_fecha ON movimientos_caja (sucursal_id, creado_en);

-- Solo el efectivo entra o sale de la gaveta
CREATE OR REPLACE VIEW rpt_cuadre_turno AS
SELECT t.id AS turno_id, t.sucursal_id, t.caja_id, t.usuario_id, t.abierto_en, t.cerrado_en,
       t.fondo_inicial,
       COALESCE((SELECT SUM(CASE WHEN v.tipo_documento = 'E34' THEN -pg.monto ELSE pg.monto END)
                 FROM ventas v JOIN venta_pagos pg ON pg.venta_id = v.id
                 WHERE v.turno_id = t.id AND pg.forma_pago = 'EFECTIVO'), 0)       AS ventas_efectivo,
       COALESCE((SELECT SUM(m.monto) FROM movimientos_caja m
                 WHERE m.turno_id = t.id AND m.forma_pago = 'EFECTIVO'
                   AND m.tipo IN ('DEPOSITO','ABONO_CLIENTE','LIQUIDACION_DELIVERY')), 0) AS entradas,
       COALESCE((SELECT SUM(m.monto) FROM movimientos_caja m
                 WHERE m.turno_id = t.id AND m.tipo IN ('RETIRO','GASTO')), 0)          AS salidas
FROM turnos t;

-- Cuentas por cobrar
ALTER TABLE cxc_movimientos ADD COLUMN version    BIGINT NOT NULL DEFAULT nextval('sync_kardex');
ALTER TABLE cxc_movimientos ADD COLUMN forma_pago VARCHAR(15);
ALTER TABLE cxc_movimientos ADD COLUMN referencia VARCHAR(40);
ALTER TABLE cxc_movimientos ADD COLUMN notas      TEXT;
ALTER TABLE cxc_movimientos ADD COLUMN autorizado_por UUID REFERENCES usuarios(id);
CREATE INDEX ix_cxc_cliente ON cxc_movimientos (cliente_id, creado_en);
CREATE INDEX ix_cxc_version ON cxc_movimientos (version);

-- Días de crédito que se le dan al cliente (para saber qué está vencido)
ALTER TABLE clientes ADD COLUMN dias_credito SMALLINT NOT NULL DEFAULT 30 CHECK (dias_credito BETWEEN 0 AND 365);

-- Antigüedad de saldos: cada abono paga primero lo más viejo
CREATE VIEW rpt_cxc_antiguedad AS
WITH cargos AS (
    SELECT m.cliente_id, m.creado_en, m.monto,
           SUM(m.monto) OVER (PARTITION BY m.cliente_id ORDER BY m.creado_en, m.id) AS acumulado
      FROM cxc_movimientos m WHERE m.monto > 0
), pagado AS (
    SELECT cliente_id, -COALESCE(SUM(monto), 0) AS total FROM cxc_movimientos WHERE monto < 0 GROUP BY cliente_id
), pendiente AS (
    SELECT c.cliente_id, c.creado_en,
           GREATEST(0, LEAST(c.monto, c.acumulado - COALESCE(p.total, 0))) AS debe
      FROM cargos c LEFT JOIN pagado p ON p.cliente_id = c.cliente_id
)
SELECT cl.empresa_id, cl.id AS cliente_id, cl.nombre, cl.documento, cl.telefono, cl.limite_credito, cl.dias_credito,
       (SELECT COALESCE(SUM(monto), 0) FROM cxc_movimientos x WHERE x.cliente_id = cl.id) AS saldo,
       COALESCE(SUM(p.debe) FILTER (WHERE now() - p.creado_en <= make_interval(days => cl.dias_credito)), 0) AS al_dia,
       COALESCE(SUM(p.debe) FILTER (WHERE now() - p.creado_en >  make_interval(days => cl.dias_credito)
                                      AND now() - p.creado_en <= make_interval(days => cl.dias_credito + 30)), 0) AS vencido_30,
       COALESCE(SUM(p.debe) FILTER (WHERE now() - p.creado_en >  make_interval(days => cl.dias_credito + 30)
                                      AND now() - p.creado_en <= make_interval(days => cl.dias_credito + 60)), 0) AS vencido_60,
       COALESCE(SUM(p.debe) FILTER (WHERE now() - p.creado_en >  make_interval(days => cl.dias_credito + 60)), 0) AS vencido_mas,
       MIN(p.creado_en) FILTER (WHERE p.debe > 0) AS deuda_desde,
       (SELECT MAX(x.creado_en) FROM cxc_movimientos x WHERE x.cliente_id = cl.id AND x.tipo = 'ABONO') AS ultimo_abono
FROM clientes cl
LEFT JOIN pendiente p ON p.cliente_id = cl.id
WHERE EXISTS (SELECT 1 FROM cxc_movimientos x WHERE x.cliente_id = cl.id)
GROUP BY cl.id;
