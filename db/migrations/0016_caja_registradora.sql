-- =====================================================================
-- 0016 · La terminal como caja registradora
--
-- * Cierre de turno (reporte Z) con conteo ciego: se guarda el conteo de
--   billetes y monedas además de lo declarado, esperado y la diferencia.
-- * Clientes creados en la caja: siempre con Precio 1. Cambiar el nivel
--   requiere el permiso "cliente.precio" (PIN de supervisor) y queda auditado.
-- =====================================================================
ALTER TABLE turnos ADD COLUMN conteo JSONB;   -- {"2000": 3, "1000": 5, ..., "1": 12}
ALTER TABLE turnos ADD COLUMN notas TEXT;

ALTER TABLE clientes ADD COLUMN creado_en TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE clientes ADD COLUMN creado_por UUID REFERENCES usuarios(id);
-- Un mismo documento no se registra dos veces en la empresa
CREATE UNIQUE INDEX ux_clientes_documento ON clientes (empresa_id, tipo_documento, documento)
    WHERE documento IS NOT NULL AND activo;

-- Quien aprueba descuentos también puede cambiar el nivel de precio de un cliente
UPDATE roles SET permisos = array_append(permisos, 'cliente.precio')
 WHERE 'venta.descuento' = ANY(permisos) AND NOT ('cliente.precio' = ANY(permisos));
