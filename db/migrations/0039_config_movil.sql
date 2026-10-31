-- =====================================================================
-- 0039 · Configuración de la versión celular de la administración
--   Si está activa, en pantallas angostas solo se ven las secciones elegidas y solo
--   entran los usuarios autorizados (o todos). Sin fila = valores por defecto.
-- =====================================================================
CREATE TABLE IF NOT EXISTS config_movil (
    empresa_id      UUID PRIMARY KEY,
    habilitada      BOOLEAN NOT NULL DEFAULT TRUE,
    secciones       TEXT[]  NOT NULL DEFAULT ARRAY['resumen','productos','compras','inventario','precios','cxc','caja','reportes'],
    todos_usuarios  BOOLEAN NOT NULL DEFAULT TRUE,
    usuarios        UUID[]  NOT NULL DEFAULT '{}',
    con_sucursales  BOOLEAN NOT NULL DEFAULT TRUE,   -- los usuarios con sucursales asignadas entran y administran las suyas
    usuario_id      UUID,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE config_movil ADD COLUMN IF NOT EXISTS con_sucursales BOOLEAN NOT NULL DEFAULT TRUE;
