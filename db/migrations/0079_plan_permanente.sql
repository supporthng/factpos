-- =====================================================================
-- 0079 · Planes de licencia permanente (pago único, sin vencimiento)
--   Un plan marcado como permanente deja la licencia de sus clientes con vencimiento 2099-12-31 («sin vencimiento»).
-- =====================================================================
ALTER TABLE portal_planes ADD COLUMN IF NOT EXISTS permanente BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION portal_licencia_permanente() RETURNS trigger AS $$
BEGIN
    IF NEW.plan_id IS NOT NULL AND EXISTS (SELECT 1 FROM portal_planes p WHERE p.id = NEW.plan_id AND p.permanente) THEN
        NEW.vence := DATE '2099-12-31';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS portal_licencia_permanente ON portal_licencias;
CREATE TRIGGER portal_licencia_permanente BEFORE INSERT OR UPDATE ON portal_licencias
    FOR EACH ROW EXECUTE FUNCTION portal_licencia_permanente();

-- Si se marca un plan como permanente, sus licencias existentes pasan a «sin vencimiento»
CREATE OR REPLACE FUNCTION portal_plan_permanente() RETURNS trigger AS $$
BEGIN
    IF NEW.permanente AND NOT COALESCE(OLD.permanente, FALSE) THEN
        UPDATE portal_licencias SET vence = DATE '2099-12-31' WHERE plan_id = NEW.id;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS portal_plan_permanente ON portal_planes;
CREATE TRIGGER portal_plan_permanente AFTER UPDATE ON portal_planes
    FOR EACH ROW EXECUTE FUNCTION portal_plan_permanente();
