-- Desglose de billetes y monedas con que se abre el turno (cantidad por denominación). Opcional: turnos viejos quedan en NULL.
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS conteo_apertura jsonb;
