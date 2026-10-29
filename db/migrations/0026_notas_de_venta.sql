-- =====================================================================
-- 0026 · Observaciones de la venta
-- Nota libre que el cajero escribe en la venta (ej. "entregar en la
-- puerta 2", "cliente paga el resto mañana"). Sale en el ticket.
-- =====================================================================
ALTER TABLE ventas ADD COLUMN notas TEXT CHECK (notas IS NULL OR length(notas) <= 300);
