-- =====================================================================
-- 0004 · Administración central de sucursales
--
-- La oficina central (en la nube) es dueña de los datos maestros:
-- productos, precios por sucursal, ofertas por sucursal, mínimos y
-- máximos. Cada servidor local los descarga pidiendo "todo lo que cambió
-- después de la versión X".
--
-- Para que esa descarga funcione:
--   * Toda tabla maestra recibe un número de versión GLOBAL y creciente
--     en cada alta o cambio (secuencia sync_version).
--   * Los datos maestros nunca se borran: se desactivan (activo = false),
--     así la desactivación también viaja a las sucursales.
-- =====================================================================

CREATE SEQUENCE sync_version AS BIGINT;

CREATE FUNCTION fn_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.version := nextval('sync_version');
    NEW.actualizado_en := now();
    RETURN NEW;
END $$;

-- Precios y alcances de oferta se desactivan en vez de borrarse
ALTER TABLE precios        ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE oferta_alcance ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE codigos_barra  ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE;

-- Producto habilitado o no en cada sucursal (ej. licores solo en algunas)
ALTER TABLE producto_sucursal ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE;

-- Ofertas por sucursal: lista de sucursales (NULL = todas)
ALTER TABLE ofertas ADD COLUMN sucursales UUID[];
UPDATE ofertas SET sucursales = ARRAY[sucursal_id] WHERE sucursal_id IS NOT NULL;
ALTER TABLE ofertas DROP COLUMN sucursal_id;
CREATE INDEX ix_ofertas_sucursales ON ofertas USING gin (sucursales);

-- Cupones válidos solo en ciertas sucursales (NULL = todas)
ALTER TABLE cupones ADD COLUMN sucursales UUID[];

-- Versión global en todas las tablas maestras
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'empresas','sucursales','almacenes','cajas','roles','usuarios',
        'impuestos','categorias','productos','presentaciones','codigos_barra',
        'listas_precio','precios','clientes','proveedores','producto_sucursal',
        'lotes','ofertas','oferta_alcance','cupones','transferencias','conteos_fisicos']
    LOOP
        EXECUTE format('CREATE TRIGGER tr_%s_version BEFORE INSERT OR UPDATE ON %I
                        FOR EACH ROW EXECUTE FUNCTION fn_version()', t, t);
        EXECUTE format('UPDATE %I SET version = nextval(''sync_version'')', t);
        EXECUTE format('CREATE INDEX ix_%s_version ON %I (version)', t, t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Reportes centrales
-- ---------------------------------------------------------------------
-- Existencia por producto y sucursal (todas las sucursales en una vista)
CREATE VIEW rpt_inventario_sucursales AS
SELECT p.empresa_id, p.id AS producto_id, p.sku, p.nombre, p.categoria_id,
       a.sucursal_id, s.nombre AS sucursal,
       SUM(e.cantidad) AS cantidad,
       ROUND(SUM(e.cantidad * e.costo_promedio), 2) AS valor,
       MAX(ps.stock_minimo) AS stock_minimo,
       MAX(ps.stock_maximo) AS stock_maximo,
       SUM(e.cantidad) <= COALESCE(MAX(ps.stock_minimo), 0) AS bajo_minimo
FROM existencias e
JOIN almacenes a  ON a.id = e.almacen_id
JOIN sucursales s ON s.id = a.sucursal_id
JOIN productos p  ON p.id = e.producto_id
LEFT JOIN producto_sucursal ps ON ps.producto_id = p.id AND ps.sucursal_id = a.sucursal_id
GROUP BY p.empresa_id, p.id, p.sku, p.nombre, p.categoria_id, a.sucursal_id, s.nombre;

-- Resumen del día por sucursal
CREATE VIEW rpt_resumen_sucursales AS
SELECT s.empresa_id, s.id AS sucursal_id, s.nombre AS sucursal,
       COALESCE(v.venta_hoy, 0) AS venta_hoy,
       COALESCE(v.transacciones_hoy, 0) AS transacciones_hoy,
       COALESCE(i.valor_inventario, 0) AS valor_inventario,
       COALESCE(b.bajo_minimo, 0) AS productos_bajo_minimo,
       COALESCE(t.por_recibir, 0) AS traspasos_por_recibir
FROM sucursales s
LEFT JOIN (
    SELECT sucursal_id,
           SUM(CASE WHEN tipo_documento = 'E34' THEN -total ELSE total END) AS venta_hoy,
           COUNT(*) FILTER (WHERE tipo_documento <> 'E34') AS transacciones_hoy
      FROM ventas
     WHERE (creado_en AT TIME ZONE 'America/Santo_Domingo')::date = (now() AT TIME ZONE 'America/Santo_Domingo')::date
     GROUP BY sucursal_id) v ON v.sucursal_id = s.id
LEFT JOIN (
    SELECT a.sucursal_id, ROUND(SUM(e.cantidad * e.costo_promedio), 2) AS valor_inventario
      FROM existencias e JOIN almacenes a ON a.id = e.almacen_id GROUP BY a.sucursal_id) i ON i.sucursal_id = s.id
LEFT JOIN (
    SELECT sucursal_id, COUNT(*) AS bajo_minimo FROM rpt_bajo_minimo GROUP BY sucursal_id) b ON b.sucursal_id = s.id
LEFT JOIN (
    SELECT destino_sucursal_id AS sucursal_id, COUNT(*) AS por_recibir
      FROM transferencias WHERE estado = 'EN_TRANSITO' GROUP BY destino_sucursal_id) t ON t.sucursal_id = s.id
WHERE s.activo;
