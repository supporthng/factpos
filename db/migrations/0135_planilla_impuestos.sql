-- =====================================================================
-- 0135 · Planilla de impuestos (Fiscal)
--   · impuestos.activo: se desactivan en vez de borrarse (los productos pueden usarlos).
--   · tipo 'PROPINA': la propina legal vive en la planilla con su porcentaje (hasta hoy fijo en 10 %).
--   Cada empresa recibe su fila «Propina legal 10 %» para que nada cambie hasta que se edite.
-- =====================================================================
ALTER TABLE impuestos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE impuestos DROP CONSTRAINT IF EXISTS impuestos_tipo_check;
ALTER TABLE impuestos ADD CONSTRAINT impuestos_tipo_check CHECK (tipo IN ('ITBIS','ISC','PROPINA','OTRO'));
CREATE UNIQUE INDEX IF NOT EXISTS ux_impuestos_propina ON impuestos (empresa_id) WHERE tipo = 'PROPINA' AND activo;
INSERT INTO impuestos (id, empresa_id, nombre, tipo, tasa)
SELECT gen_random_uuid(), e.id, 'Propina legal', 'PROPINA', 0.10 FROM empresas e
 WHERE NOT EXISTS (SELECT 1 FROM impuestos i WHERE i.empresa_id = e.id AND i.tipo = 'PROPINA');
