-- Edición de FactPOS por tipo de negocio (FactPOS Mueblería, Bar y Restaurante, Abarrotes, Licorería, Supermercado).
-- Es el nombre comercial del cliente en el portal; viaja en su licencia. NULL = FactPOS estándar.
ALTER TABLE portal_clientes ADD COLUMN IF NOT EXISTS edicion TEXT;
