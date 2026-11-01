-- Regla de la empresa: un producto con existencia 0 no se factura. Se apaga la excepción por producto.
ALTER TABLE productos ALTER COLUMN permite_sin_existencia SET DEFAULT FALSE;
UPDATE productos SET permite_sin_existencia = FALSE WHERE permite_sin_existencia;
