-- =====================================================================
-- 0137 · Tipo de negocio «Mueblería y electrodomésticos» y planes de financiamiento con inicial mínima
--   · empresas.tipo_negocio admite MUEBLERIA (no activa mesas ni comandas).
--   · cxc_planes_catalogo: inicial mínima (%) y monto mínimo a financiar por plan.
-- =====================================================================
ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_tipo_negocio_check;
ALTER TABLE empresas ADD CONSTRAINT empresas_tipo_negocio_check
    CHECK (tipo_negocio IN ('TIENDA','RESTAURANTE','BAR','DISCOTECA','COMIDA_RAPIDA','MUEBLERIA'));

ALTER TABLE cxc_planes_catalogo ADD COLUMN IF NOT EXISTS inicial_min_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (inicial_min_pct BETWEEN 0 AND 100);
ALTER TABLE cxc_planes_catalogo ADD COLUMN IF NOT EXISTS monto_minimo NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (monto_minimo >= 0);
