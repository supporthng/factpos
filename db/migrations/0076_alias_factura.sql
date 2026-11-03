-- =====================================================================
-- 0076 · Descripciones de factura aprendidas
--   Cuando se registra una compra, la descripción tal como la escribe el proveedor queda asociada al producto elegido,
--   para que el lector de facturas lo reconozca exacto la próxima vez.
-- =====================================================================
CREATE TABLE IF NOT EXISTS alias_factura (
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  alias           TEXT NOT NULL,
  presentacion_id UUID NOT NULL REFERENCES presentaciones(id) ON DELETE CASCADE,
  usos            INTEGER NOT NULL DEFAULT 1,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proveedor_id, alias)
);
