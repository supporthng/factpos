-- =====================================================================
-- 0144 · Servicio técnico y garantías (mueblería y electrodomésticos)
--   · servicios_tecnicos: la orden de servicio de un artículo vendido (por su serie o por la factura): la falla, dónde se atiende
--     (taller o a domicilio), el técnico, si cubre la garantía (vigente a la fecha de la orden), el diagnóstico y lo que costó.
--     Estados: RECIBIDO → EN_REVISION → EN_REPARACION / ESPERANDO_PIEZA → LISTO → ENTREGADO (o SIN_REPARACION / CANCELADO).
--   · servicio_historial: cada cambio de estado con su nota, quién y cuándo.
--   Es operación de la sucursal (no se sincroniza).
-- =====================================================================
CREATE TABLE IF NOT EXISTS servicios_tecnicos (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    numero          BIGINT NOT NULL,
    estado          VARCHAR(16) NOT NULL DEFAULT 'RECIBIDO' CHECK (estado IN ('RECIBIDO','EN_REVISION','EN_REPARACION','ESPERANDO_PIEZA','LISTO','ENTREGADO','SIN_REPARACION','CANCELADO')),
    cliente_id      UUID REFERENCES clientes(id),
    venta_id        UUID REFERENCES ventas(id),
    serie_id        UUID REFERENCES series_producto(id),
    producto_id     UUID REFERENCES productos(id),
    descripcion     TEXT NOT NULL,                       -- el artículo (copia del nombre)
    serie           TEXT,
    falla           TEXT NOT NULL,
    lugar           VARCHAR(10) NOT NULL DEFAULT 'TALLER' CHECK (lugar IN ('TALLER','DOMICILIO')),
    direccion       TEXT,
    telefono        VARCHAR(30),
    tecnico         VARCHAR(80),
    garantia_hasta  DATE,                                -- la de la serie al abrir la orden
    en_garantia     BOOLEAN NOT NULL DEFAULT FALSE,      -- cubierta por la garantía al abrir la orden
    diagnostico     TEXT,
    solucion        TEXT,
    costo_mano_obra NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo_mano_obra >= 0),
    costo_piezas    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo_piezas >= 0),
    recibida_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    lista_en        TIMESTAMPTZ,
    entregada_en    TIMESTAMPTZ,
    creada_por      UUID REFERENCES usuarios(id),
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_servicios_estado ON servicios_tecnicos (sucursal_id, estado, recibida_en DESC);
CREATE INDEX IF NOT EXISTS ix_servicios_cliente ON servicios_tecnicos (cliente_id);
CREATE INDEX IF NOT EXISTS ix_servicios_serie ON servicios_tecnicos (serie_id);

CREATE TABLE IF NOT EXISTS servicio_historial (
    id          UUID PRIMARY KEY,
    servicio_id UUID NOT NULL REFERENCES servicios_tecnicos(id) ON DELETE CASCADE,
    estado      VARCHAR(16) NOT NULL,
    nota        TEXT,
    usuario_id  UUID REFERENCES usuarios(id),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_servicio_historial ON servicio_historial (servicio_id, creado_en);
