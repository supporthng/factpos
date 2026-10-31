-- Tres familias de comprobante: e-CF (prefijo E), NCF serie B (prefijo B) y sin comprobante (FI-).
-- Se agregan los NCF de regímenes especiales (B14), gubernamental (B15) y exportaciones (B16).
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_tipo_documento_check;
ALTER TABLE ventas ADD CONSTRAINT ventas_tipo_documento_check
    CHECK (tipo_documento IN ('E31','E32','E34','B01','B02','B14','B15','B16','SIN','ANU'));

ALTER TABLE facturacion_rangos_ncf DROP CONSTRAINT IF EXISTS facturacion_rangos_ncf_tipo_check;
ALTER TABLE facturacion_rangos_ncf ADD CONSTRAINT facturacion_rangos_ncf_tipo_check
    CHECK (tipo IN ('B01','B02','B14','B15','B16'));
