-- =====================================================================
-- 0003 · Tres niveles de precio, ofertas, cupones y traspasos al costo
-- =====================================================================

-- ---------------------------------------------------------------------
-- Niveles de precio: Precio 1 (detalle), Precio 2, Precio 3 (por mayor).
-- El nivel de cada cliente se define en clientes.lista_precio_id; sin
-- cliente se usa la lista predeterminada (Precio 1).
-- Si un producto no tiene precio en el nivel del cliente, se usa el del
-- nivel predeterminado.
-- ---------------------------------------------------------------------
ALTER TABLE listas_precio ADD COLUMN nivel SMALLINT CHECK (nivel BETWEEN 1 AND 3);
CREATE UNIQUE INDEX ux_listas_nivel ON listas_precio (empresa_id, nivel) WHERE nivel IS NOT NULL;

-- ---------------------------------------------------------------------
-- Ofertas automáticas (se aplican solas en la caja)
-- ---------------------------------------------------------------------
CREATE TABLE ofertas (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    nombre          TEXT NOT NULL,              -- "2x1 en cerveza", "Happy hour ron"
    tipo            VARCHAR(15) NOT NULL CHECK (tipo IN (
                        'PORCENTAJE',          -- valor = % de descuento
                        'PRECIO_ESPECIAL',     -- valor = nuevo precio unitario
                        'LLEVA_PAGA',          -- lleva N, paga M (2x1, 3x2)
                        'POR_VOLUMEN')),       -- desde cantidad_minima, precio unitario = valor
    valor           NUMERIC(14,4),
    lleva           SMALLINT,
    paga            SMALLINT,
    cantidad_minima NUMERIC(14,3) NOT NULL DEFAULT 1,
    inicia_en       TIMESTAMPTZ NOT NULL,
    termina_en      TIMESTAMPTZ NOT NULL,
    dias_semana     SMALLINT[],                 -- 0=domingo … 6=sábado; NULL = todos
    hora_desde      TIME,                       -- happy hour; NULL = todo el día
    hora_hasta      TIME,
    sucursal_id     UUID REFERENCES sucursales(id),          -- NULL = todas
    lista_precio_id UUID REFERENCES listas_precio(id),       -- NULL = todos los niveles
    prioridad       SMALLINT NOT NULL DEFAULT 0,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (termina_en > inicia_en),
    CHECK (tipo <> 'LLEVA_PAGA' OR (lleva > paga AND paga >= 1)),
    CHECK (tipo = 'LLEVA_PAGA' OR valor IS NOT NULL),
    CHECK (tipo <> 'PORCENTAJE' OR (valor > 0 AND valor < 100))
);

-- A qué aplica: un producto, una presentación específica o una categoría completa
CREATE TABLE oferta_alcance (
    id              UUID PRIMARY KEY,
    oferta_id       UUID NOT NULL REFERENCES ofertas(id),
    producto_id     UUID REFERENCES productos(id),
    presentacion_id UUID REFERENCES presentaciones(id),
    categoria_id    UUID REFERENCES categorias(id),
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(producto_id, presentacion_id, categoria_id) = 1)
);
CREATE INDEX ix_oferta_alcance_prod ON oferta_alcance (producto_id);
CREATE INDEX ix_oferta_alcance_pres ON oferta_alcance (presentacion_id);
CREATE INDEX ix_oferta_alcance_cat  ON oferta_alcance (categoria_id);

-- ---------------------------------------------------------------------
-- Cupones (el cliente presenta un código)
-- ---------------------------------------------------------------------
CREATE TABLE cupones (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    codigo          VARCHAR(30) NOT NULL,
    descripcion     TEXT,
    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('PORCENTAJE','MONTO')),
    valor           NUMERIC(14,2) NOT NULL CHECK (valor > 0),
    compra_minima   NUMERIC(14,2) NOT NULL DEFAULT 0,
    tope_descuento  NUMERIC(14,2),              -- máximo a descontar (para porcentajes)
    usos_maximos    INTEGER,                    -- NULL = ilimitado
    usos_por_cliente INTEGER,
    cliente_id      UUID REFERENCES clientes(id), -- cupón personal
    acumulable_con_ofertas BOOLEAN NOT NULL DEFAULT FALSE,
    inicia_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    vence_en        TIMESTAMPTZ,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (tipo <> 'PORCENTAJE' OR valor < 100)
);
CREATE UNIQUE INDEX ux_cupon_codigo ON cupones (empresa_id, upper(codigo));

CREATE TABLE cupon_usos (
    id              UUID PRIMARY KEY,
    cupon_id        UUID NOT NULL REFERENCES cupones(id),
    venta_id        UUID NOT NULL REFERENCES ventas(id),
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    cliente_id      UUID REFERENCES clientes(id),
    descuento       NUMERIC(14,2) NOT NULL,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_cupon_usos ON cupon_usos (cupon_id);
CREATE TRIGGER tr_cupon_usos_inmutable BEFORE UPDATE OR DELETE ON cupon_usos FOR EACH ROW EXECUTE FUNCTION fn_inmutable();

-- Trazabilidad del descuento en cada línea (fiscal y reportes)
ALTER TABLE venta_items ADD COLUMN oferta_id UUID REFERENCES ofertas(id);
ALTER TABLE venta_items ADD COLUMN descuento_oferta NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE venta_items ADD COLUMN descuento_cupon  NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE venta_items ADD COLUMN lista_precio_id  UUID REFERENCES listas_precio(id);

-- ---------------------------------------------------------------------
-- Traspasos entre sucursales: salen y entran al costo promedio de origen
-- ---------------------------------------------------------------------
ALTER TABLE transferencia_items ADD COLUMN costo_unitario NUMERIC(14,4);
ALTER TABLE transferencias ALTER COLUMN estado TYPE VARCHAR(15);
ALTER TABLE transferencias ADD COLUMN numero BIGINT;
ALTER TABLE transferencias ADD COLUMN origen_sucursal_id  UUID REFERENCES sucursales(id);
ALTER TABLE transferencias ADD COLUMN destino_sucursal_id UUID REFERENCES sucursales(id);

-- ---------------------------------------------------------------------
-- Reportes nuevos
-- ---------------------------------------------------------------------
-- Rendimiento de ofertas: cuánto se vendió y cuánto se regaló
CREATE VIEW rpt_ofertas AS
SELECT o.id AS oferta_id, o.nombre, v.sucursal_id,
       (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       COUNT(DISTINCT v.id)    AS ventas,
       SUM(i.cantidad)         AS unidades,
       SUM(i.total)            AS venta_total,
       SUM(i.descuento_oferta) AS descuento_otorgado
FROM venta_items i
JOIN ventas v  ON v.id = i.venta_id AND v.tipo_documento <> 'E34'
JOIN ofertas o ON o.id = i.oferta_id
GROUP BY 1, 2, 3, 4;

CREATE VIEW rpt_cupones AS
SELECT c.codigo, c.descripcion, COUNT(u.id) AS usos, c.usos_maximos,
       COALESCE(SUM(u.descuento), 0) AS descuento_otorgado
FROM cupones c LEFT JOIN cupon_usos u ON u.cupon_id = c.id
GROUP BY c.id, c.codigo, c.descripcion, c.usos_maximos;

-- Ventas por nivel de precio (detalle vs. mayor)
CREATE VIEW rpt_ventas_nivel_precio AS
SELECT v.sucursal_id,
       (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       lp.nivel, lp.nombre AS lista,
       SUM(i.total) AS venta_total,
       SUM(i.total - i.itbis - i.cantidad * i.factor * i.costo_unitario) AS utilidad
FROM venta_items i
JOIN ventas v ON v.id = i.venta_id AND v.tipo_documento <> 'E34'
LEFT JOIN listas_precio lp ON lp.id = i.lista_precio_id
GROUP BY 1, 2, 3, 4;

-- Traspasos en tránsito o con diferencias
CREATE VIEW rpt_traspasos AS
SELECT t.id, t.numero, so.nombre AS origen, sd.nombre AS destino, t.estado,
       t.enviado_en, t.recibido_en,
       ROUND(SUM(ti.cantidad_enviada * ti.costo_unitario), 2) AS valor_enviado,
       ROUND(SUM(COALESCE(ti.cantidad_recibida, 0) * ti.costo_unitario), 2) AS valor_recibido,
       ROUND(SUM((ti.cantidad_enviada - COALESCE(ti.cantidad_recibida, 0)) * ti.costo_unitario)
           FILTER (WHERE t.estado <> 'EN_TRANSITO'), 2) AS valor_diferencia
FROM transferencias t
JOIN transferencia_items ti ON ti.transferencia_id = t.id
LEFT JOIN sucursales so ON so.id = t.origen_sucursal_id
LEFT JOIN sucursales sd ON sd.id = t.destino_sucursal_id
GROUP BY t.id, so.nombre, sd.nombre;
