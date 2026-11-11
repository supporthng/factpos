-- =====================================================================
-- 0106 · Control de cortesías y anulaciones en las cuentas (bares, discotecas, restaurantes)
--   Cada cortesía (producto regalado) y cada anulación de algo que ya salió a la barra o la cocina queda registrada con quién la
--   hizo, quién la autorizó, el motivo y su valor. La cortesía además descuenta el inventario (consumo interno). Sube a la central.
-- =====================================================================
CREATE TABLE IF NOT EXISTS control_cuentas (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('CORTESIA','ANULACION')),
    cuenta_id       UUID NOT NULL,                 -- sin FK: las cuentas son locales de la sucursal
    cuenta_nombre   TEXT NOT NULL,
    caja_id         UUID,
    producto_id     UUID REFERENCES productos(id),
    descripcion     TEXT NOT NULL,
    cantidad        NUMERIC(14,3) NOT NULL,
    valor           NUMERIC(14,2) NOT NULL DEFAULT 0,   -- lo que habría cobrado (con impuestos)
    costo           NUMERIC(14,2) NOT NULL DEFAULT 0,   -- lo que costó el inventario regalado (solo cortesías)
    motivo_tipo     VARCHAR(20) NOT NULL DEFAULT 'OTRO',
    motivo          TEXT,
    ya_enviada      BOOLEAN NOT NULL DEFAULT FALSE,     -- ya estaba en la barra o la cocina
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    autorizado_por  UUID REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_control_cuentas ON control_cuentas (sucursal_id, creado_en);

CREATE OR REPLACE VIEW rpt_control_cuentas AS
SELECT c.sucursal_id, s.nombre AS sucursal,
       (c.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       to_char(c.creado_en AT TIME ZONE 'America/Santo_Domingo', 'HH24:MI') AS hora,
       CASE c.tipo WHEN 'CORTESIA' THEN 'Cortesía' ELSE 'Anulación' END AS tipo,
       c.cuenta_nombre AS cuenta, c.descripcion AS producto, c.cantidad, c.valor, c.costo,
       c.motivo_tipo AS motivo_tipo, COALESCE(c.motivo, '') AS motivo,
       u.nombre AS cajero, a.nombre AS autorizado_por
  FROM control_cuentas c
  JOIN sucursales s ON s.id = c.sucursal_id
  JOIN usuarios u ON u.id = c.usuario_id
  LEFT JOIN usuarios a ON a.id = c.autorizado_por;

REVOKE ALL ON control_cuentas FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON control_cuentas FROM anon, authenticated';
    END IF;
END $$;
