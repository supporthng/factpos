# Importador de datos a FactPOS

Herramienta aparte (no forma parte de la aplicación) para traer los datos de otro sistema. Solo necesita Node 20 o superior; no instala nada.

## App portable (recomendada)
Doble clic en **Importador FactPOS.bat**. Se abre una ventana en el navegador (solo en esta computadora) donde se elige el respaldo, se ve la vista previa y se carga a FactPOS con el usuario administrador. Si la PC no tiene Node, el .bat baja una copia portable a esta misma carpeta (no instala nada en Windows). Los informes quedan en `Importacion-FactPOS` dentro de la carpeta personal.

## Uso por línea de comandos

1. **Vista previa** (no cambia nada): `node importar.mjs --fuente wilpos --archivo respaldo.sql`
   Deja en `./salida-importacion` el informe, `problemas.csv` y los CSV de historial.
2. **Aplicar**: agregue `--servidor https://su-servidor --usuario admin --clave ... --aplicar`
   (`--rnc` si el usuario existe en varias empresas, `--codigo` si tiene verificación en dos pasos, `--sucursal "Nombre"`, `--sin-fotos`).

Se puede volver a correr: los productos llevan SKU `WIL-<número anterior>` y lo que ya existe se salta.

## Qué carga y qué no
- Carga: categorías, proveedores, clientes (con RNC o cédula válidos), productos (precio 1, costo, código de barras, ITBIS, foto, proveedor) y la existencia inicial como un ajuste en el kardex.
- No carga como documentos: ventas, compras ni cuentas por pagar. Quedan en CSV de consulta (no tienen e-NCF de FactPOS). Los saldos pendientes por pagar se cargan a mano.
- No trae claves de usuario (no sirven en FactPOS); `usuarios_del_sistema_anterior.csv` sirve de lista para crearlos.

## Agregar otro sistema
Cree `fuentes/<sistema>.mjs` que exporte `nombre` y `leer(ruta)` devolviendo `{ categorias, proveedores, clientes, productos, cuentasPagar, historialVentas, historialCompras, usuarios }` (ver `fuentes/wilpos.mjs`). El cargador no cambia.
