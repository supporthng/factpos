-- =====================================================================
-- 0028 · Dos formas más de dar de alta un servidor
--   * SOLICITUD: al instalarse, el servidor aparece en Administración ›
--     Sucursales › «Servidores esperando alta»; solo hay que confirmar.
--     Si el instalador indicó el RNC, solo la ve esa empresa.
--   * CÓDIGO DE INSTALACIÓN: la Administración genera un código para una
--     sucursal; al instalar el servidor se escribe y queda dada de alta sola.
-- =====================================================================
ALTER TABLE altas_servidor ALTER COLUMN sondeo_hash DROP NOT NULL;
ALTER TABLE altas_servidor
    ADD COLUMN origen      TEXT NOT NULL DEFAULT 'SERVIDOR' CHECK (origen IN ('SERVIDOR', 'ADMINISTRACION')),
    ADD COLUMN rnc         VARCHAR(11),            -- empresa que indicó el instalador (opcional)
    ADD COLUMN creado_por  UUID REFERENCES usuarios(id),
    ADD COLUMN descartado_en TIMESTAMPTZ;          -- la Administración la rechazó
CREATE INDEX ix_altas_servidor_abiertas ON altas_servidor (origen, expira_en) WHERE aprobado_en IS NULL AND descartado_en IS NULL;
