-- =====================================================================
-- 0109 · Vales de consumo incluidos en la entrada (discotecas, bares)
--   Un producto puede traer N consumos incluidos (p. ej. «Entrada con 2 tragos»). Al venderlo se crea un vale por unidad con un
--   código corto que sale en el ticket; en la cuenta se canjea (no se cobra, descuenta inventario y queda en el reporte de control).
--   Apagado: ningún producto tiene vale (0) hasta que se configure. El vale es operación de la sucursal: no se sincroniza.
-- =====================================================================
ALTER TABLE productos ADD COLUMN IF NOT EXISTS vale_consumos SMALLINT NOT NULL DEFAULT 0 CHECK (vale_consumos BETWEEN 0 AND 20);

CREATE TABLE IF NOT EXISTS vales_consumo (
    id           UUID PRIMARY KEY,
    sucursal_id  UUID NOT NULL REFERENCES sucursales(id),
    venta_id     UUID REFERENCES ventas(id),
    codigo       VARCHAR(8) NOT NULL,
    descripcion  TEXT NOT NULL,                 -- «Entrada VIP»
    consumos     SMALLINT NOT NULL CHECK (consumos > 0),
    usados       SMALLINT NOT NULL DEFAULT 0 CHECK (usados >= 0 AND usados <= consumos),
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sucursal_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_vales_venta ON vales_consumo (venta_id);

-- El control de cuentas también registra los canjes de vales
ALTER TABLE control_cuentas DROP CONSTRAINT IF EXISTS control_cuentas_tipo_check;
ALTER TABLE control_cuentas ADD CONSTRAINT control_cuentas_tipo_check CHECK (tipo IN ('CORTESIA','ANULACION','VALE'));

CREATE OR REPLACE VIEW rpt_control_cuentas AS
SELECT c.sucursal_id, s.nombre AS sucursal,
       (c.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       to_char(c.creado_en AT TIME ZONE 'America/Santo_Domingo', 'HH24:MI') AS hora,
       CASE c.tipo WHEN 'CORTESIA' THEN 'Cortesía' WHEN 'VALE' THEN 'Vale de consumo' ELSE 'Anulación' END AS tipo,
       c.cuenta_nombre AS cuenta, c.descripcion AS producto, c.cantidad, c.valor, c.costo,
       c.motivo_tipo AS motivo_tipo, COALESCE(c.motivo, '') AS motivo,
       u.nombre AS cajero, a.nombre AS autorizado_por
  FROM control_cuentas c
  JOIN sucursales s ON s.id = c.sucursal_id
  JOIN usuarios u ON u.id = c.usuario_id
  LEFT JOIN usuarios a ON a.id = c.autorizado_por;

REVOKE ALL ON vales_consumo FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON vales_consumo FROM anon, authenticated';
    END IF;
END $$;
