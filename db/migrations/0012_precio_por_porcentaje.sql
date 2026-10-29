-- =====================================================================
-- 0012 · Precio de venta por monto o por porcentaje
--
-- porcentaje NULL  = el precio se fijó por monto.
-- porcentaje valor = el precio se calculó como costo + ese % de ganancia.
-- La caja siempre lee `precio` (el monto ya calculado), así que vender sigue
-- siendo igual de rápido. El % sirve para recalcular cuando cambia el costo.
-- =====================================================================
ALTER TABLE precios ADD COLUMN porcentaje NUMERIC(7,2) CHECK (porcentaje IS NULL OR porcentaje >= 0);
