-- =====================================================================
-- 0018 · Sincronización sucursal ⇄ nube, almacén central y pedidos
--
-- Cómo viajan los datos (un servidor por sucursal, la central en la nube):
--   * BAJAN de la central a cada sucursal: productos, precios, ofertas,
--     clientes, usuarios, secuencias e-CF... (tablas con "version") y los
--     movimientos de inventario que la central registra para esa sucursal
--     (traspasos, compras, ajustes, conteos).
--   * SUBEN de la sucursal a la central (sync_outbox): ventas con su
--     kardex y pagos, turnos y cierres, clientes creados en caja, estado de
--     los e-CF, delivery y auditoría.
--   * El kardex es la unidad de inventario: cada movimiento tiene un id
--     único y se aplica una sola vez en cada lado. Así la existencia de
--     cada sucursal coincide en la central y en el servidor local.
-- =====================================================================

-- Al aplicar datos sincronizados se conserva la fecha de cambio original
-- (sirve para "gana el último cambio" en clientes).
CREATE OR REPLACE FUNCTION fn_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.version := nextval('sync_version');
    IF current_setting('factpos.sincronizando', true) IS DISTINCT FROM 'si' OR NEW.actualizado_en IS NULL THEN
        NEW.actualizado_en := now();
    END IF;
    RETURN NEW;
END $$;

-- Versión en el kardex: la sucursal descarga los movimientos nuevos de su inventario
-- (contador propio: una venta no debe cambiar la versión del catálogo de las cajas)
CREATE SEQUENCE sync_kardex AS BIGINT;
ALTER TABLE kardex_movimientos ADD COLUMN version BIGINT NOT NULL DEFAULT nextval('sync_kardex');
CREATE INDEX ix_kardex_sync ON kardex_movimientos (sucursal_id, version);

-- Tablas maestras que aún no tenían versión
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['producto_componentes','producto_proveedores','ecf_autorizaciones'] LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'version') THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN version BIGINT NOT NULL DEFAULT 1', t);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'actualizado_en') THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()', t);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = format('tr_%s_version', t)) THEN
            EXECUTE format('CREATE TRIGGER tr_%s_version BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_version()', t, t);
        END IF;
        EXECUTE format('UPDATE %I SET version = nextval(''sync_version'')', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS ix_%s_version ON %I (version)', t, t);
    END LOOP;
END $$;

-- Los componentes de un combo se reemplazan completos: al borrar uno, el combo
-- cambia de versión para que la sucursal descargue la lista nueva.
CREATE FUNCTION fn_combo_tocar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE productos SET actualizado_en = now() WHERE id = OLD.combo_id;
    RETURN OLD;
END $$;
CREATE TRIGGER tr_componentes_borrar AFTER DELETE ON producto_componentes
    FOR EACH ROW EXECUTE FUNCTION fn_combo_tocar();

-- ---------------------------------------------------------------------
-- Almacén central: una "sucursal" sin cajas que surte a las tiendas
-- ---------------------------------------------------------------------
ALTER TABLE sucursales ADD COLUMN tipo VARCHAR(10) NOT NULL DEFAULT 'TIENDA' CHECK (tipo IN ('TIENDA','ALMACEN'));

-- Datos del conduce (traslado interno, no fiscal)
ALTER TABLE transferencias ADD COLUMN chofer TEXT;
ALTER TABLE transferencias ADD COLUMN vehiculo TEXT;
ALTER TABLE transferencias ADD COLUMN pedido_id UUID;
ALTER TABLE transferencias ADD COLUMN notas_recepcion TEXT;
ALTER TABLE transferencia_items ADD COLUMN cantidad_pedida NUMERIC(14,3);

-- Pedido de mercancía de una tienda al almacén
CREATE TABLE pedidos_sucursal (
    id                 UUID PRIMARY KEY,
    empresa_id         UUID NOT NULL REFERENCES empresas(id),
    numero             BIGINT NOT NULL,
    sucursal_id        UUID NOT NULL REFERENCES sucursales(id),   -- quien pide
    surte_sucursal_id  UUID NOT NULL REFERENCES sucursales(id),   -- quien despacha (el almacén)
    estado             VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','DESPACHADO','ANULADO')),
    notas              TEXT,
    creado_por         UUID REFERENCES usuarios(id),
    creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
    transferencia_id   UUID REFERENCES transferencias(id) DEFERRABLE INITIALLY IMMEDIATE,
    despachado_en      TIMESTAMPTZ,
    version            BIGINT NOT NULL DEFAULT 1,
    actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, numero),
    CHECK (sucursal_id <> surte_sucursal_id)
);
CREATE TRIGGER tr_pedidos_sucursal_version BEFORE INSERT OR UPDATE ON pedidos_sucursal
    FOR EACH ROW EXECUTE FUNCTION fn_version();
CREATE INDEX ix_pedidos_sucursal_version ON pedidos_sucursal (version);

CREATE TABLE pedido_sucursal_items (
    id                 UUID PRIMARY KEY,
    pedido_id          UUID NOT NULL REFERENCES pedidos_sucursal(id) ON DELETE CASCADE,
    producto_id        UUID NOT NULL REFERENCES productos(id),
    existencia         NUMERIC(14,3),        -- lo que tenía la tienda al pedir
    sugerida           NUMERIC(14,3),        -- lo que propuso el sistema
    cantidad           NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
    UNIQUE (pedido_id, producto_id)
);

-- Pedido y traspaso se apuntan entre sí: la revisión se puede dejar para el final
-- de la transacción (así la sincronización los aplica en cualquier orden).
ALTER TABLE transferencias ADD CONSTRAINT fk_transferencias_pedido
    FOREIGN KEY (pedido_id) REFERENCES pedidos_sucursal(id) DEFERRABLE INITIALLY IMMEDIATE;

-- Resumen de traspasos por mes, origen y destino (al costo)
CREATE VIEW rpt_traspasos_mes AS
SELECT so.empresa_id,
       date_trunc('month', t.enviado_en AT TIME ZONE 'America/Santo_Domingo')::date AS mes,
       t.origen_sucursal_id, so.nombre AS origen, t.destino_sucursal_id, sd.nombre AS destino,
       COUNT(DISTINCT t.id) AS traspasos,
       ROUND(SUM(ti.cantidad_enviada * ti.costo_unitario), 2) AS valor_enviado,
       ROUND(SUM(COALESCE(ti.cantidad_recibida, 0) * ti.costo_unitario) FILTER (WHERE t.estado <> 'EN_TRANSITO'), 2) AS valor_recibido,
       ROUND(SUM((ti.cantidad_enviada - COALESCE(ti.cantidad_recibida, 0)) * ti.costo_unitario)
             FILTER (WHERE t.estado <> 'EN_TRANSITO'), 2) AS valor_diferencia,
       ROUND(SUM(ti.cantidad_enviada * ti.costo_unitario) FILTER (WHERE t.estado = 'EN_TRANSITO'), 2) AS valor_en_transito
FROM transferencias t
JOIN transferencia_items ti ON ti.transferencia_id = t.id
JOIN sucursales so ON so.id = t.origen_sucursal_id
JOIN sucursales sd ON sd.id = t.destino_sucursal_id
GROUP BY so.empresa_id, mes, t.origen_sucursal_id, so.nombre, t.destino_sucursal_id, sd.nombre;

-- ---------------------------------------------------------------------
-- Estado de la sincronización
-- ---------------------------------------------------------------------
-- En la central: cuándo se comunicó cada sucursal por última vez
CREATE TABLE sync_sucursales (
    sucursal_id      UUID PRIMARY KEY REFERENCES sucursales(id),
    ultima_subida    TIMESTAMPTZ,
    ultima_bajada    TIMESTAMPTZ,
    version_bajada   BIGINT,
    pendientes       INTEGER,           -- lo que la sucursal dice tener sin subir
    errores          INTEGER,
    ultimo_error     TEXT,
    equipo           TEXT,
    app_version      TEXT
);

-- En la sucursal: resultado del último intento (una sola fila)
CREATE TABLE sync_estado (
    id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    central_url      TEXT,
    ultima_subida    TIMESTAMPTZ,
    ultima_bajada    TIMESTAMPTZ,
    ultimo_intento   TIMESTAMPTZ,
    ultimo_error     TEXT
);

REVOKE ALL ON pedidos_sucursal, pedido_sucursal_items, sync_sucursales, sync_estado FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON pedidos_sucursal, pedido_sucursal_items, sync_sucursales, sync_estado FROM anon, authenticated';
    END IF;
END $$;
