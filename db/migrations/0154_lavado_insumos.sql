-- Insumos que gasta cada servicio de lavado (champú, cera, paños…): al quedar LISTO el lavado se descuentan del inventario
-- como un ajuste de «consumo interno». Si no se pudo descontar (por ejemplo, sin existencia) el lavado igual queda listo y se avisa.
ALTER TABLE lavado_servicios ADD COLUMN IF NOT EXISTS insumos JSONB NOT NULL DEFAULT '[]'::jsonb;   -- [{"productoId": "...", "cantidad": 0.25}]
ALTER TABLE lavado_ordenes ADD COLUMN IF NOT EXISTS insumos_ajuste_id UUID REFERENCES ajustes_inventario(id);
ALTER TABLE lavado_ordenes ADD COLUMN IF NOT EXISTS insumos_nota TEXT;
