-- Portal de FactPOS: complemento «Facturación electrónica» por cliente.
--   * portal_ecf_planes: rangos de comprobantes/mes con lo que le cuesta al proveedor y lo que se cobra (USD).
--   * portal_licencias: plan e-CF del cliente (y precio especial opcional).
--   * portal_ecf_uso: comprobantes e-CF emitidos por mes, reportados por la nube de cada cliente al renovar la licencia.
--   * portal_config.ecf_tasa_dop: pesos por dólar (solo para mostrar el reporte en pesos).
CREATE TABLE IF NOT EXISTS portal_ecf_planes (
    id         UUID PRIMARY KEY,
    codigo     TEXT NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9-]{2,30}$'),
    nombre     TEXT NOT NULL,
    max_mes    INTEGER NOT NULL CHECK (max_mes > 0),            -- comprobantes e-CF incluidos por mes
    costo_usd  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (costo_usd >= 0),   -- lo que paga el proveedor (por mes)
    precio_usd NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (precio_usd >= 0),  -- lo que se cobra al cliente (por mes)
    activo     BOOLEAN NOT NULL DEFAULT TRUE,
    orden      INTEGER NOT NULL DEFAULT 0
);

INSERT INTO portal_ecf_planes (id, codigo, nombre, max_mes, costo_usd, precio_usd, orden)
SELECT gen_random_uuid(), v.codigo, v.nombre, v.max_mes, v.costo, v.precio, v.orden FROM (VALUES
    ('e-80',   'Hasta 80',     80,    10,  15,  1),
    ('e-400',  'Hasta 400',    400,   25,  38,  2),
    ('e-1200', 'Hasta 1,200',  1200,  45,  68,  3),
    ('e-2500', 'Hasta 2,500',  2500,  75,  113, 4),
    ('e-25000','Hasta 25,000', 25000, 110, 165, 5)
) AS v(codigo, nombre, max_mes, costo, precio, orden)
WHERE NOT EXISTS (SELECT 1 FROM portal_ecf_planes);

ALTER TABLE portal_licencias
    ADD COLUMN IF NOT EXISTS ecf_plan_id UUID REFERENCES portal_ecf_planes(id),
    ADD COLUMN IF NOT EXISTS ecf_precio_usd NUMERIC(10,2) CHECK (ecf_precio_usd IS NULL OR ecf_precio_usd >= 0);   -- precio especial (null = el del plan)

CREATE TABLE IF NOT EXISTS portal_ecf_uso (
    licencia_id    UUID NOT NULL REFERENCES portal_licencias(id) ON DELETE CASCADE,
    mes            CHAR(7) NOT NULL CHECK (mes ~ '^\d{4}-\d{2}$'),   -- 'YYYY-MM' (hora de Santo Domingo)
    emitidos       INTEGER NOT NULL CHECK (emitidos >= 0),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (licencia_id, mes)
);

ALTER TABLE portal_config ADD COLUMN IF NOT EXISTS ecf_tasa_dop NUMERIC(8,2) CHECK (ecf_tasa_dop IS NULL OR ecf_tasa_dop > 0);

REVOKE ALL ON portal_ecf_planes, portal_ecf_uso FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON portal_ecf_planes, portal_ecf_uso FROM anon, authenticated';
    END IF;
END $$;
