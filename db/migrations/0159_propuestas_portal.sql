-- =====================================================================
-- 0159 · Propuestas comerciales del portal
--   Una propuesta es el enlace que el proveedor manda a un posible cliente para ofrecerle FactPOS según su tipo de negocio
--   (estándar o una edición). Cada enlace es propio: así se sabe si lo abrió y si pidió hablar con ventas.
-- =====================================================================
CREATE TABLE IF NOT EXISTS portal_propuestas (
    id              UUID PRIMARY KEY,
    edicion         TEXT NOT NULL,               -- ESTANDAR o el id de una edición (MUEBLERIA, FARMACIA…)
    nombre          TEXT NOT NULL,               -- persona o negocio al que va dirigida
    telefono        TEXT,                        -- WhatsApp (solo dígitos con código de país)
    correo          TEXT,
    nota            TEXT,
    mensaje         TEXT,                        -- texto enviado
    creada_por      UUID,
    creada_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviada_en      TIMESTAMPTZ,
    visitas         INTEGER NOT NULL DEFAULT 0,
    primera_visita  TIMESTAMPTZ,
    ultima_visita   TIMESTAMPTZ,
    contactos       INTEGER NOT NULL DEFAULT 0,  -- veces que pulsó «Hablar con nosotros»
    ultimo_contacto TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS portal_propuestas_creada ON portal_propuestas (creada_en DESC);
