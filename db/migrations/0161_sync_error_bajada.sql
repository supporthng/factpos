-- Error con el que la sucursal no logra recibir los cambios de la central (la subida puede ir bien y la bajada fallar:
-- el indicador «En línea» no lo mostraba). La sucursal lo avisa y la administración lo muestra.
ALTER TABLE sync_sucursales ADD COLUMN IF NOT EXISTS error_bajada TEXT;
