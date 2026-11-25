-- Modo «una sola persona factura y cobra»: quien factura también abre y cierra su turno desde la Administración (negocios chicos).
-- Apagado por defecto: nada cambia para los clientes actuales.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS una_sola_persona BOOLEAN NOT NULL DEFAULT false;
