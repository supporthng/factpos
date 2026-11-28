-- =====================================================================
-- 0163 · Módulo GOMERA (venta de neumáticos nuevos y usados y servicios de taller)
--   · producto_neumatico: la ficha del neumático: medida (205/55R16 y sus partes para buscar por ancho, perfil y rin), tipo de vehículo,
--     modelo, índice de carga y velocidad, nuevo o usado y, en usados, la vida que le queda a la banda. La marca es la del producto.
--     El DOT (semana y año de fabricación) NO va aquí: es el LOTE del neumático (compras, existencias por lote y venta del más antiguo primero).
--   · La ubicación en el almacén (rack › nivel › posición) usa las mismas tablas que la tramería de la farmacia
--     (farmacia_ubicaciones / producto_ubicaciones): son por almacén, o sea, por sucursal.
--   · Los servicios de taller (pinchazo, montaje, balanceo…) son el módulo LAVADO: se agrega la bicicleta como tipo de vehículo y la
--     orden puede abrirse sin placa (pinchazo rápido de una bicicleta o un motor).
-- =====================================================================
CREATE TABLE IF NOT EXISTS producto_neumatico (
    producto_id      UUID PRIMARY KEY REFERENCES productos(id) ON DELETE CASCADE,
    medida           VARCHAR(20) NOT NULL,
    ancho            NUMERIC(6,2),
    perfil           SMALLINT,
    rin              NUMERIC(4,1),
    tipo_vehiculo    VARCHAR(10) NOT NULL DEFAULT 'CARRO' CHECK (tipo_vehiculo IN ('BICICLETA','MOTO','CARRO','JEEPETA','CAMIONETA','CAMION')),
    modelo           VARCHAR(60),
    indice           VARCHAR(10),                       -- índice de carga y velocidad: 91V
    condicion        VARCHAR(5) NOT NULL DEFAULT 'NUEVO' CHECK (condicion IN ('NUEVO','USADO')),
    desgaste_vida    SMALLINT CHECK (desgaste_vida BETWEEN 0 AND 100),   -- usados: % de banda que le queda
    notas            TEXT,
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_producto_neumatico_medida ON producto_neumatico (rin, ancho, perfil);
CREATE INDEX IF NOT EXISTS ix_producto_neumatico_tipo ON producto_neumatico (tipo_vehiculo, condicion);

ALTER TABLE lavado_vehiculos DROP CONSTRAINT IF EXISTS lavado_vehiculos_tamano_check;
ALTER TABLE lavado_vehiculos ADD CONSTRAINT lavado_vehiculos_tamano_check CHECK (tamano IN ('BICICLETA','MOTO','CARRO','JEEPETA','CAMIONETA','CAMION'));
ALTER TABLE lavado_ordenes ALTER COLUMN vehiculo_id DROP NOT NULL;
