-- =====================================================================
-- 0146 · Servicio técnico v2: equipos que no se vendieron aquí, tipos de garantía, cotización con aprobación del cliente
--   · tipo_garantia: TIENDA (la de la venta), FABRICANTE (se envía al fabricante) o SIN (se cotiza y se cobra).
--   · Equipo externo: marca, modelo, accesorios que deja y estado en que llega.
--   · Cotización (solo SIN garantía): mano de obra, piezas y nota; el cliente la aprueba o la rechaza (quién, por qué medio y cuándo).
--     Si la rechaza, la revisión se puede cobrar (opcional, ver servicio_config).
--   · Fabricante: referencia del envío y fechas de salida y regreso.
--   · Estados nuevos: COTIZADO (esperando aprobación) y EN_FABRICANTE.
-- =====================================================================
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS tipo_garantia VARCHAR(10) NOT NULL DEFAULT 'SIN';
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS marca TEXT;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS modelo TEXT;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS accesorios TEXT;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS estado_equipo TEXT;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS cotiz_mano_obra NUMERIC(14,2);
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS cotiz_piezas NUMERIC(14,2);
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS cotiz_nota TEXT;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS cotiz_en TIMESTAMPTZ;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS aprobacion VARCHAR(10);
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS aprobacion_en TIMESTAMPTZ;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS aprobacion_por TEXT;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS aprobacion_medio VARCHAR(12);
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS cobro_revision NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS fabricante_referencia TEXT;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS fabricante_envio DATE;
ALTER TABLE servicios_tecnicos ADD COLUMN IF NOT EXISTS fabricante_regreso DATE;

-- Lo que ya existía: cubierta por la garantía de la tienda, o fuera de garantía (las abiertas se consideran ya aprobadas)
UPDATE servicios_tecnicos SET tipo_garantia = 'TIENDA' WHERE en_garantia;
UPDATE servicios_tecnicos SET aprobacion = 'APROBADA', aprobacion_en = COALESCE(aprobacion_en, recibida_en), aprobacion_por = 'Orden anterior al módulo de cotización'
 WHERE NOT en_garantia AND aprobacion IS NULL;

ALTER TABLE servicios_tecnicos DROP CONSTRAINT IF EXISTS servicios_tecnicos_estado_check;
ALTER TABLE servicios_tecnicos ADD CONSTRAINT servicios_tecnicos_estado_check
  CHECK (estado IN ('RECIBIDO','EN_REVISION','COTIZADO','EN_REPARACION','ESPERANDO_PIEZA','EN_FABRICANTE','LISTO','ENTREGADO','SIN_REPARACION','CANCELADO'));
ALTER TABLE servicios_tecnicos DROP CONSTRAINT IF EXISTS servicios_tecnicos_tipo_garantia_check;
ALTER TABLE servicios_tecnicos ADD CONSTRAINT servicios_tecnicos_tipo_garantia_check CHECK (tipo_garantia IN ('TIENDA','FABRICANTE','SIN'));
ALTER TABLE servicios_tecnicos DROP CONSTRAINT IF EXISTS servicios_tecnicos_aprobacion_check;
ALTER TABLE servicios_tecnicos ADD CONSTRAINT servicios_tecnicos_aprobacion_check CHECK (aprobacion IS NULL OR aprobacion IN ('PENDIENTE','APROBADA','RECHAZADA'));
ALTER TABLE servicio_historial ALTER COLUMN estado TYPE VARCHAR(20);

-- Opciones del servicio por empresa: ¿se cobra la revisión cuando el cliente rechaza la cotización?
CREATE TABLE IF NOT EXISTS servicio_config (
    empresa_id      UUID PRIMARY KEY REFERENCES empresas(id),
    cobrar_revision BOOLEAN NOT NULL DEFAULT FALSE,
    monto_revision  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (monto_revision >= 0)
);
