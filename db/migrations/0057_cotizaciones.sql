-- Cotizaciones: se preparan en la administración, se envían por correo y pueden aceptarse o rechazarse.
CREATE TABLE IF NOT EXISTS cotizaciones (
    id                UUID PRIMARY KEY,
    empresa_id        UUID NOT NULL REFERENCES empresas(id),
    numero            INTEGER NOT NULL,
    cliente_id        UUID REFERENCES clientes(id),
    cliente_nombre    TEXT NOT NULL,
    cliente_documento TEXT,
    cliente_correo    TEXT,
    cliente_telefono  TEXT,
    fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
    vence             DATE NOT NULL,
    estado            TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR','ENVIADA','ACEPTADA','RECHAZADA')),
    notas             TEXT,
    condiciones       TEXT,
    subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0,
    descuento         NUMERIC(14,2) NOT NULL DEFAULT 0,
    itbis             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total             NUMERIC(14,2) NOT NULL DEFAULT 0,
    creado_por        UUID REFERENCES usuarios(id),
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviada_en        TIMESTAMPTZ,
    enviada_a         TEXT[],
    UNIQUE (empresa_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_cotizaciones_empresa ON cotizaciones (empresa_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS cotizacion_lineas (
    id              UUID PRIMARY KEY,
    cotizacion_id   UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    orden           INTEGER NOT NULL,
    presentacion_id UUID REFERENCES presentaciones(id),
    descripcion     TEXT NOT NULL,
    cantidad        NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
    precio          NUMERIC(14,2) NOT NULL CHECK (precio >= 0),
    incluye_itbis   BOOLEAN NOT NULL DEFAULT TRUE,
    tasa_itbis      NUMERIC(5,4) NOT NULL DEFAULT 0.18,
    descuento       NUMERIC(14,2) NOT NULL DEFAULT 0,
    base            NUMERIC(14,2) NOT NULL,
    itbis           NUMERIC(14,2) NOT NULL,
    total           NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cotizacion_lineas ON cotizacion_lineas (cotizacion_id, orden);
