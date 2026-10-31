-- =====================================================================
-- 0038 · Invitaciones del portal (mensajes de WhatsApp para conocer FactPOS)
--   Solo se usa en el PORTAL. Cada invitación tiene un enlace propio para saber
--   si la persona abrió la página y si descargó el instalador.
-- =====================================================================
CREATE TABLE IF NOT EXISTS portal_invitaciones (
    id              UUID PRIMARY KEY,
    nombre          TEXT NOT NULL,               -- persona o negocio invitado
    telefono        TEXT NOT NULL,               -- WhatsApp, solo dígitos con código de país
    nota            TEXT,
    mensaje         TEXT NOT NULL,               -- texto enviado
    creada_por      UUID,
    creada_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviada_en      TIMESTAMPTZ,
    visitas         INTEGER NOT NULL DEFAULT 0,
    primera_visita  TIMESTAMPTZ,
    ultima_visita   TIMESTAMPTZ,
    descargas       INTEGER NOT NULL DEFAULT 0,
    ultima_descarga TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS portal_invitaciones_creada ON portal_invitaciones (creada_en DESC);
