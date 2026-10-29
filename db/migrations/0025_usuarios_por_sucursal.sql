-- =====================================================================
-- 0025 · Sucursales a las que tiene acceso cada usuario
--
-- NULL = todas las sucursales (como hasta ahora). Con una lista, el usuario:
--   * solo puede entrar a las cajas de esas sucursales (con su PIN);
--   * en la Administración solo ve y opera esas sucursales.
-- Viaja con la fila del usuario a los servidores de sucursal.
-- =====================================================================
ALTER TABLE usuarios ADD COLUMN sucursales UUID[];
ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_sucursales CHECK (sucursales IS NULL OR cardinality(sucursales) > 0);
