-- =====================================================================
-- 0023 · Uso del certificado digital por sucursal
--
-- El certificado se sube una vez en la Administración (es de la empresa,
-- un solo RNC) y desde ahí se activa o desactiva para cada sucursal.
-- Una sucursal desactivada no lo recibe (y si lo tenía, lo deja de usar):
-- solo puede facturar en el ambiente Simulado.
-- =====================================================================
ALTER TABLE sucursales ADD COLUMN certificado_habilitado BOOLEAN NOT NULL DEFAULT FALSE;
