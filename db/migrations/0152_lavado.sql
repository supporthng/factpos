-- =====================================================================
-- 0152 · Módulo LAVADO (lavado de vehículos y auto detailing)
--   · lavado_vehiculos: la ficha del vehículo (placa, marca, modelo, color y tamaño) y, si se conoce, su dueño.
--   · lavado_servicios: lo que se ofrece (lavado completo, pulido, encerado…). El precio sale del catálogo de productos: cada
--     tamaño apunta a una presentación (así facturan, ITBIS y comprobante funcionan igual que en cualquier venta). `comision` es lo
--     que gana el lavador por cada lavado de ese servicio.
--   · lavado_lavadores, lavado_bahias: el personal y los puestos de lavado de cada sucursal.
--   · lavado_ordenes: la orden de trabajo del vehículo en el local: EN_ESPERA → LAVANDO → LISTO → ENTREGADO (o CANCELADO).
--   · lavado_comisiones: lo que gana cada lavador por lavado, se acumula al quedar LISTO y se liquida después.
--   Es operación de la sucursal (no se sincroniza). Solo aplica a empresas con el módulo LAVADO.
-- =====================================================================
CREATE TABLE IF NOT EXISTS lavado_vehiculos (
    id          UUID PRIMARY KEY,
    empresa_id  UUID NOT NULL REFERENCES empresas(id),
    cliente_id  UUID REFERENCES clientes(id),
    placa       VARCHAR(12) NOT NULL,
    marca       VARCHAR(40),
    modelo      VARCHAR(40),
    color       VARCHAR(30),
    tamano      VARCHAR(10) NOT NULL DEFAULT 'CARRO' CHECK (tamano IN ('MOTO','CARRO','JEEPETA','CAMIONETA','CAMION')),
    notas       TEXT,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, placa)
);
CREATE INDEX IF NOT EXISTS ix_lavado_vehiculos_cliente ON lavado_vehiculos (cliente_id);

CREATE TABLE IF NOT EXISTS lavado_servicios (
    id            UUID PRIMARY KEY,
    empresa_id    UUID NOT NULL REFERENCES empresas(id),
    nombre        VARCHAR(80) NOT NULL,
    descripcion   TEXT,
    presentaciones JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"CARRO": "<presentacion_id>", "JEEPETA": "…"}
    comision      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (comision >= 0),
    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (empresa_id, nombre)
);

CREATE TABLE IF NOT EXISTS lavado_lavadores (
    id          UUID PRIMARY KEY,
    empresa_id  UUID NOT NULL REFERENCES empresas(id),
    nombre      VARCHAR(80) NOT NULL,
    telefono    VARCHAR(30),
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (empresa_id, nombre)
);

CREATE TABLE IF NOT EXISTS lavado_bahias (
    id          UUID PRIMARY KEY,
    sucursal_id UUID NOT NULL REFERENCES sucursales(id),
    nombre      VARCHAR(40) NOT NULL,
    activa      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (sucursal_id, nombre)
);

CREATE TABLE IF NOT EXISTS lavado_ordenes (
    id            UUID PRIMARY KEY,
    sucursal_id   UUID NOT NULL REFERENCES sucursales(id),
    numero        BIGINT NOT NULL,
    estado        VARCHAR(10) NOT NULL DEFAULT 'EN_ESPERA' CHECK (estado IN ('EN_ESPERA','LAVANDO','LISTO','ENTREGADO','CANCELADO')),
    vehiculo_id   UUID NOT NULL REFERENCES lavado_vehiculos(id),
    cliente_id    UUID REFERENCES clientes(id),
    placa         VARCHAR(12) NOT NULL,
    vehiculo      TEXT NOT NULL,                          -- «Toyota Corolla · gris» (copia al abrir la orden)
    tamano        VARCHAR(10) NOT NULL,
    telefono      VARCHAR(30),
    bahia_id      UUID REFERENCES lavado_bahias(id),
    lavador_id    UUID REFERENCES lavado_lavadores(id),
    lineas        JSONB NOT NULL,                         -- [{servicioId, servicio, presentacionId, cantidad, comision}]
    notas         TEXT,
    entrada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    inicio_en     TIMESTAMPTZ,
    listo_en      TIMESTAMPTZ,
    entregado_en  TIMESTAMPTZ,
    venta_id      UUID REFERENCES ventas(id),
    creada_por    UUID REFERENCES usuarios(id),
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_lavado_ordenes_estado ON lavado_ordenes (sucursal_id, estado, entrada_en DESC);
CREATE INDEX IF NOT EXISTS ix_lavado_ordenes_vehiculo ON lavado_ordenes (vehiculo_id);

CREATE TABLE IF NOT EXISTS lavado_comisiones (
    id          UUID PRIMARY KEY,
    orden_id    UUID NOT NULL UNIQUE REFERENCES lavado_ordenes(id),
    lavador_id  UUID NOT NULL REFERENCES lavado_lavadores(id),
    monto       NUMERIC(14,2) NOT NULL CHECK (monto >= 0),
    creada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    pagada_en   TIMESTAMPTZ,
    pagada_por  UUID REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS ix_lavado_comisiones_lavador ON lavado_comisiones (lavador_id, pagada_en);
