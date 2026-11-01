-- Espacio extra de respaldos en la nube que el cliente contrata (se suma al tope base de RESPALDO_MAX_GB)
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS respaldo_extra_gb INTEGER NOT NULL DEFAULT 0 CHECK (respaldo_extra_gb >= 0);
