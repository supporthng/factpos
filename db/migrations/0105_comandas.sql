-- =====================================================================
-- 0105 · Comandas por estación (barra, cocina) para bares, restaurantes y discotecas
--   Una estación es un lugar donde se prepara algo («Barra principal», «Barra VIP», «Cocina»). Cada categoría de productos
--   se asigna a una estación; al «Enviar» una cuenta, lo nuevo se separa por estación y cada una recibe su comanda
--   (impresa y/o en la pantalla de barra). Es operación de la sucursal: no se sincroniza. Apagado mientras la empresa sea 'TIENDA'.
-- =====================================================================
CREATE TABLE IF NOT EXISTS estaciones (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    nombre          TEXT NOT NULL,
    tipo            VARCHAR(8) NOT NULL DEFAULT 'BARRA' CHECK (tipo IN ('BARRA','COCINA')),
    imprime_en_caja BOOLEAN NOT NULL DEFAULT FALSE,   -- la comanda sale por la impresora de la caja que envía (si no, la imprime la pantalla de la estación)
    activa          BOOLEAN NOT NULL DEFAULT TRUE,
    orden           SMALLINT NOT NULL DEFAULT 0,
    UNIQUE (sucursal_id, nombre)
);

CREATE TABLE IF NOT EXISTS estacion_categorias (
    estacion_id   UUID NOT NULL REFERENCES estaciones(id) ON DELETE CASCADE,
    categoria_id  UUID NOT NULL REFERENCES categorias(id),
    PRIMARY KEY (estacion_id, categoria_id)
);

CREATE TABLE IF NOT EXISTS comandas (
    id           UUID PRIMARY KEY,
    sucursal_id  UUID NOT NULL REFERENCES sucursales(id),
    estacion_id  UUID NOT NULL REFERENCES estaciones(id),
    cuenta_id    UUID NOT NULL REFERENCES cuentas(id),
    numero       BIGINT NOT NULL,                      -- consecutivo por sucursal
    estado       VARCHAR(8) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','LISTA')),
    creada_por   UUID REFERENCES usuarios(id),
    creada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    impresa_en   TIMESTAMPTZ,
    lista_en     TIMESTAMPTZ,
    UNIQUE (sucursal_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_comandas_cola ON comandas (estacion_id, estado, creada_en);

CREATE TABLE IF NOT EXISTS comanda_lineas (
    id               UUID PRIMARY KEY,
    comanda_id       UUID NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
    cuenta_linea_id  UUID NOT NULL REFERENCES cuenta_lineas(id),
    descripcion      TEXT NOT NULL,
    cantidad         NUMERIC(14,3) NOT NULL,
    persona          TEXT,                              -- «Persona 2» o null = toda la mesa
    nota             TEXT
);
CREATE INDEX IF NOT EXISTS ix_comanda_lineas ON comanda_lineas (comanda_id);

REVOKE ALL ON estaciones, estacion_categorias, comandas, comanda_lineas FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON estaciones, estacion_categorias, comandas, comanda_lineas FROM anon, authenticated';
    END IF;
END $$;
