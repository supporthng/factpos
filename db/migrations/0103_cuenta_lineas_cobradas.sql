-- Cada línea de una cuenta queda ligada a la venta que la cobró: así se puede cobrar por partes y retomar sin cobrar dos veces.
ALTER TABLE cuenta_lineas ADD COLUMN IF NOT EXISTS venta_id UUID REFERENCES ventas(id);
