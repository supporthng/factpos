-- =====================================================================
-- 0009 · Marca del cliente (tema camaleón)
-- Logo y colores de la empresa: pintan la Terminal, la Administración y el
-- ticket. Se sincroniza a las sucursales como cualquier dato maestro.
-- =====================================================================
CREATE TABLE configuracion_marca (
    empresa_id      UUID PRIMARY KEY REFERENCES empresas(id),
    logo            TEXT,                         -- imagen como data URL (PNG/WebP, reducida)
    color_primario  VARCHAR(7) NOT NULL DEFAULT '#2dd4bf' CHECK (color_primario ~ '^#[0-9a-fA-F]{6}$'),
    color_secundario VARCHAR(7) CHECK (color_secundario ~ '^#[0-9a-fA-F]{6}$'),
    logo_en_ticket  BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (logo IS NULL OR (logo LIKE 'data:image/%' AND length(logo) <= 400000))
);
CREATE TRIGGER tr_configuracion_marca_version BEFORE INSERT OR UPDATE ON configuracion_marca
    FOR EACH ROW EXECUTE FUNCTION fn_version();
