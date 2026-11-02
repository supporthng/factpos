-- Desde dónde se consultó el precio: el lector fijo o el celular del cliente.
ALTER TABLE verificador_consultas ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'lector';
