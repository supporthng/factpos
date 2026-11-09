-- Eliminar una oferta: no se borra la fila (hay ventas, reportes y sucursales que la referencian y los borrados no se sincronizan).
-- Se marca como eliminada: deja de aplicarse, de verse en el verificador y de aparecer en la lista de Administración.
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS eliminada BOOLEAN NOT NULL DEFAULT FALSE;
