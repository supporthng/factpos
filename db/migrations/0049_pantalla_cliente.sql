-- Pantalla del cliente (segunda pantalla de la caja): mensaje de bienvenida y ofertas del negocio que se muestran mientras no se cobra.
-- Viaja con la marca a todas las sucursales.
ALTER TABLE configuracion_marca ADD COLUMN IF NOT EXISTS pantalla_cliente JSONB NOT NULL DEFAULT '{}'::jsonb;
