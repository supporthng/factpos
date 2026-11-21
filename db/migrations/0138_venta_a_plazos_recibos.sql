-- =====================================================================
-- 0138 · Venta a plazos (mueblería) y recibos de ingreso numerados
--   · ventas_por_cobrar: la venta puede llevar plan de financiamiento, inicial y garante. La caja cobra solo la inicial;
--     el resto queda a crédito con su plan de cuotas. Si el cliente no cumple (límite, atrasos, requisitos) un supervisor
--     con el permiso «Vender a crédito» la autoriza y queda su nombre y el motivo.
--   · cxc_planes: guarda la inicial, el garante y quién autorizó la excepción.
--   · recibos_ingreso: recibo numerado por sucursal de cada dinero que entra por cobro de crédito (inicial o abono),
--     con el saldo antes y después. Se puede reimprimir. Es operación de la sucursal (no se sincroniza).
-- =====================================================================
ALTER TABLE ventas_por_cobrar
    ADD COLUMN IF NOT EXISTS plan_id             UUID REFERENCES cxc_planes_catalogo(id),
    ADD COLUMN IF NOT EXISTS inicial             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (inicial >= 0),
    ADD COLUMN IF NOT EXISTS primera_cuota       DATE,
    ADD COLUMN IF NOT EXISTS garante_nombre      VARCHAR(120),
    ADD COLUMN IF NOT EXISTS garante_documento   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS garante_telefono    VARCHAR(30),
    ADD COLUMN IF NOT EXISTS excepciones         TEXT[] NOT NULL DEFAULT '{}',   -- qué requisito no cumplía
    ADD COLUMN IF NOT EXISTS excepcion_motivo    TEXT,
    ADD COLUMN IF NOT EXISTS excepcion_por       UUID REFERENCES usuarios(id);

ALTER TABLE cxc_planes
    ADD COLUMN IF NOT EXISTS inicial            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (inicial >= 0),
    ADD COLUMN IF NOT EXISTS garante_nombre     VARCHAR(120),
    ADD COLUMN IF NOT EXISTS garante_documento  VARCHAR(20),
    ADD COLUMN IF NOT EXISTS garante_telefono   VARCHAR(30),
    ADD COLUMN IF NOT EXISTS excepciones        TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS excepcion_motivo   TEXT,
    ADD COLUMN IF NOT EXISTS excepcion_por      UUID REFERENCES usuarios(id);

CREATE TABLE IF NOT EXISTS recibos_ingreso (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    numero          BIGINT NOT NULL,                        -- consecutivo por sucursal
    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('INICIAL','ABONO')),
    cliente_id      UUID NOT NULL REFERENCES clientes(id),
    venta_id        UUID,                                   -- la factura de la inicial (en abonos, la primera aplicada)
    monto           NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    forma_pago      VARCHAR(20) NOT NULL,
    referencia      VARCHAR(60),
    saldo_anterior  NUMERIC(14,2) NOT NULL,
    saldo_nuevo     NUMERIC(14,2) NOT NULL,
    aplicaciones    JSONB NOT NULL DEFAULT '[]',            -- [{ventaId, factura, documento, aplicado}]
    usuario_id      UUID REFERENCES usuarios(id),
    turno_id        UUID,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_recibos_ingreso_cliente ON recibos_ingreso (cliente_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_recibos_ingreso_fecha ON recibos_ingreso (sucursal_id, creado_en DESC);
