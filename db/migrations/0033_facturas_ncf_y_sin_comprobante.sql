-- =====================================================================
-- Las tres modalidades de factura:
--   * e-CF (E31 crédito fiscal / E32 consumo, nota de crédito E34)  — ya existía
--   * NCF serie B (B01 crédito fiscal / B02 consumo) con rangos autorizados por la DGII
--   * Factura interna SIN comprobante fiscal (numeración FI-000001 por sucursal)
-- La anulación de una B01/B02/SIN genera un documento ANU (resta en reportes y cuadres).
--
-- El código (ventas, rangos NCF en la administración, ticket) ya usaba estas tablas y
-- columnas, pero ninguna migración las creaba: las ventas B01/B02/SIN fallaban.
-- =====================================================================

-- Tipos de documento permitidos en ventas
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_tipo_documento_check;
ALTER TABLE ventas ADD CONSTRAINT ventas_tipo_documento_check
    CHECK (tipo_documento IN ('E31','E32','E34','B01','B02','SIN','ANU'));

-- Número del comprobante no electrónico: B0100000001, B0200000001 o FI-000001
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(19);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ventas_numero_documento ON ventas (sucursal_id, numero_documento) WHERE numero_documento IS NOT NULL;

-- Rangos de NCF serie B autorizados (por sucursal). La sucursal es dueña del contador.
CREATE TABLE IF NOT EXISTS facturacion_rangos_ncf (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    tipo            VARCHAR(3) NOT NULL CHECK (tipo IN ('B01','B02')),
    desde           BIGINT NOT NULL CHECK (desde BETWEEN 1 AND 99999999),
    hasta           BIGINT NOT NULL CHECK (hasta BETWEEN 1 AND 99999999),
    siguiente       BIGINT NOT NULL,             -- próximo número a usar
    vence_en        DATE NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (hasta >= desde),
    CHECK (siguiente BETWEEN desde AND hasta + 1)
);
CREATE INDEX IF NOT EXISTS ix_rangos_ncf_uso ON facturacion_rangos_ncf (sucursal_id, tipo, vence_en, desde) WHERE activo;
DROP TRIGGER IF EXISTS tr_facturacion_rangos_ncf_version ON facturacion_rangos_ncf;
CREATE TRIGGER tr_facturacion_rangos_ncf_version BEFORE INSERT OR UPDATE ON facturacion_rangos_ncf
    FOR EACH ROW EXECUTE FUNCTION fn_version();

-- Contador de las facturas internas sin comprobante (FI-000001…), por sucursal
CREATE TABLE IF NOT EXISTS facturacion_contadores (
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    modalidad       VARCHAR(5) NOT NULL,
    ultimo          BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (sucursal_id, modalidad)
);

-- Reportes: la anulación interna (ANU) resta igual que la nota de crédito electrónica (E34)
DO $$
DECLARE
    v RECORD;
    def TEXT;
    nuevo TEXT;
BEGIN
    FOR v IN
        SELECT c.relname AS nombre FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'v'
         ORDER BY c.oid
    LOOP
        def := pg_get_viewdef(v.nombre::regclass, false);
        IF def NOT LIKE '%''E34''::%' OR def LIKE '%''ANU''%' THEN CONTINUE; END IF;
        nuevo := replace(def, ' = ''E34''::text', ' = ANY (ARRAY[''E34''::text, ''ANU''::text])');
        nuevo := replace(nuevo, ' <> ''E34''::text', ' <> ALL (ARRAY[''E34''::text, ''ANU''::text])');
        nuevo := replace(nuevo, ' = ''E34''::character varying', ' = ANY (ARRAY[''E34''::character varying, ''ANU''::character varying])');
        nuevo := replace(nuevo, ' <> ''E34''::character varying', ' <> ALL (ARRAY[''E34''::character varying, ''ANU''::character varying])');
        IF nuevo <> def THEN
            EXECUTE format('CREATE OR REPLACE VIEW %I AS %s', v.nombre, nuevo);
        END IF;
    END LOOP;
END $$;

-- Reporte de anulaciones: también el número de las facturas NCF / internas
DO $$
DECLARE def TEXT;
BEGIN
    def := pg_get_viewdef('rpt_anulaciones'::regclass, false);
    IF def LIKE '%eo.encf AS factura%' THEN
        def := replace(def, 'eo.encf AS factura', 'COALESCE(eo.encf, o.numero_documento)::character varying(19) AS factura');
        def := replace(def, 'en.encf AS nota_credito', 'COALESCE(en.encf, n.numero_documento)::character varying(19) AS nota_credito');
        EXECUTE 'DROP VIEW rpt_anulaciones';
        EXECUTE 'CREATE VIEW rpt_anulaciones AS ' || def;
    END IF;
END $$;
