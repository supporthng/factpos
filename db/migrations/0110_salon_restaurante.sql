-- =====================================================================
-- 0110 · Salón de restaurante: mesas, modificadores, tiempos de servicio y alertas de cocina
--   Aditivo y solo se usa si la empresa no es «TIENDA». Nada de esto se sincroniza (es operación de la sucursal).
-- =====================================================================

-- Mapa de mesas: una cuenta abierta con cuentas.mesa = mesas.nombre ocupa esa mesa
CREATE TABLE IF NOT EXISTS mesas (
    id           UUID PRIMARY KEY,
    sucursal_id  UUID NOT NULL REFERENCES sucursales(id),
    nombre       TEXT NOT NULL,
    zona         TEXT NOT NULL DEFAULT '',            -- «Terraza», «Salón», «Barra»…
    capacidad    SMALLINT NOT NULL DEFAULT 4 CHECK (capacidad BETWEEN 1 AND 60),
    orden        INT NOT NULL DEFAULT 0,
    activa       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (sucursal_id, nombre)
);

-- Modificadores: «término medio», «sin cebolla» (solo nota para la cocina) o «extra queso» (con cargo: es un producto real,
-- así el cobro, el ITBIS y el inventario funcionan igual que con cualquier otro producto).
CREATE TABLE IF NOT EXISTS modificadores (
    id               UUID PRIMARY KEY,
    empresa_id       UUID NOT NULL REFERENCES empresas(id),
    grupo            TEXT NOT NULL DEFAULT '',          -- «Término», «Quitar», «Extras»
    nombre           TEXT NOT NULL,
    presentacion_id  UUID REFERENCES presentaciones(id),  -- con cargo: el producto que se agrega
    categoria_id     UUID REFERENCES categorias(id),      -- null = aplica a todo; si no, solo a esa categoría
    orden            INT NOT NULL DEFAULT 0,
    activo           BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS ix_modificadores_empresa ON modificadores (empresa_id) WHERE activo;

-- Un extra con cargo es una línea hija del plato (sigue al plato: misma estación, se anula y se mueve con él)
ALTER TABLE cuenta_lineas ADD COLUMN IF NOT EXISTS padre_id UUID REFERENCES cuenta_lineas(id) ON DELETE CASCADE;
-- Tiempo de servicio: 1 = entradas/bebidas (sale ya), 2 = fuertes, 3 = postres
ALTER TABLE cuenta_lineas ADD COLUMN IF NOT EXISTS paso SMALLINT NOT NULL DEFAULT 1 CHECK (paso BETWEEN 1 AND 3);
ALTER TABLE cuentas ADD COLUMN IF NOT EXISTS paso_liberado SMALLINT NOT NULL DEFAULT 1 CHECK (paso_liberado BETWEEN 1 AND 3);
ALTER TABLE comandas ADD COLUMN IF NOT EXISTS paso SMALLINT NOT NULL DEFAULT 1;
-- Minutos antes de marcar una comanda como atrasada en la pantalla de la estación
ALTER TABLE estaciones ADD COLUMN IF NOT EXISTS alerta_minutos SMALLINT NOT NULL DEFAULT 10 CHECK (alerta_minutos BETWEEN 1 AND 120);

REVOKE ALL ON mesas, modificadores FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON mesas, modificadores FROM anon, authenticated';
    END IF;
END $$;
