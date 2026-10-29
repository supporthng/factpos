/**
 * Datos de demostración: una empresa, una sucursal con 2 cajas, productos
 * típicos de colmado/licorera, precios y existencia inicial.
 * Uso: npm run semilla -w @factpos/servidor
 */
import "./entorno.js";
import { uuidv7 } from "@factpos/compartido";
import { enTransaccion, pool } from "./db.js";
import { migrar } from "./migrar.js";
import { hashPin } from "./autorizacion.js";
import { hashClave } from "./sesion.js";

export const DEMO = {
  empresa: "01900000-0000-7000-8000-000000000001",
  sucursal: "01900000-0000-7000-8000-000000000002",
  almacen: "01900000-0000-7000-8000-000000000003",
  caja1: "01900000-0000-7000-8000-000000000011",
  caja2: "01900000-0000-7000-8000-000000000012",
  rolAdmin: "01900000-0000-7000-8000-000000000021",
  rolCajero: "01900000-0000-7000-8000-000000000022",
  admin: "01900000-0000-7000-8000-000000000031",
  cajera: "01900000-0000-7000-8000-000000000032",
  supervisor: "01900000-0000-7000-8000-000000000033",
  rolSupervisor: "01900000-0000-7000-8000-000000000023",
  itbis18: "01900000-0000-7000-8000-000000000041",
  exento: "01900000-0000-7000-8000-000000000042",
  precio1: "01900000-0000-7000-8000-000000000051",
  precio2: "01900000-0000-7000-8000-000000000052",
  precio3: "01900000-0000-7000-8000-000000000053",
  clienteFiado: "01900000-0000-7000-8000-000000000061",
  clienteMayorista: "01900000-0000-7000-8000-000000000062",
  sucursal2: "01900000-0000-7000-8000-000000000072",
  almacen2: "01900000-0000-7000-8000-000000000073",
  repartidor: "01900000-0000-7000-8000-000000000081",
};

const productos = [
  // sku, nombre, impuesto, pesable, costo, stock inicial, mínimo,
  // [presentación, factor, código, Precio 1 (detalle), Precio 2 (mayorista), Precio 3 (distribuidor)]
  ["RON001", "Ron añejo 700 ml", "itbis18", false, "520.00", 36, 12, [["Unidad", 1, "7460001000017", "750.00", "690.00", "650.00"], ["Caja x12", 12, "7460001000024", "8600.00", "8100.00", "7700.00"]]],
  ["CER001", "Cerveza 650 ml", "itbis18", false, "105.00", 240, 120, [["Unidad", 1, "7460002000016", "150.00", "135.00", "125.00"], ["Caja x12", 12, "7460002000023", "1700.00", "1560.00", "1450.00"]]],
  ["REF001", "Refresco cola 2 L", "itbis18", false, "68.00", 48, 24, [["Unidad", 1, "7460003000015", "95.00", "85.00", "80.00"]]],
  ["ARR001", "Arroz selecto 1 lb", "exento", false, "32.00", 200, 50, [["Unidad", 1, "7460004000014", "40.00", "37.00", "35.00"]]],
  ["HAB001", "Habichuelas rojas 15 oz", "exento", false, "48.00", 10, 24, [["Unidad", 1, "7460005000013", "65.00", null, null]]],
  ["SAL001", "Salami (por libra)", "itbis18", true, "120.00", 40, 10, [["Libra", 1, "00123", "175.00", "160.00", null]]],
  ["RON002", "Ron extra viejo 750 ml", "itbis18", false, "980.00", 18, 6, [["Unidad", 1, "7460001000031", "1450.00", "1350.00", "1290.00"]]],
  ["RON003", "Ron blanco 1 L", "itbis18", false, "390.00", 4, 10, [["Unidad", 1, "7460001000048", "560.00", "520.00", "495.00"]]],
  ["VIN001", "Vino tinto reserva 750 ml", "itbis18", false, "690.00", 27, 6, [["Unidad", 1, "7460006000011", "1050.00", "980.00", "940.00"]]],
  ["VIN002", "Vino blanco 750 ml", "itbis18", false, "520.00", 1, 6, [["Unidad", 1, "7460006000028", "795.00", "750.00", "720.00"]]],
  ["VIN003", "Vino espumoso brut 750 ml", "itbis18", false, "1150.00", 12, 4, [["Unidad", 1, "7460006000035", "1690.00", "1590.00", "1520.00"]]],
  ["WHI001", "Whisky 12 años 750 ml", "itbis18", false, "1650.00", 10, 4, [["Unidad", 1, "7460007000010", "2420.00", "2290.00", "2190.00"]]],
  ["CER002", "Cerveza light 355 ml lata", "itbis18", false, "62.00", 300, 120, [["Unidad", 1, "7460002000030", "90.00", "82.00", "78.00"], ["Six pack", 6, "7460002000047", "510.00", "470.00", "450.00"]]],
  ["CER003", "Cerveza importada 330 ml", "itbis18", false, "115.00", 6, 24, [["Unidad", 1, "7460002000054", "170.00", "155.00", "148.00"]]],
  ["REF002", "Refresco limón 2 L", "itbis18", false, "64.00", 30, 24, [["Unidad", 1, "7460003000022", "90.00", "82.00", "78.00"]]],
  ["AGU001", "Agua purificada 1 galón", "exento", false, "38.00", 60, 20, [["Unidad", 1, "7460008000019", "55.00", "50.00", "48.00"]]],
  ["JUG001", "Jugo de naranja 1 L", "itbis18", false, "85.00", 14, 10, [["Unidad", 1, "7460008000026", "125.00", "115.00", "110.00"]]],
] as const;

export async function semilla() {
  await migrar(() => {});
  await enTransaccion(async (c) => {
    const ya = await c.query("SELECT 1 FROM empresas WHERE id = $1", [DEMO.empresa]);
    if (ya.rowCount) return console.log("Los datos de demostración ya existen.");

    const q = (sql: string, p: unknown[]) => c.query(sql, p);
    await q("INSERT INTO empresas (id, rnc, razon_social, nombre_comercial) VALUES ($1,'131000001','Comercial Demo SRL','Supermercado Demo')", [DEMO.empresa]);
    await q("INSERT INTO sucursales (id, empresa_id, codigo, nombre) VALUES ($1,$2,'S01','Sucursal Principal')", [DEMO.sucursal, DEMO.empresa]);
    await q("INSERT INTO almacenes (id, sucursal_id, nombre, es_principal) VALUES ($1,$2,'Piso de venta',true)", [DEMO.almacen, DEMO.sucursal]);
    await q("INSERT INTO sucursales (id, empresa_id, codigo, nombre) VALUES ($1,$2,'S02','Sucursal Norte')", [DEMO.sucursal2, DEMO.empresa]);
    await q("INSERT INTO almacenes (id, sucursal_id, nombre, es_principal) VALUES ($1,$2,'Piso de venta',true)", [DEMO.almacen2, DEMO.sucursal2]);
    await q("INSERT INTO cajas (id, sucursal_id, numero, nombre, almacen_id) VALUES ($1,$3,1,'Caja 1',$4), ($2,$3,2,'Caja 2',$4)", [DEMO.caja1, DEMO.caja2, DEMO.sucursal, DEMO.almacen]);
    await q(`INSERT INTO roles (id, empresa_id, nombre, permisos) VALUES
             ($1,$3,'Administrador','{*}'), ($2,$3,'Cajero','{venta.crear,turno.abrir,cxc.abono}')`, [DEMO.rolAdmin, DEMO.rolCajero, DEMO.empresa]);
    await q(`INSERT INTO usuarios (id, empresa_id, rol_id, nombre, usuario, clave_hash) VALUES
             ($1,$3,$4,'Administrador','admin','pendiente'), ($2,$3,$5,'María Cajera','maria','pendiente')`,
      [DEMO.admin, DEMO.cajera, DEMO.empresa, DEMO.rolAdmin, DEMO.rolCajero]);
    // Supervisor que aprueba descuentos y anulaciones con su PIN
    await q("INSERT INTO roles (id, empresa_id, nombre, permisos) VALUES ($1,$2,'Supervisor','{venta.crear,venta.descuento,venta.anular,venta.corregir,cliente.precio,caja.retiro,caja.gasto,cxc.abono}')",
      [DEMO.rolSupervisor, DEMO.empresa]);
    await q("INSERT INTO usuarios (id, empresa_id, rol_id, nombre, usuario, clave_hash, pin_hash) VALUES ($1,$2,$3,'Carlos Supervisor','carlos','pendiente',$4)",
      [DEMO.supervisor, DEMO.empresa, DEMO.rolSupervisor, hashPin(DEMO.empresa, "4321")]);
    await q("UPDATE usuarios SET pin_hash = $2 WHERE id = $1", [DEMO.admin, hashPin(DEMO.empresa, "1234")]);
    await q("UPDATE usuarios SET pin_hash = $2 WHERE id = $1", [DEMO.cajera, hashPin(DEMO.empresa, "1111")]);
    // Contraseña de demostración de la administración: admin / admin1234
    await q("UPDATE usuarios SET clave_hash = $2 WHERE id = $1", [DEMO.admin, await hashClave("admin1234")]);
    await q(`INSERT INTO impuestos (id, empresa_id, nombre, tipo, tasa) VALUES
             ($1,$3,'ITBIS 18%','ITBIS',0.18), ($2,$3,'Exento','ITBIS',0)`, [DEMO.itbis18, DEMO.exento, DEMO.empresa]);
    await q(`INSERT INTO listas_precio (id, empresa_id, nombre, nivel, es_predeterminada) VALUES
             ($1,$4,'Precio 1 · Detalle',1,true), ($2,$4,'Precio 2 · Mayorista',2,false), ($3,$4,'Precio 3 · Distribuidor',3,false)`,
      [DEMO.precio1, DEMO.precio2, DEMO.precio3, DEMO.empresa]);
    await q(`INSERT INTO clientes (id, empresa_id, tipo_documento, documento, nombre, telefono, limite_credito, lista_precio_id) VALUES
             ($1,$3,'CEDULA','00100000001','Juan Pérez (fiado)','809-555-0101',5000,NULL),
             ($2,$3,'RNC','130000002','Colmado La Esquina (mayorista)','809-555-0202',50000,$4)`,
      [DEMO.clienteFiado, DEMO.clienteMayorista, DEMO.empresa, DEMO.precio2]);

    // Categorías del catálogo visual
    const cats: Record<string, string> = {};
    for (const [i, [nombre, color, icono]] of ([
      ["Rones", "#d97706", "botella"], ["Vinos", "#be123c", "vino"], ["Whisky", "#b45309", "botella"],
      ["Cervezas", "#ca8a04", "cerveza"], ["Refrescos", "#dc2626", "refresco"], ["Agua y jugos", "#0284c7", "lata"],
      ["Granos", "#65a30d", "saco"], ["Embutidos", "#e11d48", "embutido"], ["Servicios", "#64748b", "servicio"],
    ] as const).entries()) {
      cats[nombre] = uuidv7();
      await q("INSERT INTO categorias (id, empresa_id, nombre, color, icono, orden) VALUES ($1,$2,$3,$4,$5,$6)", [cats[nombre], DEMO.empresa, nombre, color, icono, i]);
    }
    const categoriaDe: Record<string, string> = {
      RON: "Rones", VIN: "Vinos", WHI: "Whisky", CER: "Cervezas", REF: "Refrescos", AGU: "Agua y jugos", JUG: "Agua y jugos",
      ARR: "Granos", HAB: "Granos", SAL: "Embutidos",
    };
    const ids: Record<string, string> = {};
    for (const [sku, nombre, imp, pesable, costo, stock, minimo, presentaciones] of productos) {
      const pid = uuidv7();
      await q(`INSERT INTO productos (id, empresa_id, sku, nombre, unidad_base, es_pesable, impuesto_id, costo_promedio, categoria_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [pid, DEMO.empresa, sku, nombre, pesable ? "LB" : "UND", pesable, DEMO[imp], costo, cats[categoriaDe[sku.slice(0, 3)]] ?? null]);
      for (const [i, [pnom, factor, codigo, ...niveles]] of presentaciones.entries()) {
        const prid = uuidv7();
        await q("INSERT INTO presentaciones (id, producto_id, nombre, factor, es_principal) VALUES ($1,$2,$3,$4,$5)", [prid, pid, pnom, factor, i === 0]);
        await q("INSERT INTO codigos_barra (codigo, empresa_id, presentacion_id) VALUES ($1,$2,$3)", [codigo, DEMO.empresa, prid]);
        const listas = [DEMO.precio1, DEMO.precio2, DEMO.precio3];
        for (const [n, precio] of niveles.entries()) {
          if (precio) await q("INSERT INTO precios (id, lista_precio_id, presentacion_id, precio) VALUES ($1,$2,$3,$4)", [uuidv7(), listas[n], prid, precio]);
        }
        ids[`${sku}:${pnom}`] = prid;
      }
      ids[sku] = pid;
      await q("INSERT INTO producto_sucursal (producto_id, sucursal_id, stock_minimo, stock_maximo) VALUES ($1,$2,$3,$4)", [pid, DEMO.sucursal, minimo, minimo * 3]);
      await q(`INSERT INTO kardex_movimientos (id, sucursal_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, documento_tipo, motivo, usuario_id)
               VALUES ($1,$2,$3,$4,'SALDO_INICIAL',$5,$6,'ajuste','Inventario inicial',$7)`,
        [uuidv7(), DEMO.sucursal, DEMO.almacen, pid, stock, costo, DEMO.admin]);
    }
    // Reglas de caja: habichuelas no se venden sin existencia
    await q(`UPDATE productos SET volumen_ml = v.ml, grado_alcohol = v.grado
               FROM (VALUES ('RON001',700,37.5),('RON002',750,38),('RON003',1000,37.5),('WHI001',750,40),('CER001',650,5),('VIN001',750,13.5)) v(sku, ml, grado)
              WHERE productos.sku = v.sku AND productos.empresa_id = $1`, [DEMO.empresa]);
    await q("UPDATE productos SET permite_sin_existencia = false WHERE empresa_id = $1 AND sku = 'HAB001'", [DEMO.empresa]);
    await q(`UPDATE productos SET nombre_corto = v.corto, marca = v.marca
               FROM (VALUES ('RON001','RON ANEJO 700ML','Brugal'),('CER001','CERVEZA 650ML','Presidente'),('WHI001','WHISKY 12A 750ML',NULL)) v(sku, corto, marca)
              WHERE productos.sku = v.sku AND productos.empresa_id = $1`, [DEMO.empresa]);

    // Proveedores
    const prov1 = uuidv7(), prov2 = uuidv7();
    await q("INSERT INTO proveedores (id, empresa_id, rnc, nombre, telefono) VALUES ($1,$3,'101000011','Distribuidora de Licores del Caribe','809-555-1000'), ($2,$3,'101000022','Cervecería Nacional (distribución)','809-555-2000')",
      [prov1, prov2, DEMO.empresa]);
    for (const [sku, prov, cod, costo] of [["RON001", prov1, "BR-700", "520.00"], ["RON002", prov1, "BR-EV750", "980.00"], ["WHI001", prov1, "WH12", "1650.00"], ["CER001", prov2, "P650", "105.00"], ["CER002", prov2, "PL355", "62.00"]] as const) {
      await q("INSERT INTO producto_proveedores (producto_id, proveedor_id, codigo_proveedor, ultimo_costo, principal) VALUES ($1,$2,$3,$4,true)", [ids[sku], prov, cod, costo]);
    }

    // Combo: ron + 2 refrescos (descuenta cada componente del inventario)
    const combo = uuidv7(), comboPres = uuidv7();
    await q(`INSERT INTO productos (id, empresa_id, sku, nombre, tipo, controla_stock, impuesto_id, categoria_id, permite_sin_existencia)
             VALUES ($1,$2,'CMB001','Combo ron + 2 refrescos','COMBO',false,$3,$4,false)`, [combo, DEMO.empresa, DEMO.itbis18, cats["Rones"]]);
    await q("INSERT INTO presentaciones (id, producto_id, nombre, factor, es_principal) VALUES ($1,$2,'Combo',1,true)", [comboPres, combo]);
    await q("INSERT INTO codigos_barra (codigo, empresa_id, presentacion_id) VALUES ('CMB001',$1,$2)", [DEMO.empresa, comboPres]);
    await q("INSERT INTO precios (id, lista_precio_id, presentacion_id, precio) VALUES ($1,$2,$3,890), ($4,$5,$3,840)", [uuidv7(), DEMO.precio1, comboPres, uuidv7(), DEMO.precio2]);
    await q("INSERT INTO producto_componentes (combo_id, componente_id, cantidad) VALUES ($1,$2,1), ($1,$3,2)", [combo, ids["RON001"], ids["REF001"]]);
    ids["CMB001"] = combo;

    // Precio variable: artículos varios (la cajera escribe el precio dentro del rango)
    const varios = uuidv7(), variosPres = uuidv7();
    await q(`INSERT INTO productos (id, empresa_id, sku, nombre, tipo, controla_stock, impuesto_id, precio_variable, precio_variable_min, precio_variable_max)
             VALUES ($1,$2,'VAR001','Artículo varios','SERVICIO',false,$3,true,5,5000)`, [varios, DEMO.empresa, DEMO.itbis18]);
    await q("INSERT INTO presentaciones (id, producto_id, nombre, factor, es_principal) VALUES ($1,$2,'Unidad',1,true)", [variosPres, varios]);
    await q("INSERT INTO codigos_barra (codigo, empresa_id, presentacion_id) VALUES ('999',$1,$2)", [DEMO.empresa, variosPres]);
    await q("INSERT INTO precios (id, lista_precio_id, presentacion_id, precio) VALUES ($1,$2,$3,100)", [uuidv7(), DEMO.precio1, variosPres]);

    // Ofertas de ejemplo
    const oferta = async (nombre: string, campos: Record<string, unknown>, alcance: { producto?: string; presentacion?: string }) => {
      const id = uuidv7();
      const cols = Object.keys(campos);
      await q(
        `INSERT INTO ofertas (id, empresa_id, nombre, inicia_en, termina_en, ${cols.join(", ")})
         VALUES ($1, $2, $3, now() - interval '1 day', now() + interval '1 year', ${cols.map((_, i) => `$${i + 4}`).join(", ")})`,
        [id, DEMO.empresa, nombre, ...Object.values(campos)],
      );
      await q("INSERT INTO oferta_alcance (id, oferta_id, producto_id, presentacion_id) VALUES ($1,$2,$3,$4)",
        [uuidv7(), id, alcance.producto ?? null, alcance.presentacion ?? null]);
    };
    await oferta("Cerveza: 6 o más a RD$135", { tipo: "POR_VOLUMEN", valor: 135, cantidad_minima: 6 }, { presentacion: ids["CER001:Unidad"] });
    await oferta("Refresco 2x1", { tipo: "LLEVA_PAGA", lleva: 2, paga: 1 }, { producto: ids["REF001"] });
    await oferta("Arroz a precio especial", { tipo: "PRECIO_ESPECIAL", valor: 38 }, { producto: ids["ARR001"] });
    await oferta("Happy hour: ron 15% (vie y sáb 6-10 pm)",
      { tipo: "PORCENTAJE", valor: 15, dias_semana: [5, 6], hora_desde: "18:00", hora_hasta: "22:00" }, { producto: ids["RON001"] });

    await q(`INSERT INTO cupones (id, empresa_id, codigo, descripcion, tipo, valor, compra_minima, tope_descuento, usos_maximos, usos_por_cliente)
             VALUES ($1,$2,'BIENVENIDO','10% en tu compra (mín. RD$500, tope RD$200)','PORCENTAJE',10,500,200,100,NULL)`,
      [uuidv7(), DEMO.empresa]);

    // Delivery: activo en la Sucursal Principal, desactivado en la Norte
    const envio = uuidv7(), envioPres = uuidv7();
    await q(`INSERT INTO productos (id, empresa_id, sku, nombre, tipo, controla_stock, impuesto_id, categoria_id) VALUES ($1,$2,'ENV001','Cargo de envío','SERVICIO',false,$3,$4)`,
      [envio, DEMO.empresa, DEMO.itbis18, cats["Servicios"]]);
    await q("INSERT INTO presentaciones (id, producto_id, nombre, factor, es_principal) VALUES ($1,$2,'Servicio',1,true)", [envioPres, envio]);
    await q("INSERT INTO precios (id, lista_precio_id, presentacion_id, precio) VALUES ($1,$2,$3,50)", [uuidv7(), DEMO.precio1, envioPres]);
    await q("INSERT INTO configuracion_sucursal (sucursal_id, modulos) VALUES ($1,$2), ($3,$4)", [
      DEMO.sucursal, JSON.stringify({ delivery: { activo: true, cargoEnvio: "50.00", productoEnvioId: envioPres, tiempoEstimadoMin: 30 } }),
      DEMO.sucursal2, JSON.stringify({ delivery: { activo: false } }),
    ]);
    await q("INSERT INTO repartidores (id, sucursal_id, nombre, telefono, vehiculo) VALUES ($1,$2,'Pedro (motor)','809-555-0303','Motor')",
      [DEMO.repartidor, DEMO.sucursal]);

    // Facturación electrónica (ambiente simulado) con rangos de prueba repartidos por sucursal
    await q(`INSERT INTO configuracion_fiscal (empresa_id, direccion_emisor, ambiente, transmisor)
             VALUES ($1, 'Av. Duarte 100, Santo Domingo', 'SIMULADO', 'SIMULADO')`, [DEMO.empresa]);
    for (const [tipo, hasta] of [["E31", 5000], ["E32", 100000], ["E34", 5000]] as const) {
      const aut = uuidv7();
      await q("INSERT INTO ecf_autorizaciones (id, empresa_id, tipo_ecf, desde, hasta, vence_en) VALUES ($1,$2,$3,1,$4,'2027-12-31')",
        [aut, DEMO.empresa, tipo, hasta]);
      const mitad = hasta / 2;
      await q(`INSERT INTO ecf_rangos (id, autorizacion_id, sucursal_id, tipo_ecf, desde, hasta, siguiente, vence_en) VALUES
               ($1,$3,$4,$5,1,$6,1,'2027-12-31'), ($2,$3,$7,$5,$8,$9,$8,'2027-12-31')`,
        [uuidv7(), uuidv7(), aut, DEMO.sucursal, tipo, mitad / 5, DEMO.sucursal2, mitad / 5 + 1, (mitad / 5) * 2]);
    }

    console.log("Datos de demostración creados.");
    console.log("  Administración: usuario admin, contraseña admin1234 (cámbiela)");
    console.log("  PIN de caja: María 1111 · Carlos (supervisor) 4321 · Administrador 1234");
    console.log(`  Sucursal principal: ${DEMO.sucursal}`);
    console.log(`  Caja 1: ${DEMO.caja1}`);
    console.log(`  Cajera: ${DEMO.cajera}`);
  });
}

semilla()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
