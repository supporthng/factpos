-- =====================================================================
-- 0017 · Padrón de contribuyentes de la DGII (RNC y cédulas)
--
-- Copia local del listado público de la DGII (DGII_RNC.zip, ~770 mil
-- registros) para que la caja complete el nombre con solo escribir el RNC,
-- sin internet y al instante. Cada servidor tiene su copia y la actualiza
-- solo; no viaja por la sincronización.
-- =====================================================================
CREATE TABLE padron_rnc (
    rnc              VARCHAR(11) PRIMARY KEY,
    nombre           TEXT NOT NULL,
    nombre_comercial TEXT,
    actividad        TEXT,
    estado           VARCHAR(20),   -- ACTIVO, SUSPENDIDO, DADO DE BAJA, CESE TEMPORAL, ANULADO, RECHAZADO
    regimen          TEXT
);

-- Cuándo y de dónde se cargó por última vez
CREATE TABLE padron_rnc_info (
    id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    actualizado_en  TIMESTAMPTZ,
    registros       INTEGER NOT NULL DEFAULT 0,
    fuente          TEXT,
    estado          VARCHAR(15) NOT NULL DEFAULT 'VACIO' CHECK (estado IN ('VACIO','CARGANDO','LISTO','ERROR')),
    mensaje         TEXT
);
INSERT INTO padron_rnc_info (id) VALUES (1);
