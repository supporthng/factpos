-- =====================================================================
-- 0014 · Seguridad en Supabase
--
-- Supabase publica las tablas del esquema "public" por su API web a los
-- roles anon y authenticated (la clave "anon" es pública). FactPOS no usa esa
-- API: se conecta directo a PostgreSQL. Por eso se les quita todo acceso a
-- esos roles, incluido lo que se cree en el futuro.
-- En una base PostgreSQL normal (sucursal) estos roles no existen y no pasa nada.
-- =====================================================================
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
