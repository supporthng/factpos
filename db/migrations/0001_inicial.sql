-- =====================================================================
-- FactPOS · Esquema inicial de base de datos (PostgreSQL 15+)
-- Mismo esquema para el servidor local de cada sucursal y para la nube
-- (Supabase).
--
-- Reglas de diseño:
--  1. IDs UUID v7 generados por la aplicación (nunca autoincrementales),
--     para que cada sucursal cree registros sin chocar con las demás.
--  2. Todo lo que nace en la tienda (ventas, caja, kardex) es inmutable:
--     no se edita ni se borra; se corrige con un movimiento inverso.
--  3. El stock no se guarda como número editable: se calcula desde
--     kardex_movimientos.
--  4. Dinero en NUMERIC(14,2), cantidades en NUMERIC(14,3). Nunca float.
--  5. Toda tabla sincronizable lleva empresa_id, sucursal_id (si aplica),
--     version y actualizado_en.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Organización
-- ---------------------------------------------------------------------
CREATE TABLE empresas (
    id              UUID PRIMARY KEY,
    rnc             VARCHAR(11) NOT NULL UNIQUE,
    razon_social    TEXT NOT NULL,
    nombre_comercial TEXT,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sucursales (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    codigo          VARCHAR(10) NOT NULL,
    nombre          TEXT NOT NULL,
    direccion       TEXT,
    telefono        VARCHAR(20),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, codigo)
);

CREATE TABLE almacenes (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    nombre          TEXT NOT NULL,              -- "Piso de venta", "Depósito"
    es_principal    BOOLEAN NOT NULL DEFAULT FALSE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cajas (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    numero          SMALLINT NOT NULL,
    nombre          TEXT NOT NULL,
    almacen_id      UUID NOT NULL REFERENCES almacenes(id), -- de dónde descuenta
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sucursal_id, numero)
);

-- ---------------------------------------------------------------------
-- Usuarios y permisos
-- ---------------------------------------------------------------------
CREATE TABLE roles (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    nombre          TEXT NOT NULL,              -- Cajero, Supervisor, Administrador
    permisos        TEXT[] NOT NULL DEFAULT '{}', -- 'venta.anular', 'caja.retiro', ...
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    rol_id          UUID NOT NULL REFERENCES roles(id),
    nombre          TEXT NOT NULL,
    usuario         VARCHAR(50) NOT NULL,
    clave_hash      TEXT NOT NULL,
    pin_hash        TEXT,                       -- PIN de supervisor
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, usuario)
);

CREATE TABLE usuario_sucursales (
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    PRIMARY KEY (usuario_id, sucursal_id)
);

-- ---------------------------------------------------------------------
-- Catálogo (maestro en la nube, baja a las sucursales)
-- ---------------------------------------------------------------------
CREATE TABLE impuestos (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    nombre          TEXT NOT NULL,              -- "ITBIS 18%", "ITBIS 16%", "Exento"
    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('ITBIS','ISC','OTRO')),
    tasa            NUMERIC(7,4) NOT NULL,      -- 0.1800
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categorias (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    padre_id        UUID REFERENCES categorias(id),
    nombre          TEXT NOT NULL,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE productos (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    categoria_id    UUID REFERENCES categorias(id),
    sku             VARCHAR(30) NOT NULL,
    nombre          TEXT NOT NULL,
    unidad_base     VARCHAR(10) NOT NULL DEFAULT 'UND', -- UND, LB, KG, LT
    es_pesable      BOOLEAN NOT NULL DEFAULT FALSE,
    controla_stock  BOOLEAN NOT NULL DEFAULT TRUE,
    impuesto_id     UUID NOT NULL REFERENCES impuestos(id),  -- ITBIS
    isc_id          UUID REFERENCES impuestos(id),           -- licores, cigarrillos
    precio_incluye_impuesto BOOLEAN NOT NULL DEFAULT TRUE,
    costo_promedio  NUMERIC(14,4) NOT NULL DEFAULT 0, -- referencia; el kardex manda
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (empresa_id, sku)
);

-- Presentaciones: unidad, caja de 24, fardo, etc.
CREATE TABLE presentaciones (
    id              UUID PRIMARY KEY,
    producto_id     UUID NOT NULL REFERENCES productos(id),
    nombre          TEXT NOT NULL,              -- "Unidad", "Caja x24"
    factor          NUMERIC(14,3) NOT NULL CHECK (factor > 0), -- unidades base
    es_principal    BOOLEAN NOT NULL DEFAULT FALSE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Varios códigos de barra por presentación
CREATE TABLE codigos_barra (
    codigo          VARCHAR(30) NOT NULL,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    presentacion_id UUID NOT NULL REFERENCES presentaciones(id),
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (empresa_id, codigo)
);

CREATE TABLE listas_precio (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    nombre          TEXT NOT NULL,              -- "Detalle", "Por mayor"
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- sucursal_id NULL = precio para todas; con valor = precio propio de esa sucursal
CREATE TABLE precios (
    id              UUID PRIMARY KEY,
    lista_precio_id UUID NOT NULL REFERENCES listas_precio(id),
    presentacion_id UUID NOT NULL REFERENCES presentaciones(id),
    sucursal_id     UUID REFERENCES sucursales(id),
    precio          NUMERIC(14,2) NOT NULL CHECK (precio >= 0),
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_precios ON precios
    (lista_precio_id, presentacion_id, COALESCE(sucursal_id, '00000000-0000-0000-0000-000000000000'));

-- ---------------------------------------------------------------------
-- Terceros
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    tipo_documento  VARCHAR(10) NOT NULL DEFAULT 'NINGUNO' CHECK (tipo_documento IN ('RNC','CEDULA','PASAPORTE','NINGUNO')),
    documento       VARCHAR(20),
    nombre          TEXT NOT NULL,
    telefono        VARCHAR(20),
    direccion       TEXT,
    lista_precio_id UUID REFERENCES listas_precio(id),
    limite_credito  NUMERIC(14,2) NOT NULL DEFAULT 0, -- fiado
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE proveedores (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    rnc             VARCHAR(11),
    nombre          TEXT NOT NULL,
    telefono        VARCHAR(20),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Turnos y caja (nacen en la sucursal, solo suben)
-- ---------------------------------------------------------------------
CREATE TABLE turnos (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    caja_id         UUID NOT NULL REFERENCES cajas(id),
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    abierto_en      TIMESTAMPTZ NOT NULL,
    fondo_inicial   NUMERIC(14,2) NOT NULL,
    cerrado_en      TIMESTAMPTZ,
    cerrado_por     UUID REFERENCES usuarios(id),
    -- cierre ciego: el cajero declara sin ver lo esperado
    declarado       JSONB,                      -- {"EFECTIVO": 12500.00, "TARJETA": 8300.00}
    esperado        JSONB,                      -- calculado al cerrar
    diferencia      NUMERIC(14,2),
    estado          VARCHAR(10) NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','CERRADO')),
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Solo un turno abierto por caja
CREATE UNIQUE INDEX ux_turno_abierto ON turnos (caja_id) WHERE estado = 'ABIERTO';

CREATE TABLE movimientos_caja (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    turno_id        UUID NOT NULL REFERENCES turnos(id),
    tipo            VARCHAR(15) NOT NULL CHECK (tipo IN ('RETIRO','DEPOSITO','GASTO','ABONO_CLIENTE','APERTURA_GAVETA')),
    monto           NUMERIC(14,2) NOT NULL,
    concepto        TEXT,
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    autorizado_por  UUID REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Ventas (inmutables; se anulan con nota de crédito)
-- ---------------------------------------------------------------------
CREATE TABLE ventas (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    caja_id         UUID NOT NULL REFERENCES cajas(id),
    turno_id        UUID NOT NULL REFERENCES turnos(id),
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    cliente_id      UUID REFERENCES clientes(id),
    numero_interno  BIGINT NOT NULL,            -- consecutivo por caja, para el ticket
    tipo_documento  VARCHAR(5) NOT NULL CHECK (tipo_documento IN ('E31','E32','E34')),
    venta_origen_id UUID REFERENCES ventas(id), -- para notas de crédito (E34)
    condicion       VARCHAR(10) NOT NULL DEFAULT 'CONTADO' CHECK (condicion IN ('CONTADO','CREDITO')),
    subtotal        NUMERIC(14,2) NOT NULL,
    descuento       NUMERIC(14,2) NOT NULL DEFAULT 0,
    itbis           NUMERIC(14,2) NOT NULL DEFAULT 0,
    isc             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total           NUMERIC(14,2) NOT NULL,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (caja_id, numero_interno)
);

CREATE TABLE venta_items (
    id              UUID PRIMARY KEY,
    venta_id        UUID NOT NULL REFERENCES ventas(id),
    linea           SMALLINT NOT NULL,
    presentacion_id UUID NOT NULL REFERENCES presentaciones(id),
    descripcion     TEXT NOT NULL,              -- copia del nombre al momento de vender
    cantidad        NUMERIC(14,3) NOT NULL,
    factor          NUMERIC(14,3) NOT NULL,     -- copia, por si cambia la presentación
    precio_unitario NUMERIC(14,2) NOT NULL,
    descuento       NUMERIC(14,2) NOT NULL DEFAULT 0,
    tasa_itbis      NUMERIC(7,4) NOT NULL,
    itbis           NUMERIC(14,2) NOT NULL,
    isc             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total           NUMERIC(14,2) NOT NULL,
    costo_unitario  NUMERIC(14,4) NOT NULL,     -- para utilidad por venta
    UNIQUE (venta_id, linea)
);

CREATE TABLE venta_pagos (
    id              UUID PRIMARY KEY,
    venta_id        UUID NOT NULL REFERENCES ventas(id),
    forma_pago      VARCHAR(15) NOT NULL CHECK (forma_pago IN ('EFECTIVO','TARJETA','TRANSFERENCIA','CREDITO','OTRO')),
    monto           NUMERIC(14,2) NOT NULL,
    referencia      TEXT,                       -- # aprobación tarjeta / transferencia
    recibido        NUMERIC(14,2),              -- efectivo entregado
    cambio          NUMERIC(14,2)
);

-- ---------------------------------------------------------------------
-- Facturación electrónica (e-CF vía PSE)
-- ---------------------------------------------------------------------
CREATE TABLE ecf_documentos (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    venta_id        UUID REFERENCES ventas(id),
    compra_id       UUID,                       -- E41/E43 (FK abajo)
    tipo_ecf        VARCHAR(5) NOT NULL,        -- E31, E32, E34, E41, E43...
    encf            VARCHAR(13),                -- número e-CF asignado
    estado          VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado IN ('PENDIENTE','ENVIADO','ACEPTADO','ACEPTADO_COND','RECHAZADO','CONTINGENCIA')),
    codigo_seguridad VARCHAR(10),
    url_qr          TEXT,
    respuesta_pse   JSONB,
    intentos        SMALLINT NOT NULL DEFAULT 0,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ecf_pendientes ON ecf_documentos (estado) WHERE estado IN ('PENDIENTE','CONTINGENCIA');

-- ---------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------
CREATE TABLE compras (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    almacen_id      UUID NOT NULL REFERENCES almacenes(id),
    proveedor_id    UUID NOT NULL REFERENCES proveedores(id),
    ncf_proveedor   VARCHAR(13),                -- para el 606
    fecha_factura   DATE NOT NULL,
    condicion       VARCHAR(10) NOT NULL DEFAULT 'CONTADO' CHECK (condicion IN ('CONTADO','CREDITO')),
    vence_en        DATE,
    subtotal        NUMERIC(14,2) NOT NULL,
    itbis           NUMERIC(14,2) NOT NULL DEFAULT 0,
    isc             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total           NUMERIC(14,2) NOT NULL,
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ecf_documentos ADD CONSTRAINT fk_ecf_compra FOREIGN KEY (compra_id) REFERENCES compras(id);

CREATE TABLE compra_items (
    id              UUID PRIMARY KEY,
    compra_id       UUID NOT NULL REFERENCES compras(id),
    presentacion_id UUID NOT NULL REFERENCES presentaciones(id),
    cantidad        NUMERIC(14,3) NOT NULL,
    factor          NUMERIC(14,3) NOT NULL,
    costo_unitario  NUMERIC(14,4) NOT NULL,     -- por presentación, sin impuestos
    itbis           NUMERIC(14,2) NOT NULL DEFAULT 0,
    total           NUMERIC(14,2) NOT NULL
);

-- ---------------------------------------------------------------------
-- Parámetros de inventario por sucursal
-- ---------------------------------------------------------------------
CREATE TABLE producto_sucursal (
    producto_id     UUID NOT NULL REFERENCES productos(id),
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    stock_minimo    NUMERIC(14,3) NOT NULL DEFAULT 0,
    stock_maximo    NUMERIC(14,3),
    punto_reorden   NUMERIC(14,3),
    ubicacion       VARCHAR(30),                -- pasillo / góndola
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (producto_id, sucursal_id)
);

-- Lotes y vencimientos (lácteos, embutidos, medicinas, etc.)
CREATE TABLE lotes (
    id              UUID PRIMARY KEY,
    producto_id     UUID NOT NULL REFERENCES productos(id),
    numero_lote     VARCHAR(40) NOT NULL,
    vence_en        DATE,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (producto_id, numero_lote)
);

-- ---------------------------------------------------------------------
-- Kardex: única fuente de verdad del inventario (solo inserciones)
-- Cada fila guarda el saldo y el costo promedio resultantes, así el
-- reporte de kardex sale directo y se puede auditar fila por fila.
-- ---------------------------------------------------------------------
CREATE TABLE kardex_movimientos (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    almacen_id      UUID NOT NULL REFERENCES almacenes(id),
    producto_id     UUID NOT NULL REFERENCES productos(id),
    lote_id         UUID REFERENCES lotes(id),
    tipo            VARCHAR(25) NOT NULL CHECK (tipo IN (
                        'SALDO_INICIAL','VENTA','DEVOLUCION_VENTA','COMPRA','DEVOLUCION_COMPRA',
                        'AJUSTE_ENTRADA','AJUSTE_SALIDA','MERMA','VENCIMIENTO','CONSUMO_INTERNO',
                        'TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA','CONTEO_FISICO')),
    cantidad        NUMERIC(14,3) NOT NULL,     -- en unidad base; + entra, - sale
    costo_unitario  NUMERIC(14,4) NOT NULL,     -- entradas: costo de la compra; salidas: promedio vigente
    -- Calculados por el trigger al insertar:
    saldo_cantidad  NUMERIC(14,3),
    saldo_costo_promedio NUMERIC(14,4),
    saldo_valor     NUMERIC(16,2),
    documento_tipo  VARCHAR(20),                -- 'venta', 'compra', 'transferencia', 'ajuste', 'conteo'
    documento_id    UUID,
    motivo          TEXT,
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (cantidad <> 0)
);
CREATE INDEX ix_kardex_producto ON kardex_movimientos (almacen_id, producto_id, creado_en);
CREATE INDEX ix_kardex_fecha    ON kardex_movimientos (sucursal_id, creado_en);
CREATE INDEX ix_kardex_doc      ON kardex_movimientos (documento_tipo, documento_id);

-- Existencia actual: se mantiene sola desde el kardex (lectura instantánea)
CREATE TABLE existencias (
    almacen_id      UUID NOT NULL REFERENCES almacenes(id),
    producto_id     UUID NOT NULL REFERENCES productos(id),
    cantidad        NUMERIC(14,3) NOT NULL DEFAULT 0,
    costo_promedio  NUMERIC(14,4) NOT NULL DEFAULT 0,
    ultimo_costo    NUMERIC(14,4),
    ultima_entrada  TIMESTAMPTZ,
    ultima_salida   TIMESTAMPTZ,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (almacen_id, producto_id)
);

-- Costo promedio ponderado: solo las entradas con costo lo recalculan;
-- las salidas salen al promedio vigente.
CREATE FUNCTION fn_kardex_aplicar() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    e existencias%ROWTYPE;
    nueva_cant NUMERIC(14,3);
    nuevo_prom NUMERIC(14,4);
BEGIN
    INSERT INTO existencias (almacen_id, producto_id)
    VALUES (NEW.almacen_id, NEW.producto_id)
    ON CONFLICT DO NOTHING;

    SELECT * INTO e FROM existencias
    WHERE almacen_id = NEW.almacen_id AND producto_id = NEW.producto_id
    FOR UPDATE;                                  -- serializa movimientos del mismo producto

    nueva_cant := e.cantidad + NEW.cantidad;

    IF NEW.cantidad > 0 AND NEW.tipo IN ('SALDO_INICIAL','COMPRA','AJUSTE_ENTRADA','TRANSFERENCIA_ENTRADA','CONTEO_FISICO','DEVOLUCION_VENTA') THEN
        IF NEW.tipo IN ('DEVOLUCION_VENTA','CONTEO_FISICO','AJUSTE_ENTRADA') AND e.costo_promedio > 0 THEN
            NEW.costo_unitario := e.costo_promedio;  -- reingreso al costo vigente
        END IF;
        IF nueva_cant > 0 AND e.cantidad > 0 THEN
            nuevo_prom := ((e.cantidad * e.costo_promedio) + (NEW.cantidad * NEW.costo_unitario)) / nueva_cant;
        ELSE
            nuevo_prom := NEW.costo_unitario;        -- sin existencia previa (o negativa)
        END IF;
    ELSE
        nuevo_prom := e.costo_promedio;
        IF NEW.cantidad < 0 THEN
            NEW.costo_unitario := e.costo_promedio;
        END IF;
    END IF;

    NEW.saldo_cantidad       := nueva_cant;
    NEW.saldo_costo_promedio := nuevo_prom;
    NEW.saldo_valor          := ROUND(nueva_cant * nuevo_prom, 2);

    UPDATE existencias SET
        cantidad       = nueva_cant,
        costo_promedio = nuevo_prom,
        ultimo_costo   = CASE WHEN NEW.tipo = 'COMPRA' THEN NEW.costo_unitario ELSE ultimo_costo END,
        ultima_entrada = CASE WHEN NEW.cantidad > 0 THEN NEW.creado_en ELSE ultima_entrada END,
        ultima_salida  = CASE WHEN NEW.cantidad < 0 THEN NEW.creado_en ELSE ultima_salida END,
        actualizado_en = now()
    WHERE almacen_id = NEW.almacen_id AND producto_id = NEW.producto_id;

    RETURN NEW;
END $$;

CREATE TRIGGER tr_kardex_aplicar BEFORE INSERT ON kardex_movimientos
    FOR EACH ROW EXECUTE FUNCTION fn_kardex_aplicar();

-- ---------------------------------------------------------------------
-- Transferencias entre almacenes / sucursales
-- ---------------------------------------------------------------------
CREATE TABLE transferencias (
    id              UUID PRIMARY KEY,
    origen_almacen_id  UUID NOT NULL REFERENCES almacenes(id),
    destino_almacen_id UUID NOT NULL REFERENCES almacenes(id),
    estado          VARCHAR(12) NOT NULL DEFAULT 'EN_TRANSITO' CHECK (estado IN ('EN_TRANSITO','RECIBIDA','CON_DIFERENCIA')),
    enviado_por     UUID NOT NULL REFERENCES usuarios(id),
    enviado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    recibido_por    UUID REFERENCES usuarios(id),
    recibido_en     TIMESTAMPTZ,
    notas           TEXT,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (origen_almacen_id <> destino_almacen_id)
);

CREATE TABLE transferencia_items (
    id              UUID PRIMARY KEY,
    transferencia_id UUID NOT NULL REFERENCES transferencias(id),
    producto_id     UUID NOT NULL REFERENCES productos(id),
    lote_id         UUID REFERENCES lotes(id),
    cantidad_enviada  NUMERIC(14,3) NOT NULL CHECK (cantidad_enviada > 0),
    cantidad_recibida NUMERIC(14,3)
);

-- ---------------------------------------------------------------------
-- Conteo físico (total o cíclico por categoría/pasillo)
-- ---------------------------------------------------------------------
CREATE TABLE conteos_fisicos (
    id              UUID PRIMARY KEY,
    almacen_id      UUID NOT NULL REFERENCES almacenes(id),
    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('TOTAL','CICLICO')),
    alcance         TEXT,                       -- "Categoría: Licores", "Pasillo 3"
    estado          VARCHAR(12) NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','EN_REVISION','APLICADO','ANULADO')),
    creado_por      UUID NOT NULL REFERENCES usuarios(id),
    aplicado_por    UUID REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    aplicado_en     TIMESTAMPTZ,
    version         BIGINT NOT NULL DEFAULT 1,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conteo_items (
    id              UUID PRIMARY KEY,
    conteo_id       UUID NOT NULL REFERENCES conteos_fisicos(id),
    producto_id     UUID NOT NULL REFERENCES productos(id),
    cantidad_sistema NUMERIC(14,3) NOT NULL,    -- foto del sistema al iniciar
    cantidad_contada NUMERIC(14,3),
    costo_promedio  NUMERIC(14,4) NOT NULL,
    contado_por     UUID REFERENCES usuarios(id),
    contado_en      TIMESTAMPTZ,
    UNIQUE (conteo_id, producto_id)
);

-- Bloquear UPDATE y DELETE en tablas inmutables
CREATE FUNCTION fn_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La tabla % es inmutable: registre un movimiento inverso', TG_TABLE_NAME;
END $$;

CREATE TRIGGER tr_kardex_inmutable   BEFORE UPDATE OR DELETE ON kardex_movimientos FOR EACH ROW EXECUTE FUNCTION fn_inmutable();
CREATE TRIGGER tr_ventas_inmutable   BEFORE UPDATE OR DELETE ON ventas             FOR EACH ROW EXECUTE FUNCTION fn_inmutable();
CREATE TRIGGER tr_items_inmutable    BEFORE UPDATE OR DELETE ON venta_items        FOR EACH ROW EXECUTE FUNCTION fn_inmutable();
CREATE TRIGGER tr_pagos_inmutable    BEFORE UPDATE OR DELETE ON venta_pagos        FOR EACH ROW EXECUTE FUNCTION fn_inmutable();
CREATE TRIGGER tr_movcaja_inmutable  BEFORE UPDATE OR DELETE ON movimientos_caja   FOR EACH ROW EXECUTE FUNCTION fn_inmutable();

-- ---------------------------------------------------------------------
-- Crédito a clientes (fiado)
-- ---------------------------------------------------------------------
CREATE TABLE cxc_movimientos (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID NOT NULL REFERENCES sucursales(id),
    cliente_id      UUID NOT NULL REFERENCES clientes(id),
    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('CARGO','ABONO','AJUSTE')),
    monto           NUMERIC(14,2) NOT NULL,     -- + cargo, - abono
    venta_id        UUID REFERENCES ventas(id),
    turno_id        UUID REFERENCES turnos(id),
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER tr_cxc_inmutable BEFORE UPDATE OR DELETE ON cxc_movimientos FOR EACH ROW EXECUTE FUNCTION fn_inmutable();

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
    id              UUID PRIMARY KEY,
    sucursal_id     UUID REFERENCES sucursales(id),
    usuario_id      UUID REFERENCES usuarios(id),
    autorizado_por  UUID REFERENCES usuarios(id),
    accion          VARCHAR(40) NOT NULL,       -- 'venta.anular', 'precio.cambiar', 'gaveta.abrir'
    entidad         VARCHAR(40),
    entidad_id      UUID,
    detalle         JSONB,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Sincronización local ⇄ nube
-- ---------------------------------------------------------------------
-- Subida: cada transacción local agrega aquí lo que debe enviarse
CREATE TABLE sync_outbox (
    id              BIGSERIAL PRIMARY KEY,      -- solo local, nunca se sincroniza
    tabla           VARCHAR(40) NOT NULL,
    registro_id     UUID NOT NULL,
    operacion       VARCHAR(10) NOT NULL CHECK (operacion IN ('INSERT','UPSERT')),
    payload         JSONB NOT NULL,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviado_en      TIMESTAMPTZ,
    intentos        SMALLINT NOT NULL DEFAULT 0,
    ultimo_error    TEXT
);
CREATE INDEX ix_outbox_pendiente ON sync_outbox (id) WHERE enviado_en IS NULL;

-- Bajada: última versión recibida de cada tabla maestra
CREATE TABLE sync_cursor (
    tabla           VARCHAR(40) PRIMARY KEY,
    ultima_version  BIGINT NOT NULL DEFAULT 0,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- REPORTES
-- Las notas de crédito (E34) se guardan con montos positivos y restan
-- en los reportes mediante el signo.
-- En la nube, las vistas pesadas se pueden convertir en vistas
-- materializadas que se refrescan cada noche.
-- =====================================================================

-- Ventas por día, sucursal y caja
CREATE VIEW rpt_ventas_diarias AS
SELECT v.sucursal_id,
       v.caja_id,
       (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       COUNT(*) FILTER (WHERE v.tipo_documento <> 'E34')       AS transacciones,
       SUM(CASE WHEN v.tipo_documento = 'E34' THEN -v.total ELSE v.total END)       AS venta_total,
       SUM(CASE WHEN v.tipo_documento = 'E34' THEN -v.itbis ELSE v.itbis END)       AS itbis,
       SUM(CASE WHEN v.tipo_documento = 'E34' THEN -v.descuento ELSE v.descuento END) AS descuentos,
       SUM(CASE WHEN v.tipo_documento = 'E34' THEN v.total ELSE 0 END)              AS devoluciones,
       ROUND(AVG(v.total) FILTER (WHERE v.tipo_documento <> 'E34'), 2)              AS ticket_promedio
FROM ventas v
GROUP BY 1, 2, 3;

-- Ventas y utilidad por producto y día
CREATE VIEW rpt_utilidad_producto AS
SELECT v.sucursal_id,
       (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       p.id AS producto_id, p.sku, p.nombre, p.categoria_id,
       SUM(s.signo * i.cantidad * i.factor)                       AS unidades,
       SUM(s.signo * (i.total - i.itbis - i.isc))                 AS venta_neta,
       SUM(s.signo * i.cantidad * i.factor * i.costo_unitario)    AS costo,
       SUM(s.signo * (i.total - i.itbis - i.isc - i.cantidad * i.factor * i.costo_unitario)) AS utilidad,
       CASE WHEN SUM(s.signo * (i.total - i.itbis - i.isc)) = 0 THEN NULL
            ELSE ROUND(100 * SUM(s.signo * (i.total - i.itbis - i.isc - i.cantidad * i.factor * i.costo_unitario))
                       / SUM(s.signo * (i.total - i.itbis - i.isc)), 2) END AS margen_pct
FROM ventas v
JOIN LATERAL (SELECT CASE WHEN v.tipo_documento = 'E34' THEN -1 ELSE 1 END AS signo) s ON TRUE
JOIN venta_items i   ON i.venta_id = v.id
JOIN presentaciones pr ON pr.id = i.presentacion_id
JOIN productos p     ON p.id = pr.producto_id
GROUP BY 1, 2, 3, 4, 5, 6;

-- Ventas por forma de pago (para cuadre y conciliación bancaria)
CREATE VIEW rpt_formas_pago AS
SELECT v.sucursal_id, v.turno_id,
       (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       pg.forma_pago,
       SUM(CASE WHEN v.tipo_documento = 'E34' THEN -pg.monto ELSE pg.monto END) AS monto,
       COUNT(*) AS operaciones
FROM ventas v
JOIN venta_pagos pg ON pg.venta_id = v.id
GROUP BY 1, 2, 3, 4;

-- Cuadre de turno: efectivo esperado en gaveta
CREATE VIEW rpt_cuadre_turno AS
SELECT t.id AS turno_id, t.sucursal_id, t.caja_id, t.usuario_id, t.abierto_en, t.cerrado_en,
       t.fondo_inicial,
       COALESCE((SELECT SUM(CASE WHEN v.tipo_documento = 'E34' THEN -pg.monto ELSE pg.monto END)
                 FROM ventas v JOIN venta_pagos pg ON pg.venta_id = v.id
                 WHERE v.turno_id = t.id AND pg.forma_pago = 'EFECTIVO'), 0)       AS ventas_efectivo,
       COALESCE((SELECT SUM(m.monto) FROM movimientos_caja m
                 WHERE m.turno_id = t.id AND m.tipo IN ('DEPOSITO','ABONO_CLIENTE')), 0) AS entradas,
       COALESCE((SELECT SUM(m.monto) FROM movimientos_caja m
                 WHERE m.turno_id = t.id AND m.tipo IN ('RETIRO','GASTO')), 0)          AS salidas
FROM turnos t;

-- Valorización del inventario actual
CREATE VIEW rpt_valorizacion_inventario AS
SELECT a.sucursal_id, e.almacen_id, p.id AS producto_id, p.sku, p.nombre, p.categoria_id,
       e.cantidad, e.costo_promedio,
       ROUND(e.cantidad * e.costo_promedio, 2) AS valor,
       e.ultima_entrada, e.ultima_salida
FROM existencias e
JOIN almacenes a ON a.id = e.almacen_id
JOIN productos p ON p.id = e.producto_id;

-- Productos bajo el mínimo (sugerido de compra)
CREATE VIEW rpt_bajo_minimo AS
SELECT a.sucursal_id, e.almacen_id, p.id AS producto_id, p.sku, p.nombre,
       e.cantidad, ps.stock_minimo, ps.stock_maximo,
       GREATEST(COALESCE(ps.stock_maximo, ps.stock_minimo * 2) - e.cantidad, 0) AS sugerido_comprar
FROM existencias e
JOIN almacenes a ON a.id = e.almacen_id AND a.es_principal
JOIN productos p ON p.id = e.producto_id AND p.activo
JOIN producto_sucursal ps ON ps.producto_id = p.id AND ps.sucursal_id = a.sucursal_id
WHERE e.cantidad <= ps.stock_minimo;

-- Existencia por lote y próximos a vencer (60 días)
CREATE VIEW rpt_proximos_vencer AS
SELECT k.sucursal_id, k.almacen_id, p.sku, p.nombre, l.numero_lote, l.vence_en,
       SUM(k.cantidad) AS cantidad,
       l.vence_en - CURRENT_DATE AS dias_para_vencer
FROM kardex_movimientos k
JOIN lotes l     ON l.id = k.lote_id
JOIN productos p ON p.id = k.producto_id
WHERE l.vence_en IS NOT NULL
GROUP BY k.sucursal_id, k.almacen_id, p.sku, p.nombre, l.numero_lote, l.vence_en
HAVING SUM(k.cantidad) > 0 AND l.vence_en <= CURRENT_DATE + 60;

-- Rotación: días de inventario según ventas de los últimos 30 días
CREATE VIEW rpt_rotacion_30d AS
SELECT e.almacen_id, p.id AS producto_id, p.sku, p.nombre, e.cantidad,
       COALESCE(-SUM(k.cantidad) FILTER (WHERE k.tipo = 'VENTA'), 0)            AS vendido_30d,
       CASE WHEN COALESCE(-SUM(k.cantidad) FILTER (WHERE k.tipo = 'VENTA'), 0) = 0 THEN NULL
            ELSE ROUND(e.cantidad / (-SUM(k.cantidad) FILTER (WHERE k.tipo = 'VENTA') / 30.0), 1)
       END AS dias_inventario
FROM existencias e
JOIN productos p ON p.id = e.producto_id
LEFT JOIN kardex_movimientos k
       ON k.almacen_id = e.almacen_id AND k.producto_id = e.producto_id
      AND k.creado_en >= now() - INTERVAL '30 days'
GROUP BY e.almacen_id, p.id, p.sku, p.nombre, e.cantidad;

-- Mermas, vencimientos y ajustes (control de pérdidas)
CREATE VIEW rpt_perdidas AS
SELECT k.sucursal_id,
       (k.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS fecha,
       k.tipo, p.sku, p.nombre, k.usuario_id, k.motivo,
       k.cantidad, ROUND(k.cantidad * k.costo_unitario, 2) AS valor
FROM kardex_movimientos k
JOIN productos p ON p.id = k.producto_id
WHERE k.tipo IN ('MERMA','VENCIMIENTO','AJUSTE_SALIDA','AJUSTE_ENTRADA','CONTEO_FISICO','CONSUMO_INTERNO');

-- Saldo de clientes (fiado)
CREATE VIEW rpt_saldo_clientes AS
SELECT c.id AS cliente_id, c.nombre, c.limite_credito,
       COALESCE(SUM(m.monto), 0) AS saldo,
       MAX(m.creado_en) FILTER (WHERE m.tipo = 'ABONO') AS ultimo_abono
FROM clientes c
LEFT JOIN cxc_movimientos m ON m.cliente_id = c.id
GROUP BY c.id, c.nombre, c.limite_credito;
