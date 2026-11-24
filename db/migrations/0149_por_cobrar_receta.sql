-- Farmacias: la receta se pide en el mostrador al enviar la venta a caja y viaja con ella; la caja solo cobra.
ALTER TABLE ventas_por_cobrar ADD COLUMN IF NOT EXISTS receta jsonb;
