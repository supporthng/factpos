-- =====================================================================
-- 0164 · Ventas desde Onetech (www.onetechrd.com)
--   Cuando alguien paga FactPOS en la web de Onetech, Onetech llama a POST /licencias/onetech/venta y aquí se
--   crea el cliente con su licencia (o se renueva). onetech_ref guarda la orden o la suscripción de PayPal
--   para no crear dos veces la misma licencia y para encontrarla en cada cobro de renovación.
-- =====================================================================
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS onetech_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS portal_licencias_onetech_ref ON portal_licencias (onetech_ref) WHERE onetech_ref IS NOT NULL;
