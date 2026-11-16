-- =====================================================================
-- 0134 · Crédito a plazos: planes de cuotas, interés fijo y mora
--   · credito_config: mora mensual (%) y días de gracia por empresa.
--   · cxc_planes_catalogo: planes predefinidos (cuotas, frecuencia, interés).
--   · cxc_planes / cxc_cuotas: el plan de un cliente y su calendario. Un solo plan ACTIVO por cliente.
--   El interés y la mora se cargan al estado de cuenta como ajustes positivos (cxc_movimientos); los abonos se aplican a las cuotas por orden.
-- =====================================================================
CREATE TABLE credito_config (
    empresa_id   UUID PRIMARY KEY REFERENCES empresas(id),
    mora_pct     NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (mora_pct BETWEEN 0 AND 100),   -- % mensual sobre lo vencido
    dias_gracia  SMALLINT NOT NULL DEFAULT 0 CHECK (dias_gracia BETWEEN 0 AND 60)
);

CREATE TABLE cxc_planes_catalogo (
    id           UUID PRIMARY KEY,
    empresa_id   UUID NOT NULL REFERENCES empresas(id),
    nombre       VARCHAR(60) NOT NULL,
    cuotas       SMALLINT NOT NULL CHECK (cuotas BETWEEN 1 AND 60),
    frecuencia   VARCHAR(10) NOT NULL CHECK (frecuencia IN ('SEMANAL','QUINCENAL','MENSUAL')),
    interes_pct  NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (interes_pct BETWEEN 0 AND 300),  -- % fijo sobre el monto financiado
    activo       BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cxc_planes (
    id           UUID PRIMARY KEY,
    empresa_id   UUID NOT NULL REFERENCES empresas(id),
    cliente_id   UUID NOT NULL REFERENCES clientes(id),
    venta_id     UUID REFERENCES ventas(id),               -- si se financió una factura en particular
    nombre       VARCHAR(80) NOT NULL,
    capital      NUMERIC(14,2) NOT NULL CHECK (capital > 0),
    interes_pct  NUMERIC(6,2) NOT NULL DEFAULT 0,
    interes      NUMERIC(14,2) NOT NULL DEFAULT 0,
    total        NUMERIC(14,2) NOT NULL CHECK (total > 0),
    cuotas       SMALLINT NOT NULL,
    frecuencia   VARCHAR(10) NOT NULL,
    mora_pct     NUMERIC(6,2) NOT NULL DEFAULT 0,          -- lo vigente al crear el plan
    dias_gracia  SMALLINT NOT NULL DEFAULT 0,
    estado       VARCHAR(10) NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','PAGADO','CANCELADO')),
    notas        TEXT,
    usuario_id   UUID REFERENCES usuarios(id),
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    cerrado_en   TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_cxc_planes_activo ON cxc_planes (cliente_id) WHERE estado = 'ACTIVO';

CREATE TABLE cxc_cuotas (
    id            UUID PRIMARY KEY,
    plan_id       UUID NOT NULL REFERENCES cxc_planes(id) ON DELETE CASCADE,
    numero        SMALLINT NOT NULL,
    vence         DATE NOT NULL,
    monto         NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    mora_cobrada  NUMERIC(14,2) NOT NULL DEFAULT 0,
    UNIQUE (plan_id, numero)
);
