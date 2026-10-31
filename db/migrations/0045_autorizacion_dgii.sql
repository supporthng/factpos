-- Etapa del proceso para ser emisor electrónico autorizado por la DGII y prueba de que ya autentica en producción.
ALTER TABLE configuracion_fiscal ADD COLUMN IF NOT EXISTS etapa_dgii VARCHAR(20) NOT NULL DEFAULT 'SIN_SOLICITUD'
    CHECK (etapa_dgii IN ('SIN_SOLICITUD','SOLICITADO','EN_PRUEBAS','PRUEBAS_APROBADAS','AUTORIZADO'));
ALTER TABLE configuracion_fiscal ADD COLUMN IF NOT EXISTS autorizacion_fecha DATE;
ALTER TABLE configuracion_fiscal ADD COLUMN IF NOT EXISTS autorizacion_referencia VARCHAR(80);
ALTER TABLE configuracion_fiscal ADD COLUMN IF NOT EXISTS autenticacion_ok_en TIMESTAMPTZ;
