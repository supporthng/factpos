-- =====================================================================
-- 0143 · Cobranza en ruta (mueblería)
--   · cobranza_asignaciones: qué cobrador (usuario) atiende cada plan de cuotas.
--   · cobranza_gestiones: cada llamada, visita o mensaje al cliente, con su resultado, la promesa de pago (fecha y monto)
--     y cuándo volver a gestionar. El dinero que entra se registra como siempre (abono con recibo numerado).
--   Es operación de la sucursal (no se sincroniza).
-- =====================================================================
CREATE TABLE IF NOT EXISTS cobranza_asignaciones (
    plan_id      UUID PRIMARY KEY REFERENCES cxc_planes(id),
    cobrador_id  UUID NOT NULL REFERENCES usuarios(id),
    asignado_por UUID REFERENCES usuarios(id),
    asignado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cobranza_gestiones (
    id            UUID PRIMARY KEY,
    empresa_id    UUID NOT NULL REFERENCES empresas(id),
    plan_id       UUID NOT NULL REFERENCES cxc_planes(id),
    cliente_id    UUID NOT NULL REFERENCES clientes(id),
    tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('LLAMADA','VISITA','MENSAJE','OTRO')),
    resultado     VARCHAR(14) NOT NULL CHECK (resultado IN ('PROMESA','PAGO','NO_LOCALIZADO','SIN_PAGO','OTRO')),
    nota          TEXT,
    promesa_fecha DATE,
    promesa_monto NUMERIC(14,2) CHECK (promesa_monto IS NULL OR promesa_monto > 0),
    proxima_fecha DATE,
    usuario_id    UUID REFERENCES usuarios(id),
    creada_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cobranza_gestiones_plan ON cobranza_gestiones (plan_id, creada_en DESC);
CREATE INDEX IF NOT EXISTS ix_cobranza_gestiones_cliente ON cobranza_gestiones (cliente_id, creada_en DESC);
