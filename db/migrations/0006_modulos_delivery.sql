-- =====================================================================
-- 0006 · Módulos activables por sucursal + Delivery
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración y módulos por sucursal (se administra desde la central)
-- Ejemplo de `modulos`:
--   {"delivery": {"activo": true, "cargoEnvio": "50.00", "productoEnvioId": "...", "tiempoEstimadoMin": 30}}
-- ---------------------------------------------------------------------
CREATE TABLE configuracion_sucursal (
    sucursal_id     UUID PRIMARY KEY REFERENCES sucursales(id),
    modulos         JSONB NOT NULL DEFAULT '{}'::jsonb,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER tr_configuracion_sucursal_version BEFORE INSERT OR UPDATE ON configuracion_sucursal
    FOR EACH ROW EXECUTE FUNCTION fn_version();

-- ---------------------------------------------------------------------
-- Repartidores
-- ---------------------------------------------------------------------
CREATE TABLE repartidores (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    nombre          TEXT NOT NULL,
    telefono        VARCHAR(20),
    vehiculo        VARCHAR(30),                -- motor, bicicleta, a pie
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER tr_repartidores_version BEFORE INSERT OR UPDATE ON repartidores
    FOR EACH ROW EXECUTE FUNCTION fn_version();

-- ---------------------------------------------------------------------
-- Pedidos de delivery
--   RECIBIDO → DESPACHADO (se registra la venta, sale el inventario)
--            → ENTREGADO → LIQUIDADO (el dinero entra a la caja)
--   RECIBIDO → CANCELADO (antes de despachar, sin efectos)
-- ---------------------------------------------------------------------
CREATE TABLE pedidos_delivery (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    caja_id         UUID NOT NULL REFERENCES cajas(id),
    numero          BIGINT NOT NULL,
    canal           VARCHAR(10) NOT NULL DEFAULT 'TELEFONO' CHECK (canal IN ('TELEFONO','WHATSAPP','WEB','OTRO')),
    cliente_id      UUID REFERENCES clientes(id),
    nombre_cliente  TEXT NOT NULL,
    telefono        VARCHAR(20) NOT NULL,
    direccion       TEXT NOT NULL,
    referencia      TEXT,                       -- "frente al colmado X, casa verde"
    items           JSONB NOT NULL,             -- carrito: [{presentacionId, cantidad}]
    cupon_codigo    VARCHAR(30),
    cargo_envio     NUMERIC(14,2) NOT NULL DEFAULT 0,
    paga_con        NUMERIC(14,2),              -- "lleva cambio de RD$1,000"
    forma_pago_esperada VARCHAR(15) NOT NULL DEFAULT 'EFECTIVO' CHECK (forma_pago_esperada IN ('EFECTIVO','TARJETA','TRANSFERENCIA')),
    nota            TEXT,
    estado          VARCHAR(12) NOT NULL DEFAULT 'RECIBIDO'
                    CHECK (estado IN ('RECIBIDO','DESPACHADO','ENTREGADO','LIQUIDADO','CANCELADO')),
    repartidor_id   UUID REFERENCES repartidores(id),
    venta_id        UUID REFERENCES ventas(id),
    total           NUMERIC(14,2),
    recibido_por    UUID NOT NULL REFERENCES usuarios(id),
    recibido_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    despachado_en   TIMESTAMPTZ,
    entregado_en    TIMESTAMPTZ,
    liquidado_en    TIMESTAMPTZ,
    cancelado_en    TIMESTAMPTZ,
    motivo_cancelacion TEXT,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX ix_pedidos_estado ON pedidos_delivery (sucursal_id, estado);
CREATE INDEX ix_pedidos_telefono ON pedidos_delivery (telefono);
CREATE TRIGGER tr_pedidos_delivery_version BEFORE INSERT OR UPDATE ON pedidos_delivery
    FOR EACH ROW EXECUTE FUNCTION fn_version();

-- La venta despachada se paga con "DELIVERY" (dinero en manos del repartidor);
-- al liquidar, el efectivo entra a la caja como movimiento de caja.
ALTER TABLE venta_pagos DROP CONSTRAINT venta_pagos_forma_pago_check;
ALTER TABLE venta_pagos ADD CONSTRAINT venta_pagos_forma_pago_check
    CHECK (forma_pago IN ('EFECTIVO','TARJETA','TRANSFERENCIA','CREDITO','DELIVERY','OTRO'));

ALTER TABLE movimientos_caja DROP CONSTRAINT movimientos_caja_tipo_check;
ALTER TABLE movimientos_caja ADD CONSTRAINT movimientos_caja_tipo_check
    CHECK (tipo IN ('RETIRO','DEPOSITO','GASTO','ABONO_CLIENTE','APERTURA_GAVETA','LIQUIDACION_DELIVERY'));
DROP VIEW rpt_cuadre_turno;  -- se recrea abajo; la vista impide ampliar la columna
ALTER TABLE movimientos_caja ALTER COLUMN tipo TYPE VARCHAR(25);
ALTER TABLE movimientos_caja ADD COLUMN repartidor_id UUID REFERENCES repartidores(id);

-- Cuadre de turno: las liquidaciones de delivery cuentan como entrada de efectivo
CREATE OR REPLACE VIEW rpt_cuadre_turno AS
SELECT t.id AS turno_id, t.sucursal_id, t.caja_id, t.usuario_id, t.abierto_en, t.cerrado_en,
       t.fondo_inicial,
       COALESCE((SELECT SUM(CASE WHEN v.tipo_documento = 'E34' THEN -pg.monto ELSE pg.monto END)
                 FROM ventas v JOIN venta_pagos pg ON pg.venta_id = v.id
                 WHERE v.turno_id = t.id AND pg.forma_pago = 'EFECTIVO'), 0)       AS ventas_efectivo,
       COALESCE((SELECT SUM(m.monto) FROM movimientos_caja m
                 WHERE m.turno_id = t.id AND m.tipo IN ('DEPOSITO','ABONO_CLIENTE','LIQUIDACION_DELIVERY')), 0) AS entradas,
       COALESCE((SELECT SUM(m.monto) FROM movimientos_caja m
                 WHERE m.turno_id = t.id AND m.tipo IN ('RETIRO','GASTO')), 0)          AS salidas
FROM turnos t;

-- Dinero pendiente por repartidor (despachado/entregado y aún no liquidado)
CREATE VIEW rpt_delivery_pendiente AS
SELECT p.sucursal_id, r.id AS repartidor_id, r.nombre AS repartidor,
       COUNT(*) AS pedidos, SUM(p.total) AS monto_pendiente,
       MIN(p.despachado_en) AS desde
FROM pedidos_delivery p
JOIN repartidores r ON r.id = p.repartidor_id
WHERE p.estado IN ('DESPACHADO','ENTREGADO')
GROUP BY p.sucursal_id, r.id, r.nombre;

-- Desempeño del delivery
CREATE VIEW rpt_delivery AS
SELECT p.sucursal_id, (p.recibido_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       r.nombre AS repartidor,
       COUNT(*) FILTER (WHERE p.estado <> 'CANCELADO') AS pedidos,
       COUNT(*) FILTER (WHERE p.estado = 'CANCELADO')  AS cancelados,
       SUM(p.total) FILTER (WHERE p.estado <> 'CANCELADO') AS venta,
       SUM(p.cargo_envio) FILTER (WHERE p.estado <> 'CANCELADO') AS cargos_envio,
       ROUND(AVG(EXTRACT(EPOCH FROM (p.entregado_en - p.recibido_en)) / 60)::numeric, 1) AS minutos_promedio_entrega
FROM pedidos_delivery p
LEFT JOIN repartidores r ON r.id = p.repartidor_id
GROUP BY 1, 2, 3;
