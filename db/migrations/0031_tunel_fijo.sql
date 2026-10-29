-- =====================================================================
-- 0031 · Túnel fijo de cada cliente (solo en el PORTAL)
--   El portal crea en Cloudflare un túnel con nombre para el servidor master
--   de cada empresa y su dirección <empresa>.factpos.app.
-- =====================================================================
ALTER TABLE portal_clientes
    ADD COLUMN tunel_id        TEXT,          -- id del túnel en Cloudflare
    ADD COLUMN tunel_host      TEXT,          -- ej. royalliquorstore.factpos.app
    ADD COLUMN tunel_creado_en TIMESTAMPTZ;
