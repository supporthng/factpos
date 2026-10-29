# FactPOS

Sistema de gestión de negocio para **supermercados, colmados, licoreras y tiendas de abarrotes** en República Dominicana, con **terminales punto de venta** para facturar y **facturación electrónica (e-CF)** de la DGII.

## Cómo está organizado

```
                         ☁️  NUBE  (MODO=central)
   ┌──────────────────────────────────────────────────────────┐
   │  FactPOS Administración  (/admin, web instalable)          │
   │  Sucursales · Inventario · Precios · Ofertas · Traspasos  │
   │  Facturación electrónica · Delivery · Reportes · Marca    │
   └──────────────────────────▲───────────────────────────────┘
                              │ sincronización
   ──────────────── SUCURSAL ─┼───────────────────────────────────
   ┌──────────────────────────┴───────────────────────────────┐
   │  Servidor local (MODO=sucursal) · PostgreSQL              │
   │  Firma los e-CF · Cola de envío a la DGII · Funciona      │
   │  sin internet                                             │
   └──────▲──────────────▲──────────────▲─────────────────────┘
          │ red local     │              │
     Terminal 1      Terminal 2     Verificador de precios
     (/terminal)     (/terminal)    (/verificador)
```

| Pieza | Qué hace |
|---|---|
| `apps/servidor` | API (Fastify + PostgreSQL). Corre en cada sucursal y en la nube; `MODO` decide qué expone. Sirve también las apps web. |
| `apps/terminal` | **Solo facturar**: escaneo, cobro, pausas, descuentos y anulaciones con aprobación, delivery, ticket con QR. |
| `apps/admin` | **Gestión del negocio**, sin facturación. Web instalable en computadora o celular (PWA). |
| `packages/compartido` | Motor único de precios, ofertas, cupones, impuestos y colores: la terminal y el servidor calculan exactamente igual. |
| `db/migrations` | Esquema de base de datos, versionado. Se aplica solo al arrancar el servidor. |

## Reglas del negocio implementadas

**Terminal (punto de venta)**

- **Pantalla híbrida**: la lista de la venta siempre a la vista (número, descripción, cantidad editable, precio, descuento, total), el catálogo con fotos se muestra u oculta con F1, el total grande como el visor de una caja, formas de pago a un toque (efectivo, tarjeta, transferencia, mixto) y barra de funciones con su tecla. Tema claro u oscuro por terminal.
- **Cambiar precio** (Alt+P, solo hacia abajo) y **descuento a un artículo o a toda la factura** (F7), ambos con PIN del supervisor y motivo; **nota de la venta** (Alt+N) que sale en la factura; **cotización** impresa sin comprobante ni inventario (Alt+Q); **precio y existencia** (Alt+E); **abrir gaveta** con PIN del supervisor, auditada (Alt+G); **bloquear** la caja (la venta queda en pausa).
- Escaneo instantáneo con el catálogo en memoria (0 viajes al servidor); el servidor solo interviene al cobrar: ~40 ms una venta de 40 líneas, incluida la firma del e-CF.
- Reglas del producto revisadas en la caja: **precio variable** dentro de un rango y **bloqueo de venta sin existencia** cuando el producto lo pide. El aviso del precio ignora el Enter del lector para que no se confirme solo.
- Cantidades (`3*código`), etiquetas de balanza, búsqueda por nombre.
- **Ventas en pausa** (F3 pausar · F5 retomar), sobreviven a reiniciar la terminal.
- **Precios por cliente**: Precio 1, 2 o 3 según la ficha del cliente. El cajero no elige el nivel.
- **Descuentos con aprobación** (F7): motivo + PIN del supervisor; quedan auditados.
- **Anular o corregir factura** (F9): motivo obligatorio + PIN. Se emite nota de crédito E34, vuelve el inventario y se registra la devolución. "Corregir" además recarga los productos para facturar de nuevo.
- **Reimprimir la última factura** (marcada como COPIA): desde el panel de la derecha o con F9 → Enter.
- **Caja registradora**: solo factura, abre y cierra turno, y cuadra (F10):
  - *Cuadre del turno* (reporte X): facturas, vendido, anuladas, descuentos, formas de pago y efectivo que debe haber.
  - *Cerrar turno* (reporte Z): conteo **ciego** de billetes y monedas, más vouchers y transferencias; lo esperado se ve después de cerrar, con faltante o sobrante e impresión para firmar.
  - *Cuadre de caja del día*: todos los turnos de la caja, vendido y diferencias.
- **Clientes en caja** (F4): con la opción **Factura con comprobante fiscal** (encendida por defecto) el RNC o la cédula es obligatorio, se revisa el dígito verificador de la DGII y el cobro sale como crédito fiscal (E31); sin comprobante, el documento es opcional. Al escribir el RNC o la cédula, **el nombre se completa solo con el padrón de la DGII** y avisa si el contribuyente está suspendido o dado de baja. Siempre entran con **Precio 1**; pasar a Precio 2 o 3 requiere el PIN de un supervisor (permiso `cliente.precio`) y queda auditado.
- **Tarjeta**: sin el número de aprobación del voucher no se factura; se imprime en la factura. Botón "Todo con tarjeta" y pago mixto.
- **Oferta agotada**: aviso grande en el centro de **todas** las cajas (cada caja revisa cada 10 s), no solo en la que vendió la última unidad.
- Pago mixto (efectivo, tarjeta, transferencia, crédito), cambio, factura de consumo o de crédito fiscal.
- Ofertas automáticas (%, precio especial, 2x1/3x2, por volumen, por horario y días) y cupones.
- **Ofertas con tope de unidades** ("20 whiskies a 800"): al venderse el tope la caja avisa "se acabó la oferta" y cobra el resto a precio normal. Se cuenta por sucursal y se bloquea al cobrar para que dos cajas no vendan la misma unidad.
- Delivery activable por sucursal: pedido → despacho → entrega → liquidación del repartidor.

**Inventario**
- Cada sucursal tiene su propio inventario, administrado desde la central.
- Kardex inmutable con costo promedio ponderado y saldo por movimiento.
- Ajustes, conteos físicos (a ciegas), traspasos entre sucursales **al costo**, lotes y vencimientos, mínimos y máximos.
- **Almacén central que surte a las tiendas** (todo bajo el mismo RNC, sin venta ni comprobante): la tienda pide con **cantidades sugeridas** (cuando lo que hay más lo que viene en camino llega al mínimo, se completa hasta el máximo o el doble del mínimo, sin pasar de lo que tiene el almacén); el almacén **despacha** ajustando a lo que tiene e imprime el **conduce** (documento interno no fiscal, con chofer, vehículo y firmas); la tienda **recibe contando** a ciegas y las diferencias quedan valoradas al costo. Resumen mensual por origen y destino.

**Compras (Administración › Compras)**
- Factura del proveedor (NCF, número, contado o crédito): entra al inventario por el kardex y recalcula el costo promedio.
- Cada línea puede marcarse **en oferta del proveedor** con su costo normal: el sistema guarda a cuánto se compró en oferta y lo muestra al comprar de nuevo (con la diferencia contra la última compra) y al crear ofertas de venta ("¿hasta dónde puede bajar?": precio normal, costo promedio, última compra normal y última en oferta, cada uno con botón "Usar").
- Ofertas con botones de vigencia (Hoy, Esta semana, Fin de semana, 7 días, Este mes) y tope sugerido con las unidades compradas en oferta.

**Productos (Administración › Productos)**
- Ficha completa: tipo (inventariable, servicio, combo), marca, nombre corto para el ticket, ITBIS, presentaciones con varios códigos de barra.
- Los 3 precios se definen **por monto (RD$) o por % de ganancia sobre el costo**, nivel por nivel, con redondeo (centavos, RD$1, RD$5, RD$10). Con %, el precio se calcula solo y, si cambia el costo, avisa y lo recalcula con un clic. La caja siempre lee el monto ya calculado.
- ITBIS desglosado, ganancia, margen sobre la venta, alerta de precio bajo el costo e historial de cambios con usuario.
- Combos: al venderse descuentan cada componente; su existencia es lo que alcanza con los componentes y su costo es la suma de ellos. Anularlos devuelve los componentes.
- Proveedores por producto (principal, código del proveedor, último costo).
- Existencia por sucursal de solo lectura (se corrige con un ajuste para que el kardex cuadre), mínimos, máximos y ubicación por sucursal.
- Alta rápida por código de barras (sugiere nombre, marca e imagen desde Open Food Facts si hay internet), duplicar para variantes, foto reducida a 320 px.
- **Precios por sucursal opcional y apagado por defecto** (Comercial › Precios). Apagado, todas las sucursales venden al precio general; los precios propios se conservan por si se vuelve a activar. No afecta la velocidad: la caja lee el precio de su catálogo en memoria.

**Facturación electrónica (DGII)**
- e-NCF por bloques asignados a cada sucursal: nunca se repiten, aunque no haya internet.
- XML del e-CF firmado en el servidor local (XMLDSig RSA-SHA256) con el certificado `.p12` de la empresa.
- Código de seguridad y QR en el ticket (`ConsultaTimbre` / `ConsultaTimbreFC`).
- Consumo menor a RD$250,000 → se envía el resumen RFCE; el resto, el e-CF completo.
- Cola de envío con contingencia: sin internet se sigue facturando y se envía al volver la conexión.
- Transmisor intercambiable: Simulado, DGII directo o PSE.

**Marca camaleón**: se sube el logo, se extraen sus colores y toda la plataforma (y el ticket) se adapta, con contraste legible garantizado.

## Probarlo en una computadora

Requisitos: **Node.js 22 LTS** (o 20.12+) y **PostgreSQL 16** (instalado, o con Docker Desktop).

```bash
npm install                      # 1. dependencias
docker compose up -d db          # 2. base de datos (o instale PostgreSQL: usuario/clave/base "factpos")
copy .env.example .env           # 3. configuración (en Mac/Linux: cp .env.example .env)
npm run preparar                 # 4. compila todo y carga los datos de demostración
npm start                        # 5. inicia el servidor (Ctrl+C para detenerlo)
```

El servidor lee el archivo `.env` de la carpeta del proyecto; ahí se cambia el modo (`central` o `sucursal`), el puerto y el certificado.

- Terminal: http://localhost:3000/terminal/ → conectar → "Caja 1" → "María Cajera"
- Administración: http://localhost:3000/admin/ → empresa `01900000-0000-7000-8000-000000000001`
- Verificador de precios: http://localhost:3000/verificador?sucursal=01900000-0000-7000-8000-000000000002

PIN de demostración: **4321** (supervisor Carlos) · **1234** (administrador).

Códigos para probar: cerveza `7460002000016` (6 o más con precio por volumen), refresco `7460003000015` (2x1), ron `7460001000017`, arroz `7460004000014`, salami por peso `2001230012359`. Cupón: `BIENVENIDO`.

```bash
npm test         # pruebas del motor de precios, impuestos, ofertas y colores
```

## Instalar en una sucursal (Windows)

`npm run empaquetar` (o la tarea **Paquete de instalación** de GitHub al publicar una versión `v1.2.3`) arma `FactPOS-Servidor-<versión>.zip`: servidor compilado, caja, administración, migraciones, dependencias de producción e instaladores. Los pasos están en `instalador/LEEME.txt`.

- **`instalador/instalar-servidor.ps1`** (como Administrador): instala Node.js 22 y PostgreSQL 16 con winget, copia a `C:\FactPOS`, crea la base con clave aleatoria y el `.env`, aplica migraciones, deja el servidor **arrancando con Windows** (tarea programada que se reinicia si falla) y abre el firewall **solo para la red local**.
- **`instalador/instalar-caja.ps1`**: **encuentra solo el servidor** en la red y crea el acceso *FactPOS Caja* en pantalla completa con **impresión directa** a la térmica, y que se abre al encender.

**Cómo encuentran las cajas al servidor**
1. El servidor responde al nombre **`factpos.local`** (mDNS; Windows 10/11 lo resuelve solo) y anuncia el servicio `_factpos._tcp`.
2. Responde a la búsqueda por broadcast UDP en el puerto 41234 (la usa el instalador de la caja).
3. La pantalla de la caja, si no la abre el propio servidor, prueba `factpos.local` y recorre las redes locales más comunes.

Con dos servidores en la misma red, cada uno lleva su `NOMBRE_RED` (`factpos-norte.local`, …).

## Padrón de RNC de la DGII

La DGII publica el listado de contribuyentes (`DGII_RNC.zip`, ~770 mil registros, 11 columnas separadas por `|`). FactPOS guarda una copia en cada servidor (~100 MB) para completar nombres por RNC o cédula **sin internet** (unos 3 ms por consulta).

- Servidor de sucursal: se actualiza **solo una vez por semana** si hay internet (`PADRON_AUTOMATICO=no` lo apaga).
- Administración › Configuración › **Padrón de RNC (DGII)**: estado, *Descargar ahora* o *Subir archivo* (el .zip de la DGII o el .txt).
- Línea de comandos: `npm run padron` (descarga) o `npm run padron -- ruta/DGII_RNC.zip`. Carga los 770 mil en unos 10 segundos.
- Supabase: la tarea **Padrón DGII** de GitHub Actions lo carga el día 1 de cada mes (Vercel no admite archivos tan grandes).

## Un servidor por sucursal: cómo se sincroniza

Cada sucursal tiene **su propio servidor con su propia base de datos**: las cajas venden contra él aunque se caiga el internet. La central (Vercel + Supabase) es el punto de encuentro de todas.

```
            Central (nube)                                     Servidor de la sucursal
  ┌──────────────────────────────┐   cada 15 s   ┌──────────────────────────────────────┐
  │ productos · precios · ofertas │ ── BAJA ───►  │ catálogo de las cajas                 │
  │ clientes · usuarios · e-NCF   │               │                                       │
  │ traspasos/compras/ajustes  ───┼─ kardex ───►  │ existencias de esta sucursal          │
  │                               │               │                                       │
  │ ventas · turnos · cierres  ◄──┼─── SUBE ───── │ sync_outbox (se llena en cada venta)  │
  │ clientes nuevos · estado e-CF │               │                                       │
  └──────────────────────────────┘               └──────────────────────────────────────┘
```

- **Quién manda en qué**: la central es dueña de los datos maestros (productos, precios, ofertas, usuarios, rangos de e-NCF) y de los movimientos de inventario que se hacen en la oficina (compras, traspasos, ajustes, conteos). Cada sucursal es dueña de lo que pasa en sus cajas (ventas, turnos, cierres, delivery, el contador de e-NCF).
- **Subida**: cada venta escribe, en la misma transacción, su paquete completo en `sync_outbox` (venta, líneas, pagos, kardex, e-CF). El servidor lo sube por lotes a `POST /central/sync/subir`; lo que la central confirma se marca como enviado y lo que falla se reintenta. **Sin internet se sigue vendiendo**: la cola crece y se vacía sola al volver la conexión.
- **Bajada**: `GET /central/sync/cambios` entrega lo que cambió desde la última versión (cada tabla maestra lleva un número de versión global) y los movimientos de kardex de esa sucursal. Se aplica todo en una sola transacción; filas iguales no se reescriben (así las cajas no recargan el catálogo sin motivo).
- **Inventario**: el kardex es la unidad que viaja. Cada movimiento tiene un id único y se aplica **una sola vez** en cada lado, así la existencia de cada sucursal es la misma en la central y en su servidor. Reenviar o volver a bajar todo no duplica nada.
- **Traspasos**: se registran en la Administración (central). La salida baja al servidor del almacén y, cuando la tienda recibe contando, la entrada baja al servidor de la tienda.
- **Clientes**: se pueden crear en cualquier caja; gana el último cambio. Si dos sucursales registran el mismo RNC a la vez, el segundo queda inactivo y sus ventas siguen siendo válidas.
- **e-NCF**: cada sucursal tiene su bloque de números; el contador nunca retrocede aunque la central tenga un dato viejo, y la central se entera de hasta dónde se usó.
- **Estado**: Administración › Sucursales muestra si el servidor de cada sucursal está en línea y cuánto tiene por subir. En el servidor: `GET /sync/estado` y `POST /sync/ahora`.

Configuración del servidor de la sucursal (`.env`, o `instalar-servidor.ps1 -CentralUrl … -SucursalId … -CentralClave …`):

| Variable | Qué es |
|---|---|
| `CENTRAL_URL` | Dirección de la API en la nube. Vacía = la sucursal trabaja sola. |
| `SUCURSAL_ID` | Identificador de la sucursal (Administración › Sucursales › *Conectar su servidor*). |
| `CENTRAL_CLAVE` | La `CLAVE_ACCESO` de la nube. |
| `SYNC_SEGUNDOS` | Cada cuánto sincroniza (15 por defecto). |

Un servidor nuevo arranca con la base vacía y baja todo de la central (productos, usuarios, existencias) en la primera vuelta.

## Inicio de sesión y permisos

- **Administración**: usuario y contraseña (8+ caracteres, letras y números). La sesión dura 12 horas; si se desactiva un usuario o se le cambia el rol, aplica de inmediato. Demostración: `admin` / `admin1234` (cámbiela en *Su nombre › Cambiar mi contraseña*).
- **Caja**: el cajero elige su nombre y teclea su **PIN** (4 a 6 números). Toda operación de la caja va firmada con su sesión, que solo sirve en esa caja. Demostración: María `1111`, Carlos (supervisor) `4321`, Administrador `1234`.
- **Roles** (*Usuarios y permisos › Roles*): cada rol marca qué puede hacer en la caja (vender, aprobar descuentos, anulaciones, retiros, gastos, cobrar abonos…) y en la administración (productos, precios, compras, traspasos, recibir traspasos, cuentas por cobrar, reportes, fiscal, configuración, usuarios).
- **Sucursales de cada usuario** (*Usuarios y permisos › Editar*): *todas* (incluidas las que se creen después) o *solo estas*. Un usuario limitado solo entra a las cajas de sus sucursales y, en la Administración, solo ve y opera esas sucursales (selectores, reportes, resumen, comprobantes, movimientos); pedir otra a propósito devuelve 403.
- **Certificado digital** (*Facturación electrónica › Certificado digital*): se sube una vez (es de la empresa, un solo RNC), se guarda cifrado y se **activa o desactiva por sucursal**. Las sucursales activadas lo bajan solas y firman con él aunque luego se queden sin internet.
- **Servidores de sucursal**: cada uno se conecta a la nube con su propia **clave de conexión** (*Sucursales › Conectar su servidor › Generar clave*), que solo sirve para esa sucursal. Se puede cambiar en cualquier momento.

## Caja: retiros, gastos y abonos

- **Retiro** (efectivo al banco u oficina) y **gasto** (hielo, transporte…; con NCF si trae factura, para el 606): con PIN del supervisor, salen impresos con firmas y restan en el cuadre. **Sencillo**: entra cambio a la gaveta.
- **Abono de cliente a crédito** (F4 › *Cobrar abono*): en efectivo (con cambio), tarjeta (con aprobación) o transferencia; recibo impreso con saldo anterior y nuevo. Cuadra en el cierre según cómo pagó.
- **Cuentas por cobrar** (Administración › Finanzas): saldo de cada cliente, antigüedad (al día, 1-30, 31-60, más de 60 días vencido), estado de cuenta imprimible, abonos en la oficina, ajustes con motivo, límite y días de crédito. **Un solo saldo por cliente** aunque compre en varias tiendas: los movimientos bajan a todas las sucursales.

## Si se cae el servidor de la tienda: la caja sigue vendiendo

- La caja guarda en su propio disco (IndexedDB) el catálogo, la configuración, el turno y la pantalla misma (el instalador de la caja habilita esto en su perfil del navegador). Aunque el servidor esté apagado, **la caja abre y vende**.
- Aviso rojo fijo y visible: *"SIN CONEXIÓN CON EL SERVIDOR desde las 4:15 p. m. · Siga vendiendo…"* con cuántas ventas lleva guardadas.
- Sin servidor solo se emite **factura de consumo (E32) al contado** (efectivo, tarjeta, transferencia). No hay crédito fiscal (E31), ventas a crédito, cupones, descuentos ni cierre de turno.
- Cada caja tiene **apartados 30 e-NCF E32** que se reponen solos mientras hay servidor. La factura sale con su e-NCF y la leyenda *"Emitida en contingencia · firma electrónica pendiente"*. Al volver el servidor, la caja manda sus ventas en orden (sin duplicar), el servidor las registra con su hora real, las firma y las envía a la DGII.
- Si el servidor se reinicia y nadie había entrado, entran sin servidor solo quienes ya usaron esa caja (el PIN se verifica en la caja).
- ⚠️ **Confirmar con la DGII o el PSE** que este procedimiento de contingencia (ticket sin código de seguridad, firmado después) es aceptable, y reportar los e-NCF apartados que nunca se usen.

## Correo: cierres de caja y resumen del día

En *Administración › Correo y envíos*:

- **Cuenta de correo**: Gmail / Google Workspace (con *contraseña de aplicación*), Outlook / Microsoft 365, Zoho, el SMTP del hosting o Resend. La contraseña se guarda cifrada (con `PIN_SECRETO`) y nunca vuelve al navegador. *Enviar prueba* confirma que funciona antes de guardar.
- **Cierre de caja**: apenas la sucursal sube el cierre del turno, sale un correo con lo vendido, el cuadre por forma de pago (esperado, contado, diferencia), retiros, gastos y la nota del cajero. Opción: *solo cuando haya faltante o sobrante*.
- **Resumen del día**: a la hora elegida (hora de RD), lo del día anterior: ventas por sucursal y contra el mismo día de la semana pasada, formas de pago, cierres con diferencia, comprobantes rechazados, incidentes y productos bajo mínimo.
- **Avisos al servicio técnico** por correo (además de Telegram o webhook).
- Por envío: destinatarios y sucursales. *Ver ejemplo* muestra el correo con datos reales. La bitácora *Enviados* guarda cada correo; si falla se reintenta solo (5, 10, 20… minutos) y se puede reenviar.
- Los correos salen de la central. El resumen diario necesita la tarea **Vigilancia de sucursales** (ver abajo: `CRON_SECRET`).

## Avisos al servicio técnico

Se registra un **incidente** cuando una caja trabaja sin servidor, cuando un servidor de tienda estuvo apagado (lo detecta al arrancar) y cuando **un servidor de tienda deja de comunicarse con la nube** por más de `ALERTA_MINUTOS` (5). Este último lo detecta la nube, así que el aviso llega aunque la tienda esté sin luz. Al volver, llega el aviso de *resuelto*. Se ven en Administración › *Incidentes y soporte*, donde soporte anota qué pasó.

Los avisos los envía la API en la nube por los canales que tenga configurados (variables en Vercel):

| Canal | Variables |
|---|---|
| Telegram (recomendado) | `SOPORTE_TELEGRAM_TOKEN` (de @BotFather) y `SOPORTE_TELEGRAM_CHAT` (id del grupo de soporte) |
| Correo | `SOPORTE_CORREO` (uno o varios, separados por coma), `RESEND_API_KEY`, opcional `CORREO_DESDE` |
| Webhook | `SOPORTE_WEBHOOK_URL`: recibe `{ text, incidente }` (Slack, Teams, Make o Zapier para WhatsApp) |

La revisión periódica en la nube la hace la tarea **Vigilancia de sucursales** de GitHub Actions cada 5 minutos: ponga en Vercel `CRON_SECRET` y en GitHub los secretos `CENTRAL_URL` y `CRON_SECRET`. El botón *Enviar aviso de prueba* confirma que los avisos llegan.

## En la nube: GitHub + Supabase + Vercel

```
GitHub (código) ──► Vercel: proyecto "factpos-api"    (apps/servidor, MODO=central) ──► Supabase (PostgreSQL)
               └──► Vercel: proyecto "factpos-admin"  (apps/admin)  ── usa la API ──┘
Sucursal: servidor local + cajas (rápido y sin depender de internet) ── se sincroniza con la API cada 15 s
```

1. **GitHub**: suba el proyecto a un repositorio privado (rama `main`).
2. **Supabase**: cree el proyecto (región `us-east-1`, la más cercana a RD) y copie la cadena **Session pooler** (Connect → puerto 5432).
3. **GitHub → Settings → Secrets → Actions**: secreto `SUPABASE_DB_URL` con esa cadena. Luego en **Actions → "Base de datos en Supabase" → Run workflow** (marque "demostración" la primera vez). Crea las tablas; después corre solo cada vez que cambie `db/migrations`.
4. **Vercel → proyecto API**: importe el repositorio, *Root Directory* `apps/servidor` (Vercel detecta Fastify). Variables: `DATABASE_URL` (cadena **Transaction pooler**, puerto 6543), `MODO=central`, `CLAVE_ACCESO`, `PIN_SECRETO`.
5. **Vercel → proyecto Administración**: importe el mismo repositorio, *Root Directory* `apps/admin` (Vite). Variable: `VITE_CENTRAL_URL` = dirección del proyecto API.
6. Abra la Administración, escriba el identificador de la empresa y la `CLAVE_ACCESO`.

Notas:
- La migración `0014` quita el acceso de la API pública de Supabase (roles `anon` y `authenticated`) a las tablas: FactPOS se conecta directo a PostgreSQL.
- En Vercel no se aplican migraciones ni corre la cola del e-CF: las migraciones las aplica GitHub Actions y los e-CF se firman en cada sucursal.
- Sin `CLAVE_ACCESO`, la API no arranca en Vercel.

## Pendiente antes de producción

1. **Certificación de facturación electrónica** con la DGII: validar el XML contra los XSD oficiales y el set de pruebas; confirmar las direcciones de los servicios; adaptar el transmisor al PSE elegido; **confirmar el procedimiento de contingencia** de las cajas.
2. Cuentas por pagar, reportes 606/607/608.
3. Respaldos automáticos de la base de cada sucursal.

## Instalador único y alta de servidores con código

`FactPOS-Instalador.zip` (GitHub › Releases › «FactPOS · Última versión») trae un solo
**INSTALAR FactPOS.bat** que pregunta qué es la computadora:

1. **Servidor de la tienda**, que se da de alta de una de estas formas:
   - **Código de instalación**: la Administración lo genera al crear la sucursal (o en
     Sucursales › «Código de instalación», vale 7 días y una vez). Se escribe en el
     instalador y el servidor queda dado de alta solo (`POST /central/alta/canjear`).
   - **Solicitud**: sin código, el servidor aparece en Sucursales › «Servidores esperando
     alta» y solo se confirma la sucursal (`/central/alta/solicitar`, `estado`, `aprobar`).
     Con `-Rnc` solo la ve esa empresa.
   - **A mano**: identificador, clave `fps_` y `PIN_SECRETO`.
   En todos los casos el servidor recibe su `SUCURSAL_ID`, una clave de conexión nueva y
   el `PIN_SECRETO`, los guarda en su `.env` y empieza a sincronizar sin reiniciar.
2. **Caja**: busca sola el servidor en la red local (UDP 41234 y `factpos.local`).
3. **Servidor y caja** en la misma PC.
4. **Administración**: la app de escritorio que abre el panel de la nube (`ADMIN_URL`).

Cada sucursal opera por su cuenta (su servidor, sus cajas, su inventario y sus almacenes)
y todas se administran juntas desde la nube.

## FactPOS como producto: portal, clientes y licencias

```
PORTAL DEL PROVEEDOR (MODO=portal) · https://factpos.vercel.app
  clientes, licencias, activaciones · NO guarda datos de los clientes
        │ licencias firmadas (Ed25519)
        ▼
NUBE DE CADA CLIENTE (MODO=central) · su Vercel + su Supabase (cuentas del cliente)
  administración web: https://factpos.vercel.app/<cliente>/ (la sirve el portal y habla con SU API)
        │ sincronización
        ▼
SERVIDORES DE SUS SUCURSALES (MODO=sucursal) + cajas
```

- **Portal** (`MODO=portal`, variable `LICENCIAS_CLAVE_PRIVADA`): `/` es la administración del
  proveedor (Clientes y licencias, Usuarios del portal) y `/<cliente>/` la administración web de cada
  cliente, conectada a la API de su nube. API pública: `POST /licencias/activar`, `POST /licencias/renovar`,
  `GET /licencias/cliente/:slug`. Tablas `portal_*` (migración 0029).
- **Licencia**: `base64url(JSON).base64url(firma Ed25519)`; la llave pública está en
  `apps/servidor/src/licencia/nucleo.ts`. Se cobra por sucursal (máximo de tiendas activas).
  Aviso 15 días antes; al vencer, 7 días de gracia; después solo consulta (no vende). Sin licencia:
  30 días de prueba con 2 sucursales. Nunca se borra nada.
- **Nube del cliente**: Administración › Licencia › activar con la clave `FPS-XXXX-…`. Se renueva sola
  cada 12 h (vigilancia/cron) y baja a las sucursales con la sincronización; cada servidor la verifica
  solo, sin internet. Al portal solo viaja: licencia, instalación, versión y sucursales activas.

### Dar de alta un cliente nuevo
1. **Portal › Clientes y licencias › Nuevo cliente**: nombre, nombre corto (`royalliquorstore`),
   sucursales y vencimiento. Copie la **clave de activación** (se muestra una vez).
2. **Supabase (cuenta del cliente)**: proyecto nuevo; copie la cadena *Session pooler* (5432) y la
   *Transaction pooler* (6543).
3. **Vercel (cuenta del cliente)**: importe este repositorio, *Root Directory* `apps/servidor`, y ponga
   `MODO=central`, `DATABASE_URL` (Transaction pooler), `PIN_SECRETO`, `CLAVE_ACCESO`, `CRON_SECRET`
   (márquelas como *Sensitive*: nadie puede volver a leerlas, ni usted).
4. Despliegue. Cada despliegue aplica solo las migraciones a su base (`scripts/migrar-en-vercel.mjs`),
   también en cada actualización. Al abrir su administración por primera vez aparece la
   **Configuración inicial** (pide la `CLAVE_ACCESO`): empresa, RNC, primera sucursal y usuario administrador.
5. En el portal ponga la **dirección de su API** en el cliente. Su administración queda en
   `https://factpos.vercel.app/royalliquorstore/`.
6. El cliente entra, va a **Licencia** y activa con la clave. Luego instala sus servidores (instalador,
   opción Servidor, con el nombre corto de su empresa) y sus cajas.

## Administración local (sin internet)

Cada servidor de sucursal sirve también la administración en `http://<servidor>:3000/admin/`, con las
mismas rutas `/central/*` sobre su base local y limitada a esa sucursal (`SUCURSAL_ID`).
- Lo que se cambia ahí (catálogo, precios, ofertas, usuarios, roles, marca, almacenes, compras, ajustes,
  conteos y sus movimientos de inventario) lo anota un disparador en `sync_outbox` como `local:<tabla>`
  (migración 0030; solo con `factpos.modo=sucursal` y nunca al aplicar cambios de la nube) y sube con la
  sincronización. La nube lo aplica con `sync/subida-local.ts`: gana el más reciente, los documentos se
  insertan una vez y un número de ajuste repetido se renumera.
- Con nube, las escrituras que afectan a otras sucursales o a toda la empresa responden 409
  («se hace en la nube»): traspasos, pedidos, e-CF (secuencias, certificado, configuración), correo,
  cuentas por cobrar, terminales, alta de servidores y licencia.
- Una tienda sin nube (sin `CENTRAL_URL`) lo hace todo localmente, incluida la configuración inicial y la licencia.
