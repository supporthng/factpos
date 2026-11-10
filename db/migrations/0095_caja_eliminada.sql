-- «Eliminar» una terminal de venta la oculta (conserva sus ventas y turnos): queda desactivada y marcada como eliminada.
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS eliminada boolean NOT NULL DEFAULT false;
