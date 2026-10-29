-- =====================================================================
-- 0005 · Ajustes de inventario como documento
--
-- Los ajustes se hacen desde la app de administración (oficina central).
-- Cada ajuste es un documento con número, motivo y responsable, y cada
-- línea trae el id del movimiento de kardex que genera. Ese id viaja a
-- la sucursal, que aplica exactamente el mismo movimiento: si llega dos
-- veces, la clave primaria impide duplicarlo.
-- =====================================================================
CREATE TABLE ajustes_inventario (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    almacen_id      UUID NOT NULL REFERENCES almacenes(id),
    numero          BIGINT NOT NULL,
    origen          VARCHAR(10) NOT NULL DEFAULT 'MANUAL' CHECK (origen IN ('MANUAL','CONTEO')),
    conteo_id       UUID REFERENCES conteos_fisicos(id),
    motivo          TEXT NOT NULL,
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    autorizado_por  UUID REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    aplicado_en_sucursal TIMESTAMPTZ,           -- lo marca la sincronización al aplicarlo en la tienda
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sucursal_id, numero)
);

CREATE TABLE ajuste_items (
    id              UUID PRIMARY KEY,
    ajuste_id       UUID NOT NULL REFERENCES ajustes_inventario(id),
    producto_id     UUID NOT NULL REFERENCES productos(id),
    lote_id         UUID REFERENCES lotes(id),
    tipo            VARCHAR(25) NOT NULL CHECK (tipo IN
                        ('AJUSTE_ENTRADA','AJUSTE_SALIDA','MERMA','VENCIMIENTO','CONSUMO_INTERNO','CONTEO_FISICO')),
    cantidad        NUMERIC(14,3) NOT NULL CHECK (cantidad <> 0),   -- + entra, - sale
    costo_unitario  NUMERIC(14,4),
    kardex_id       UUID NOT NULL UNIQUE,       -- id del movimiento de kardex que genera
    nota            TEXT
);

CREATE TRIGGER tr_ajustes_inventario_version BEFORE INSERT OR UPDATE ON ajustes_inventario
    FOR EACH ROW EXECUTE FUNCTION fn_version();
CREATE INDEX ix_ajustes_inventario_version ON ajustes_inventario (version);
CREATE TRIGGER tr_ajuste_items_inmutable BEFORE UPDATE OR DELETE ON ajuste_items
    FOR EACH ROW EXECUTE FUNCTION fn_inmutable();

-- Resumen de ajustes para reportes
CREATE VIEW rpt_ajustes AS
SELECT a.sucursal_id, s.nombre AS sucursal, a.numero, a.origen, a.motivo,
       (a.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       u.nombre AS usuario, p.sku, p.nombre AS producto, i.tipo, i.cantidad,
       k.costo_unitario, ROUND(i.cantidad * k.costo_unitario, 2) AS valor
FROM ajustes_inventario a
JOIN sucursales s  ON s.id = a.sucursal_id
JOIN usuarios u    ON u.id = a.usuario_id
JOIN ajuste_items i ON i.ajuste_id = a.id
JOIN productos p   ON p.id = i.producto_id
LEFT JOIN kardex_movimientos k ON k.id = i.kardex_id;
