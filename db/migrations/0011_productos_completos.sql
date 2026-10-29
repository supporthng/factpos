-- =====================================================================
-- 0011 · Módulo de productos completo
--
-- * Precio por sucursal: opcional y APAGADO por defecto. Con el interruptor
--   apagado, todas las sucursales usan el precio general (los 3 niveles).
--   El inventario y los reportes siguen siendo individuales por sucursal.
-- * Tipos de producto: inventariable, servicio y combo (kit).
-- * Combos: al vender, se descuenta cada componente del inventario.
-- * Proveedores por producto, precio variable con rango, restricción de
--   edad, venta sin existencia configurable e historial de precios.
-- =====================================================================
ALTER TABLE empresas ADD COLUMN precios_por_sucursal BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE productos ADD COLUMN tipo VARCHAR(14) NOT NULL DEFAULT 'INVENTARIABLE'
    CHECK (tipo IN ('INVENTARIABLE','SERVICIO','COMBO'));
UPDATE productos SET tipo = 'SERVICIO' WHERE NOT controla_stock;
ALTER TABLE productos ADD COLUMN nombre_corto VARCHAR(32);          -- para el ticket de 80 mm
ALTER TABLE productos ADD COLUMN marca VARCHAR(60);
ALTER TABLE productos ADD COLUMN permite_sin_existencia BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE productos ADD COLUMN precio_variable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE productos ADD COLUMN precio_variable_min NUMERIC(14,2);
ALTER TABLE productos ADD COLUMN precio_variable_max NUMERIC(14,2);
ALTER TABLE productos ADD COLUMN mayor_de_edad BOOLEAN NOT NULL DEFAULT FALSE;  -- alcohol, cigarrillos
ALTER TABLE productos ADD COLUMN controla_lotes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE productos ADD COLUMN volumen_ml INTEGER;                -- licores (base del ISC)
ALTER TABLE productos ADD COLUMN grado_alcohol NUMERIC(5,2);
ALTER TABLE productos ADD CONSTRAINT ck_precio_variable
    CHECK (NOT precio_variable OR (precio_variable_min IS NOT NULL AND precio_variable_max >= precio_variable_min));
CREATE INDEX ix_productos_nombre ON productos (empresa_id, nombre);

-- Componentes de un combo (en unidades base del componente)
CREATE TABLE producto_componentes (
    combo_id        UUID NOT NULL REFERENCES productos(id),
    componente_id   UUID NOT NULL REFERENCES productos(id),
    cantidad        NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (combo_id, componente_id),
    CHECK (combo_id <> componente_id)
);
CREATE TRIGGER tr_producto_componentes_version BEFORE INSERT OR UPDATE ON producto_componentes
    FOR EACH ROW EXECUTE FUNCTION fn_version();

-- Proveedores de cada producto
CREATE TABLE producto_proveedores (
    producto_id     UUID NOT NULL REFERENCES productos(id),
    proveedor_id    UUID NOT NULL REFERENCES proveedores(id),
    codigo_proveedor VARCHAR(40),
    ultimo_costo    NUMERIC(14,4),
    principal       BOOLEAN NOT NULL DEFAULT FALSE,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (producto_id, proveedor_id)
);
CREATE UNIQUE INDEX ux_proveedor_principal ON producto_proveedores (producto_id) WHERE principal AND activo;
CREATE TRIGGER tr_producto_proveedores_version BEFORE INSERT OR UPDATE ON producto_proveedores
    FOR EACH ROW EXECUTE FUNCTION fn_version();

-- Historial de cambios de precio (quién, cuándo, de cuánto a cuánto)
CREATE TABLE historial_precios (
    id              UUID PRIMARY KEY,
    presentacion_id UUID NOT NULL REFERENCES presentaciones(id),
    lista_precio_id UUID NOT NULL REFERENCES listas_precio(id),
    sucursal_id     UUID REFERENCES sucursales(id),
    precio_anterior NUMERIC(14,2),
    precio_nuevo    NUMERIC(14,2),
    usuario_id      UUID REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_historial_precios ON historial_precios (presentacion_id, creado_en DESC);

-- Existencia disponible de un combo = lo que alcanza con sus componentes
CREATE VIEW v_existencia_combos AS
SELECT pc.combo_id, a.id AS almacen_id,
       MIN(FLOOR(COALESCE(e.cantidad, 0) / pc.cantidad)) AS cantidad
FROM producto_componentes pc
CROSS JOIN almacenes a
LEFT JOIN existencias e ON e.producto_id = pc.componente_id AND e.almacen_id = a.id
GROUP BY pc.combo_id, a.id;
