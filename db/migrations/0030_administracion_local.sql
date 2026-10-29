-- =====================================================================
-- 0030 · Administración local en el servidor de la sucursal
--   La administración completa también corre en el servidor de cada tienda
--   (http://<servidor>:3000/admin/), aunque no haya internet. Lo que se cambie
--   ahí (productos, precios, ofertas, usuarios, compras, ajustes…) se anota
--   solo en la cola de subida (sync_outbox) y sube a la nube al volver la
--   conexión. Si el mismo dato se cambió en la nube después, gana el más reciente.
--
--   El disparador solo actúa en el servidor de sucursal (la conexión trae
--   factpos.modo = 'sucursal') y nunca mientras se aplican cambios que vienen
--   de la nube (factpos.sincronizando = 'si').
-- =====================================================================
CREATE OR REPLACE FUNCTION factpos_cambio_local() RETURNS trigger AS $$
DECLARE
    fila JSONB;
BEGIN
    IF current_setting('factpos.modo', true) IS DISTINCT FROM 'sucursal'
       OR current_setting('factpos.sincronizando', true) = 'si' THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'DELETE' THEN
        fila := to_jsonb(OLD);
        INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
        VALUES ('local:' || TG_TABLE_NAME, COALESCE((fila->>'id')::uuid, '00000000-0000-0000-0000-000000000000'), 'UPSERT',
                jsonb_build_object('borrar', jsonb_build_array(fila)));
    ELSE
        fila := to_jsonb(NEW);
        INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
        VALUES ('local:' || TG_TABLE_NAME, COALESCE((fila->>'id')::uuid, '00000000-0000-0000-0000-000000000000'), 'UPSERT',
                jsonb_build_object('filas', jsonb_build_array(fila)));
    END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    -- Catálogo, precios, ofertas, usuarios y configuración (altas y cambios)
    FOREACH t IN ARRAY ARRAY['categorias','proveedores','productos','presentaciones','lotes','codigos_barra','precios',
                             'producto_proveedores','producto_sucursal','producto_componentes','listas_precio','impuestos',
                             'ofertas','oferta_alcance','cupones','roles','usuarios','repartidores','almacenes',
                             'configuracion_marca','configuracion_sucursal',
                             'compras','compra_items','ajustes_inventario','ajuste_items','conteos_fisicos','conteo_items']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tg_cambio_local ON %I', t);
        EXECUTE format('CREATE TRIGGER tg_cambio_local AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION factpos_cambio_local()', t);
    END LOOP;
    -- Tablas de relación donde la administración también borra
    FOREACH t IN ARRAY ARRAY['codigos_barra','precios','producto_proveedores','producto_componentes','oferta_alcance']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tg_borrado_local ON %I', t);
        EXECUTE format('CREATE TRIGGER tg_borrado_local AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION factpos_cambio_local()', t);
    END LOOP;
END $$;

-- Movimientos de inventario de compras y ajustes hechos en la tienda (las ventas suben con su venta)
DROP TRIGGER IF EXISTS tg_cambio_local ON kardex_movimientos;
CREATE TRIGGER tg_cambio_local AFTER INSERT ON kardex_movimientos
    FOR EACH ROW WHEN (NEW.documento_tipo IN ('compra', 'ajuste'))
    EXECUTE FUNCTION factpos_cambio_local();
