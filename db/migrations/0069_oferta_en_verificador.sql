-- Cada oferta decide si se muestra en la pantalla de espera del verificador de precios.
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS mostrar_en_verificador BOOLEAN NOT NULL DEFAULT true;
