-- Empresas (RNC distintos) enlazadas por un mismo administrador: comparten grupo.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS grupo_id UUID;
CREATE INDEX IF NOT EXISTS ix_empresas_grupo ON empresas (grupo_id) WHERE grupo_id IS NOT NULL;
