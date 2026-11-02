-- El % de ganancia pasa a ser sobre la venta (margen): lo guardado como % sobre el costo se convierte
-- (26 % sobre el costo = 20.63 % sobre la venta). Los precios no cambian; solo se recalculan así cuando cambia el costo.
UPDATE precios SET porcentaje = ROUND(porcentaje / (1 + porcentaje / 100), 2)
 WHERE porcentaje IS NOT NULL AND base = 'COSTO' AND porcentaje > 0;
