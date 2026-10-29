-- =====================================================================
-- 0008 · Aprobaciones con PIN de supervisor y anulación de facturas
--
-- * Los descuentos, anulaciones y correcciones requieren el PIN de un
--   usuario con permiso. El PIN se guarda como HMAC (nunca en claro) y es
--   único por empresa, así basta con teclearlo para saber quién aprueba.
-- * Anular = emitir una nota de crédito electrónica (E34) por el total de la
--   factura: el e-CF original nunca se borra ni se edita.
-- =====================================================================
CREATE UNIQUE INDEX ux_usuarios_pin ON usuarios (empresa_id, pin_hash) WHERE pin_hash IS NOT NULL;

-- Motivo y aprobación de las notas de crédito / anulaciones
ALTER TABLE ventas ADD COLUMN motivo TEXT;
ALTER TABLE ventas ADD COLUMN autorizado_por UUID REFERENCES usuarios(id);
CREATE INDEX ix_ventas_origen ON ventas (venta_origen_id) WHERE venta_origen_id IS NOT NULL;
CREATE INDEX ix_ventas_caja_fecha ON ventas (caja_id, creado_en DESC);

-- Descuento manual autorizado en cada línea
ALTER TABLE venta_items ADD COLUMN descuento_manual NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Reporte de anulaciones: qué se anuló, por qué y quién lo aprobó
CREATE VIEW rpt_anulaciones AS
SELECT n.sucursal_id, (n.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       n.creado_en AS anulada_en,
       eo.encf AS factura, en.encf AS nota_credito, o.total, n.motivo,
       uc.nombre AS cajero, ua.nombre AS aprobado_por, ca.nombre AS terminal
FROM ventas n
JOIN ventas o ON o.id = n.venta_origen_id
JOIN cajas ca ON ca.id = n.caja_id
JOIN usuarios uc ON uc.id = n.usuario_id
LEFT JOIN usuarios ua ON ua.id = n.autorizado_por
LEFT JOIN ecf_documentos eo ON eo.venta_id = o.id
LEFT JOIN ecf_documentos en ON en.venta_id = n.id
WHERE n.tipo_documento = 'E34';

-- Descuentos manuales autorizados
CREATE VIEW rpt_descuentos_autorizados AS
SELECT a.sucursal_id, (a.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       a.creado_en, uc.nombre AS cajero, ua.nombre AS aprobado_por,
       a.detalle ->> 'motivo' AS motivo, (a.detalle ->> 'monto')::numeric AS monto, a.entidad_id AS venta_id
FROM auditoria a
JOIN usuarios uc ON uc.id = a.usuario_id
LEFT JOIN usuarios ua ON ua.id = a.autorizado_por
WHERE a.accion = 'venta.descuento';
