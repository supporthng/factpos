-- La caja usa la lista de precios predeterminada cuando el cliente no tiene una asignada.
ALTER TABLE listas_precio ADD COLUMN es_predeterminada BOOLEAN NOT NULL DEFAULT FALSE;

-- Solo una lista predeterminada por empresa
CREATE UNIQUE INDEX ux_lista_predeterminada ON listas_precio (empresa_id) WHERE es_predeterminada;

-- Búsqueda rápida de productos por nombre en la caja
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ix_productos_nombre_trgm ON productos USING gin (nombre gin_trgm_ops);
