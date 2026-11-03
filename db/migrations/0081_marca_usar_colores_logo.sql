-- Apariencia: usar los colores del logo del cliente (por defecto sí) o los colores de FactPOS.
ALTER TABLE configuracion_marca ADD COLUMN IF NOT EXISTS usar_colores_logo BOOLEAN NOT NULL DEFAULT TRUE;
