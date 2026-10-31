-- Las anulaciones de facturas NCF serie B y sin comprobante se guardan como tipo 'ANU' (las electrónicas, como E34).
-- Los reportes y el cuadre de caja solo restaban 'E34': se corrigen todas las vistas que lo hacen para que
-- también resten 'ANU'. Se reescribe cada vista a partir de su propia definición (mismas columnas).
DO $$
DECLARE
    v RECORD;
    sql TEXT;
BEGIN
    FOR v IN
        SELECT c.relname, pg_get_viewdef(c.oid, true) AS def
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'v' AND n.nspname = 'public'
           AND pg_get_viewdef(c.oid, true) LIKE '%''E34''%' AND pg_get_viewdef(c.oid, true) NOT LIKE '%''ANU''%'
    LOOP
        sql := v.def;
        sql := regexp_replace(sql, '<>\s*''E34''(::(text|character varying|bpchar))?', '<> ALL (ARRAY[''E34'', ''ANU''])', 'g');
        sql := regexp_replace(sql, '=\s*''E34''(::(text|character varying|bpchar))?', '= ANY (ARRAY[''E34'', ''ANU''])', 'g');
        IF sql <> v.def THEN
            EXECUTE format('CREATE OR REPLACE VIEW %I AS %s', v.relname, regexp_replace(sql, ';\s*$', ''));
            RAISE NOTICE 'Vista % actualizada', v.relname;
        END IF;
    END LOOP;
END $$;
