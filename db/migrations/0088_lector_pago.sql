-- El lector de facturas usa por omisión solo la IA gratuita; la de pago (Claude) la autoriza el proveedor licencia por licencia.
ALTER TABLE portal_licencias ADD COLUMN IF NOT EXISTS lector_pago BOOLEAN NOT NULL DEFAULT false;
