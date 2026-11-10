-- Ubicación de la tienda para la consulta de precios por internet: se guarda por sucursal (la sube la propia sucursal
-- a la central) y no dentro del registro de marca de toda la empresa, que otra sincronización podía pisar.
ALTER TABLE configuracion_sucursal ADD COLUMN IF NOT EXISTS ubicacion_tienda JSONB;
