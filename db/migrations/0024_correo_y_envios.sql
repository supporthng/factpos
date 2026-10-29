-- =====================================================================
-- 0024 · Correo electrónico y envíos automáticos
--
-- La central envía por correo:
--   * el cierre de cada caja (reporte Z) apenas llega de la sucursal;
--   * el resumen del día anterior de todas las sucursales, a la hora elegida;
--   * los avisos de incidentes al servicio técnico.
-- La conexión (SMTP de Gmail, Outlook, el hosting… o Resend) se configura en
-- Administración › Correo y envíos. La contraseña se guarda cifrada.
-- =====================================================================

CREATE TABLE configuracion_correo (
    empresa_id        UUID PRIMARY KEY REFERENCES empresas(id),
    metodo            VARCHAR(10) NOT NULL DEFAULT 'SMTP' CHECK (metodo IN ('SMTP','RESEND')),
    smtp_servidor     TEXT,
    smtp_puerto       INTEGER CHECK (smtp_puerto BETWEEN 1 AND 65535),
    smtp_seguridad    VARCHAR(10) NOT NULL DEFAULT 'SSL' CHECK (smtp_seguridad IN ('SSL','STARTTLS','NINGUNA')),
    usuario           TEXT,
    clave_cifrada     TEXT,                 -- contraseña SMTP o clave de Resend (cifrada con PIN_SECRETO)
    remitente_nombre  TEXT,
    remitente_correo  TEXT,
    responder_a       TEXT,
    probado_en        TIMESTAMPTZ,
    prueba_ok         BOOLEAN,
    prueba_error      TEXT,
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_por   UUID
);

-- Qué se envía, a quién y de qué sucursales
CREATE TABLE envios_correo (
    empresa_id           UUID NOT NULL REFERENCES empresas(id),
    tipo                 VARCHAR(20) NOT NULL CHECK (tipo IN ('CIERRE_CAJA','RESUMEN_DIARIO','INCIDENTES')),
    activo               BOOLEAN NOT NULL DEFAULT FALSE,
    destinatarios        TEXT[] NOT NULL DEFAULT '{}',
    sucursales           UUID[],             -- NULL = todas
    hora                 SMALLINT NOT NULL DEFAULT 7 CHECK (hora BETWEEN 0 AND 23),  -- resumen diario (hora de RD)
    solo_con_diferencia  BOOLEAN NOT NULL DEFAULT FALSE,                              -- cierres: solo con faltante/sobrante
    activado_en          TIMESTAMPTZ,        -- no se envía lo que pasó antes de activarlo
    PRIMARY KEY (empresa_id, tipo)
);

-- Bitácora: cada correo una sola vez (tipo + clave), con reintentos si falla
CREATE TABLE correos_enviados (
    id               UUID PRIMARY KEY,
    empresa_id       UUID NOT NULL REFERENCES empresas(id),
    tipo             VARCHAR(20) NOT NULL,
    clave            TEXT NOT NULL,          -- id del turno, fecha del resumen…
    asunto           TEXT,
    destinatarios    TEXT[],
    estado           VARCHAR(10) NOT NULL DEFAULT 'ENVIANDO' CHECK (estado IN ('ENVIANDO','ENVIADO','ERROR')),
    intentos         SMALLINT NOT NULL DEFAULT 0,
    error            TEXT,
    proximo_intento  TIMESTAMPTZ,
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviado_en       TIMESTAMPTZ,
    UNIQUE (empresa_id, tipo, clave)
);
CREATE INDEX ix_correos_fecha ON correos_enviados (empresa_id, creado_en DESC);
CREATE INDEX ix_turnos_cerrados ON turnos (cerrado_en) WHERE estado = 'CERRADO';

-- Reporte: cierres de caja de todas las sucursales
CREATE VIEW rpt_cierres_caja AS
SELECT t.id AS turno_id, t.sucursal_id, s.nombre AS sucursal, ca.nombre AS caja, u.nombre AS cajero,
       (t.cerrado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       t.abierto_en, t.cerrado_en,
       (SELECT COUNT(*) FROM ventas v WHERE v.turno_id = t.id AND v.tipo_documento <> 'E34') AS facturas,
       (SELECT COALESCE(SUM(CASE WHEN v.tipo_documento = 'E34' THEN -v.total ELSE v.total END), 0)
          FROM ventas v WHERE v.turno_id = t.id) AS venta_total,
       (t.esperado ->> 'EFECTIVO')::numeric  AS efectivo_esperado,
       (t.declarado ->> 'EFECTIVO')::numeric AS efectivo_contado,
       t.diferencia,
       CASE WHEN t.diferencia < 0 THEN 'Faltante' WHEN t.diferencia > 0 THEN 'Sobrante' ELSE 'Cuadró' END AS resultado,
       uc.nombre AS cerrado_por, t.notas
  FROM turnos t
  JOIN sucursales s ON s.id = t.sucursal_id
  JOIN cajas ca ON ca.id = t.caja_id
  JOIN usuarios u ON u.id = t.usuario_id
  LEFT JOIN usuarios uc ON uc.id = t.cerrado_por
 WHERE t.estado = 'CERRADO';

-- Reporte: ventas por sucursal y día, con formas de pago
CREATE VIEW rpt_ventas_sucursal AS
SELECT d.sucursal_id, s.nombre AS sucursal, d.fecha,
       SUM(d.transacciones) AS transacciones,
       SUM(d.venta_total)   AS venta_total,
       SUM(d.itbis)         AS itbis,
       SUM(d.descuentos)    AS descuentos,
       ROUND(SUM(d.venta_total) / NULLIF(SUM(d.transacciones), 0), 2) AS ticket_promedio,
       COALESCE((SELECT SUM(f.monto) FROM rpt_formas_pago f WHERE f.sucursal_id = d.sucursal_id AND f.fecha = d.fecha AND f.forma_pago = 'EFECTIVO'), 0)      AS efectivo,
       COALESCE((SELECT SUM(f.monto) FROM rpt_formas_pago f WHERE f.sucursal_id = d.sucursal_id AND f.fecha = d.fecha AND f.forma_pago = 'TARJETA'), 0)       AS tarjeta,
       COALESCE((SELECT SUM(f.monto) FROM rpt_formas_pago f WHERE f.sucursal_id = d.sucursal_id AND f.fecha = d.fecha AND f.forma_pago = 'TRANSFERENCIA'), 0) AS transferencia,
       COALESCE((SELECT SUM(f.monto) FROM rpt_formas_pago f WHERE f.sucursal_id = d.sucursal_id AND f.fecha = d.fecha AND f.forma_pago = 'CREDITO'), 0)       AS credito
  FROM rpt_ventas_diarias d
  JOIN sucursales s ON s.id = d.sucursal_id
 GROUP BY d.sucursal_id, s.nombre, d.fecha;

REVOKE ALL ON configuracion_correo, envios_correo, correos_enviados FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON configuracion_correo, envios_correo, correos_enviados, rpt_cierres_caja, rpt_ventas_sucursal FROM anon, authenticated';
    END IF;
END $$;
