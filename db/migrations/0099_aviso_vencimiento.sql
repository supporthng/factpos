-- Avisos por correo de vencimiento de licencia (30, 15 y 5 días): uno por licencia, fecha de vencimiento y umbral
CREATE TABLE IF NOT EXISTS portal_avisos_vencimiento (
    licencia_id UUID NOT NULL REFERENCES portal_licencias(id) ON DELETE CASCADE,
    vence       DATE NOT NULL,
    umbral      SMALLINT NOT NULL,
    enviado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (licencia_id, vence, umbral)
);
REVOKE ALL ON portal_avisos_vencimiento FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON portal_avisos_vencimiento FROM anon, authenticated';
    END IF;
END $$;
