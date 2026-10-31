-- =====================================================================
-- 0036 · Solicitud de activación enviada por el cliente
--   El cliente instala, usa su prueba de 15 días y, si le interesa, pulsa «Solicitar activación»
--   y manda sus datos y el plan que quiere. La solicitud llega al portal (portal_instalaciones).
--   * portal_instalaciones: datos de contacto y plan pedido.
--   * portal_config.plazo_horas: en cuántas horas se comunica el proveedor (se le dice al cliente).
--   * licencia (nube del cliente): cuándo envió la solicitud y qué pidió.
-- =====================================================================
ALTER TABLE portal_instalaciones
    ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES portal_planes(id),
    ADD COLUMN IF NOT EXISTS correo TEXT,
    ADD COLUMN IF NOT EXISTS telefono TEXT,
    ADD COLUMN IF NOT EXISTS contacto TEXT,
    ADD COLUMN IF NOT EXISTS sucursales_solicitadas INTEGER CHECK (sucursales_solicitadas IS NULL OR sucursales_solicitadas BETWEEN 1 AND 999),
    ADD COLUMN IF NOT EXISTS mensaje TEXT;

ALTER TABLE portal_config ADD COLUMN IF NOT EXISTS plazo_horas INTEGER NOT NULL DEFAULT 24 CHECK (plazo_horas BETWEEN 1 AND 720);

ALTER TABLE licencia
    ADD COLUMN IF NOT EXISTS solicitud_enviada_en TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS solicitud_datos JSONB;
