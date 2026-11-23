# Importador de datos a FactPOS

Herramienta aparte (no forma parte de la aplicación) para traer los datos de otro sistema. Solo necesita Node 20 o superior; no instala nada.

## App portable (un solo .exe)
**Importador-FactPOS.exe** es portable: no se instala ni necesita Node. Se descarga de GitHub (Releases › «importador»), se hace doble clic y se abre una ventana: se carga el archivo `.sql`, se escribe el servidor y el administrador de FactPOS y se pulsa «Procesar y cargar». Se recuerdan el servidor y el usuario (la contraseña no). Los informes quedan en `Importacion-FactPOS` dentro de la carpeta personal. Lo genera automáticamente `.github/workflows/importador-windows.yml` (`node construir.mjs`).

## Uso por línea de comandos

1. **Vista previa** (no cambia nada): `node importar.mjs --fuente wilpos --archivo respaldo.sql`
   Deja en `./salida-importacion` el informe, `problemas.csv` y los CSV de historial.
2. **Aplicar**: agregue `--servidor https://su-servidor --usuario admin --clave ... --aplicar`
   (`--rnc` si el usuario existe en varias empresas, `--codigo` si tiene verificación en dos pasos, `--sucursal "Nombre"`, `--sin-fotos`).

Se puede volver a correr: los productos llevan SKU `WIL-<número anterior>` y lo que ya existe se salta.

## Qué carga y qué no
- Carga: categorías, proveedores, clientes (con RNC o cédula válidos), productos (precio 1, costo, código de barras, ITBIS, foto, proveedor) y la existencia inicial como un ajuste en el kardex.
- Historial de ventas: se carga como **solo consulta y reportes** (Reportes › Historial anterior). No son facturas de FactPOS: sin e-NCF, no mueven existencias, caja ni cuentas por cobrar y no entran en los reportes fiscales. Se puede volver a correr sin duplicar. `--sin-historial` lo omite.
- **`--reemplazar`** (casilla «Reemplazar lo importado antes» en la ventana): para cargar un backup nuevo sobre uno anterior. Actualiza nombre, precio 1, costo, código de barras, categoría y mínimo de los productos ya importados; corrige la existencia con ajustes de entrada/salida en el kardex (el kardex y las facturas nunca se borran); actualiza clientes por documento; desactiva (y deja en cero) lo que ya no esté en el backup; y borra y vuelve a cargar el historial de ventas. Los proveedores solo se agregan, no se actualizan.
- **Existencia de WilPOS:** se toma de `productos.stock` (la que WilPOS actualiza con cada venta y compra). La tabla `stock_sucursal` de WilPOS queda desactualizada, así que solo se usa si el producto no trae stock propio. Si ya importó con una versión anterior y las existencias quedaron en 0 o distintas, vuelva a correr el importador con el mismo respaldo y **«Reemplazar lo importado antes»**: corrige la existencia con ajustes de entrada/salida en el kardex.
- No carga como documentos: compras ni cuentas por pagar. Quedan en CSV de consulta. Los saldos pendientes por pagar se cargan a mano.
- No trae claves de usuario (no sirven en FactPOS); `usuarios_del_sistema_anterior.csv` sirve de lista para crearlos.

## Mónica (respaldo .bak de SQL Server)
`--fuente monica --archivo monica.bak`. En la app basta elegir el archivo: si termina en `.bak` se usa Mónica. Se lee directo, **sin instalar SQL Server** (solo sirve el `.bak` sin comprimir; si está comprimido o cifrado el importador lo avisa).
- Carga: categorías, proveedores, clientes (RNC o cédula válidos, **límite y días de crédito**), productos y servicios (los artículos de inventario con su existencia, costo y precio 1 como ajuste en el kardex; el resto como servicios) y el historial de facturas (solo consulta, igual que arriba; con NCF y tipo de comprobante).
- **Cuentas por cobrar:** cada documento pendiente entra como saldo inicial del cliente **con su fecha original** (para que la antigüedad —al día, vencido a 30, 60…— salga bien) y los créditos sin aplicar, a favor del cliente. Se puede volver a correr sin duplicar. `--sin-saldos` los omite.
- Si el «balance» guardado en un cliente no coincide con la suma de sus documentos, se carga la suma de los documentos y el cliente queda listado en `problemas.csv`.
- Clientes con el mismo RNC o el mismo nombre (sin RNC) se unen en uno. Los clientes inactivos sin deuda y los productos inactivos sin existencia no se cargan.
- No carga: cuentas por pagar, compras, kardex ni devoluciones (compras y cuentas por pagar quedan en CSV de consulta).

## Agregar otro sistema
Cree `fuentes/<sistema>.mjs` que exporte `nombre` y `leer(ruta)` devolviendo `{ categorias, proveedores, clientes, productos, cuentasPagar, historialVentas, historialCompras, usuarios }` (y, si el sistema las tiene, `cuentasCobrar` y `creditosAFavor`: ver `fuentes/monica.mjs`) (ver `fuentes/wilpos.mjs`). El cargador no cambia.
