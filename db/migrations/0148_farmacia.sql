-- Módulo Farmacias: tipo de negocio, ubicación de los productos en la tramería (estante › nivel › posición),
-- datos del medicamento (principio activo, laboratorio, controlado / con receta) y receta de lo que se vende con ella.
-- El vencimiento ya existe (lotes + existencias_lote, migración 0032): aquí solo se bloquea lo vencido en la venta y se avisa con tiempo.
ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_tipo_negocio_check;
ALTER TABLE empresas ADD CONSTRAINT empresas_tipo_negocio_check
    CHECK (tipo_negocio IN ('TIENDA','RESTAURANTE','BAR','DISCOTECA','COMIDA_RAPIDA','MUEBLERIA','FARMACIA'));

CREATE TABLE IF NOT EXISTS producto_farmacia (
    producto_id      UUID PRIMARY KEY REFERENCES productos(id) ON DELETE CASCADE,
    principio_activo VARCHAR(120),
    laboratorio      VARCHAR(80),
    controlado       BOOLEAN NOT NULL DEFAULT FALSE,   -- psicotrópicos y estupefacientes: la venta exige datos de la receta
    requiere_receta  BOOLEAN NOT NULL DEFAULT FALSE,   -- antibióticos y otros de venta con receta
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_producto_farmacia_activo ON producto_farmacia (lower(principio_activo)) WHERE principio_activo IS NOT NULL;

CREATE TABLE IF NOT EXISTS farmacia_ubicaciones (
    id         UUID PRIMARY KEY,
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    almacen_id UUID NOT NULL REFERENCES almacenes(id),
    estante    VARCHAR(20) NOT NULL,
    nivel      SMALLINT NOT NULL DEFAULT 1 CHECK (nivel BETWEEN 1 AND 30),
    posicion   VARCHAR(10) NOT NULL DEFAULT '1',
    activo     BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (almacen_id, estante, nivel, posicion)
);

CREATE TABLE IF NOT EXISTS producto_ubicaciones (
    producto_id  UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    ubicacion_id UUID NOT NULL REFERENCES farmacia_ubicaciones(id) ON DELETE CASCADE,
    PRIMARY KEY (producto_id, ubicacion_id)
);
CREATE INDEX IF NOT EXISTS ix_producto_ubicaciones_ub ON producto_ubicaciones (ubicacion_id);

-- Receta de una venta con medicamentos controlados o de venta con receta
CREATE TABLE IF NOT EXISTS venta_recetas (
    venta_id     UUID PRIMARY KEY REFERENCES ventas(id),
    paciente     VARCHAR(120) NOT NULL,
    medico       VARCHAR(120) NOT NULL,
    exequatur    VARCHAR(30),
    fecha_receta DATE,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
