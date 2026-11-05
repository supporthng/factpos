-- Errores inesperados del sistema: se registran solos como incidentes y se avisan por los canales de soporte
ALTER TABLE incidentes DROP CONSTRAINT IF EXISTS incidentes_tipo_check;
ALTER TABLE incidentes ADD CONSTRAINT incidentes_tipo_check
    CHECK (tipo IN ('CAJA_SIN_SERVIDOR','SERVIDOR_APAGADO','SUCURSAL_SIN_COMUNICACION','PRUEBA','RESPALDO_ATRASADO','ERROR_SISTEMA'));
