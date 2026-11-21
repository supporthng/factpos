-- =====================================================================
-- 0142 · Comisiones de vendedores
--   · La comisión se devenga sobre lo COBRADO (neto de ITBIS) de las ventas armadas por el vendedor: la inicial y cada abono
--     que se aplica a esa factura. Así, una venta a plazos paga comisión a medida que el cliente paga.
--   · comision_config: % general de la empresa. comision_vendedores: % propio de un vendedor (si no tiene, rige el general).
--   · comisiones: cada devengo (quién, qué factura, cuánto se cobró, base, %, monto). Se liquida en bloque.
--   · comision_liquidaciones: el pago de comisiones a un vendedor por un período.
--   Si la factura se anula, su comisión pendiente deja de contar. Es operación de la sucursal (no se sincroniza).
-- =====================================================================
CREATE TABLE IF NOT EXISTS comision_config (
    empresa_id         UUID PRIMARY KEY REFERENCES empresas(id),
    porcentaje_defecto NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (porcentaje_defecto >= 0 AND porcentaje_defecto <= 100),
    actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comision_vendedores (
    empresa_id  UUID NOT NULL REFERENCES empresas(id),
    usuario_id  UUID NOT NULL REFERENCES usuarios(id),
    porcentaje  NUMERIC(5,2) NOT NULL CHECK (porcentaje >= 0 AND porcentaje <= 100),
    PRIMARY KEY (empresa_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS comision_liquidaciones (
    id          UUID PRIMARY KEY,
    empresa_id  UUID NOT NULL REFERENCES empresas(id),
    vendedor_id UUID NOT NULL REFERENCES usuarios(id),
    numero      BIGINT NOT NULL,
    desde       DATE,
    hasta       DATE NOT NULL,
    total       NUMERIC(14,2) NOT NULL,
    notas       TEXT,
    creada_por  UUID REFERENCES usuarios(id),
    creada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, numero)
);

CREATE TABLE IF NOT EXISTS comisiones (
    id             UUID PRIMARY KEY,
    empresa_id     UUID NOT NULL REFERENCES empresas(id),
    sucursal_id    UUID NOT NULL REFERENCES sucursales(id),
    vendedor_id    UUID NOT NULL REFERENCES usuarios(id),
    venta_id       UUID NOT NULL REFERENCES ventas(id),
    concepto       VARCHAR(10) NOT NULL CHECK (concepto IN ('CONTADO','INICIAL','ABONO')),
    cobrado        NUMERIC(14,2) NOT NULL CHECK (cobrado > 0),   -- lo que entró (con ITBIS)
    base           NUMERIC(14,2) NOT NULL,                       -- la parte sin ITBIS sobre la que se calcula
    porcentaje     NUMERIC(5,2) NOT NULL,
    monto          NUMERIC(14,2) NOT NULL,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    liquidacion_id UUID REFERENCES comision_liquidaciones(id)
);
CREATE INDEX IF NOT EXISTS ix_comisiones_vendedor ON comisiones (empresa_id, vendedor_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_comisiones_venta ON comisiones (venta_id);
CREATE INDEX IF NOT EXISTS ix_comisiones_pendientes ON comisiones (empresa_id, vendedor_id) WHERE liquidacion_id IS NULL;
