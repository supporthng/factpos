-- Código de conexión corto de cada empresa (p. ej. FP-K7M4QX): se escribe en las apps FactPOS Admin
-- en lugar del nombre corto o la dirección. Sin 0/O/1/I/L para que no se confunda al dictarlo.
CREATE OR REPLACE FUNCTION codigo_conexion() RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT 'FP-' || string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
    FROM generate_series(1, 6)
$$;

ALTER TABLE portal_clientes ADD COLUMN IF NOT EXISTS codigo TEXT;
UPDATE portal_clientes SET codigo = codigo_conexion() WHERE codigo IS NULL;
-- Por si dos filas sacaron el mismo código (muy improbable): se vuelve a sortear solo las repetidas
DO $$
BEGIN
  WHILE EXISTS (SELECT 1 FROM portal_clientes GROUP BY codigo HAVING count(*) > 1) LOOP
    UPDATE portal_clientes SET codigo = codigo_conexion()
     WHERE id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY codigo ORDER BY creado_en, id) AS n FROM portal_clientes) x WHERE n > 1);
  END LOOP;
END $$;
ALTER TABLE portal_clientes ALTER COLUMN codigo SET DEFAULT codigo_conexion();
ALTER TABLE portal_clientes ALTER COLUMN codigo SET NOT NULL;
ALTER TABLE portal_clientes ADD CONSTRAINT portal_clientes_codigo_uq UNIQUE (codigo);
ALTER TABLE portal_clientes ADD CONSTRAINT portal_clientes_codigo_formato CHECK (codigo ~ '^FP-[2-9A-HJKMNP-Z]{6}$');
