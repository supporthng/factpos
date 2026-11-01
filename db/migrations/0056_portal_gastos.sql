-- Apps y servicios de pago del proveedor (Vercel, Cloudflare, Claude API…) y su monto mensual, para calcular el costo por licencia.
CREATE TABLE IF NOT EXISTS portal_gastos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    servicio      TEXT NOT NULL,
    para          TEXT,                                   -- para qué se usa
    monto         NUMERIC(12,2) NOT NULL CHECK (monto >= 0),  -- monto mensual en su moneda
    moneda        TEXT NOT NULL DEFAULT 'USD' CHECK (moneda IN ('USD','DOP')),
    tasa          NUMERIC(10,4) NOT NULL DEFAULT 1 CHECK (tasa > 0), -- RD$ por cada unidad de la moneda
    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    notas         TEXT,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
