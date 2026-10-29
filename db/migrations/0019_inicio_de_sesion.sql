-- =====================================================================
-- 0019 · Inicio de sesión y permisos
--   * Administración: usuario + contraseña (usuarios.clave_hash, scrypt).
--   * Caja: el cajero entra con su PIN (usuarios.pin_hash, ya existía).
--   * Cada servidor de sucursal se conecta a la nube con su propia clave.
-- =====================================================================

-- Clave de conexión de cada sucursal (solo en la central; no se sincroniza)
CREATE TABLE sucursal_claves (
    sucursal_id   UUID PRIMARY KEY REFERENCES sucursales(id),
    clave_hash    TEXT NOT NULL,
    creada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    creada_por    UUID REFERENCES usuarios(id)
);

-- Permisos nuevos en los roles que ya existen
UPDATE roles SET permisos = array_append(permisos, 'caja.retiro')
 WHERE 'venta.anular' = ANY(permisos) AND NOT 'caja.retiro' = ANY(permisos);
UPDATE roles SET permisos = array_append(permisos, 'caja.gasto')
 WHERE 'venta.anular' = ANY(permisos) AND NOT 'caja.gasto' = ANY(permisos);
UPDATE roles SET permisos = array_append(permisos, 'cxc.abono')
 WHERE 'venta.crear' = ANY(permisos) AND NOT 'cxc.abono' = ANY(permisos);
-- Un supervisor también puede vender (cubrir una caja)
UPDATE roles SET permisos = array_append(permisos, 'venta.crear')
 WHERE 'venta.anular' = ANY(permisos) AND NOT 'venta.crear' = ANY(permisos) AND NOT '*' = ANY(permisos);

REVOKE ALL ON sucursal_claves FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON sucursal_claves FROM anon, authenticated';
    END IF;
END $$;
