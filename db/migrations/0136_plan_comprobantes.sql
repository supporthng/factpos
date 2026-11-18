-- =====================================================================
-- 0136 · Cada plan de FactPOS puede indicar su plan de comprobantes (e-CF con MSeller)
--   La cantidad de comprobantes al mes sale de ese plan (portal_ecf_planes.max_mes); la página web
--   muestra la cantidad, nunca el costo de MSeller.
-- =====================================================================
ALTER TABLE portal_planes ADD COLUMN IF NOT EXISTS ecf_plan_id UUID REFERENCES portal_ecf_planes(id) ON DELETE SET NULL;
