-- Aprobación comercial (ACECF) que damos a los e-CF recibidos
ALTER TABLE ecf_recibidos
    ADD COLUMN aprobacion_estado     SMALLINT,      -- 1 aceptado, 2 rechazado
    ADD COLUMN aprobacion_motivo     TEXT,
    ADD COLUMN aprobacion_resultado  VARCHAR(12),   -- ENVIADA | RECHAZADA | SIMULADA
    ADD COLUMN aprobacion_respuesta  TEXT,
    ADD COLUMN aprobacion_en         TIMESTAMPTZ;
