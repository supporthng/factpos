-- =====================================================================
-- 0162 · Módulo SALON (peluquerías, barberías, uñas, spa: servicios con estilista y cita)
--   · salon_servicios: lo que se ofrece (corte, tinte, barba…) con su duración. El precio sale del catálogo de productos: cada
--     «variante» (único, cabello corto, medio, largo) apunta a una presentación, así facturan, ITBIS y comprobante funcionan
--     como en cualquier venta. `comision` es lo que gana el estilista (monto fijo o % del servicio sin ITBIS).
--   · salon_estilistas, salon_sillas: el personal y los puestos de cada sucursal.
--   · salon_citas: cita con hora o turno sin cita (cola del día). PROGRAMADA → EN_ESPERA → EN_SERVICIO → TERMINADA → COBRADA
--     (o CANCELADA / NO_LLEGO). Al cobrarse con una factura se enlaza a ella.
--   · salon_comisiones: lo que gana cada estilista; se acumula al COBRARSE la cita (con lo realmente facturado) y se liquida después.
--   Es operación de la sucursal (no se sincroniza). Solo aplica a empresas con el módulo SALON.
-- =====================================================================
CREATE TABLE IF NOT EXISTS salon_servicios (
    id             UUID PRIMARY KEY,
    empresa_id     UUID NOT NULL REFERENCES empresas(id),
    nombre         VARCHAR(80) NOT NULL,
    descripcion    TEXT,
    duracion_min   INTEGER NOT NULL DEFAULT 30 CHECK (duracion_min BETWEEN 5 AND 600),
    presentaciones JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"UNICO": "<presentacion_id>", "CORTO": "…", "MEDIO": "…", "LARGO": "…"}
    comision_tipo  VARCHAR(10) NOT NULL DEFAULT 'PORCIENTO' CHECK (comision_tipo IN ('MONTO','PORCIENTO')),
    comision       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (comision >= 0),
    insumos        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{productoId, cantidad}] que gasta cada servicio
    activo         BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (empresa_id, nombre)
);

CREATE TABLE IF NOT EXISTS salon_estilistas (
    id          UUID PRIMARY KEY,
    empresa_id  UUID NOT NULL REFERENCES empresas(id),
    nombre      VARCHAR(80) NOT NULL,
    telefono    VARCHAR(30),
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (empresa_id, nombre)
);

CREATE TABLE IF NOT EXISTS salon_sillas (
    id          UUID PRIMARY KEY,
    sucursal_id UUID NOT NULL REFERENCES sucursales(id),
    nombre      VARCHAR(40) NOT NULL,
    activa      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (sucursal_id, nombre)
);

CREATE TABLE IF NOT EXISTS salon_citas (
    id            UUID PRIMARY KEY,
    sucursal_id   UUID NOT NULL REFERENCES sucursales(id),
    numero        BIGINT NOT NULL,
    origen        VARCHAR(5) NOT NULL DEFAULT 'CITA' CHECK (origen IN ('CITA','TURNO')),
    estado        VARCHAR(10) NOT NULL DEFAULT 'PROGRAMADA'
                  CHECK (estado IN ('PROGRAMADA','EN_ESPERA','EN_SERVICIO','TERMINADA','COBRADA','CANCELADA','NO_LLEGO')),
    cliente_id    UUID REFERENCES clientes(id),
    nombre        VARCHAR(80) NOT NULL,
    telefono      VARCHAR(30),
    estilista_id  UUID REFERENCES salon_estilistas(id),
    silla_id      UUID REFERENCES salon_sillas(id),
    inicio_en     TIMESTAMPTZ NOT NULL,                  -- hora de la cita (en un turno sin cita, la de llegada)
    duracion_min  INTEGER NOT NULL CHECK (duracion_min > 0),
    lineas        JSONB NOT NULL,                        -- [{servicioId, servicio, variante, presentacionId, cantidad, comisionTipo, comision, insumos}]
    notas         TEXT,
    llego_en      TIMESTAMPTZ,
    servicio_inicio_en TIMESTAMPTZ,
    servicio_fin_en    TIMESTAMPTZ,
    cobrada_en    TIMESTAMPTZ,
    venta_id      UUID REFERENCES ventas(id),
    insumos_ajuste_id UUID REFERENCES ajustes_inventario(id),
    insumos_nota  TEXT,
    creada_por    UUID REFERENCES usuarios(id),
    creada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_salon_citas_dia ON salon_citas (sucursal_id, inicio_en);
CREATE INDEX IF NOT EXISTS ix_salon_citas_estilista ON salon_citas (estilista_id, inicio_en);
CREATE INDEX IF NOT EXISTS ix_salon_citas_telefono ON salon_citas (telefono) WHERE telefono IS NOT NULL;

CREATE TABLE IF NOT EXISTS salon_comisiones (
    id            UUID PRIMARY KEY,
    cita_id       UUID NOT NULL UNIQUE REFERENCES salon_citas(id),
    estilista_id  UUID NOT NULL REFERENCES salon_estilistas(id),
    monto         NUMERIC(14,2) NOT NULL CHECK (monto >= 0),
    creada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    pagada_en     TIMESTAMPTZ,
    pagada_por    UUID REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS ix_salon_comisiones_estilista ON salon_comisiones (estilista_id, pagada_en);
