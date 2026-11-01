-- Lector de facturas (IA): cupo mensual de facturas por licencia, lo asigna el proveedor desde el portal.
-- Por omisión 0 = apagado: es un servicio que se contrata.
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS lector_cupo INTEGER NOT NULL DEFAULT 0 CHECK (lector_cupo >= 0);
CREATE TABLE IF NOT EXISTS portal_lector_uso (
    licencia_id UUID NOT NULL REFERENCES portal_licencias(id) ON DELETE CASCADE,
    mes         TEXT NOT NULL,                 -- AAAA-MM
    usadas      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (licencia_id, mes)
);
