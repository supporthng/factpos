import { documento } from "./sitio-web.js";

/**
 * Página «Funciones»: el catálogo completo de lo que hace FactPOS, ordenado por áreas del negocio.
 * Los textos salen de las pantallas reales de la administración y de la caja.
 */
interface Tarjeta { i: string; t: string; d: string; l?: string[]; nuevo?: boolean }
interface Area { id: string; nombre: string; titulo: string; intro: string; tarjetas: Tarjeta[] }

const AREAS: Area[] = [
  {
    id: "caja", nombre: "Caja", titulo: "La caja: rápida, clara y a prueba de errores",
    intro: "El cajero solo factura. La caja tiene el catálogo en memoria, así que escanear no espera al servidor.",
    tarjetas: [
      { i: "⚡", t: "Escaneo instantáneo", d: "Lector de código de barras, cantidades con 3*código, etiquetas de balanza y búsqueda por nombre." },
      { i: "💳", t: "Pago mixto", d: "Efectivo, tarjeta, transferencia y crédito en la misma factura, con cambio. Sin el número de aprobación del voucher no se factura." },
      { i: "⏸️", t: "Ventas en pausa", d: "Pause una venta y retómela después; sobrevive aunque se reinicie la caja." },
      { i: "🔐", t: "Descuentos y cambios de precio con PIN", d: "Descuento a un artículo o a toda la factura, con motivo y PIN del supervisor. Todo queda auditado." },
      { i: "↩️", t: "Anular o corregir facturas", d: "Con motivo y PIN se emite la nota de crédito, vuelve el inventario y se registra la devolución. «Corregir» recarga los productos para facturar de nuevo." },
      { i: "🧮", t: "Cuadre y cierre de turno", d: "Reporte X en cualquier momento y cierre con conteo ciego de billetes y monedas; el sistema muestra faltante o sobrante al final.", l: ["Cuadre de caja del día", "Impresión para firmar"] },
      { i: "👤", t: "Clientes en caja", d: "Factura con comprobante fiscal: el RNC o la cédula es obligatorio y se verifica con el dígito de la DGII. El cliente trae su nivel de precio." },
      { i: "🛵", t: "Delivery", d: "Pedido, despacho, entrega y liquidación del repartidor, activable por sucursal." },
      { i: "🖥️", t: "Pantalla del cliente", d: "Segunda pantalla con los productos, el total y las ofertas del negocio." },
    ],
  },
  {
    id: "ventas", nombre: "Ventas y clientes", titulo: "Vender, cobrar y darle seguimiento al cliente",
    intro: "Además de la caja, la administración permite vender, cotizar y controlar lo que los clientes deben.",
    tarjetas: [
      { i: "🧾", t: "Facturas", d: "Busque cualquier factura, reimprímala (marcada como copia), modifíquela o anúlela con permiso de supervisor.", l: ["Vista previa antes de imprimir", "Ticket, media carta y carta"], nuevo: true },
      { i: "🛒", t: "Vender desde la administración", d: "Facturar desde la computadora o el celular, con el mismo motor de precios de la caja." },
      { i: "📝", t: "Cotizaciones", d: "Prepare cotizaciones, imprímalas y envíelas por correo." },
      { i: "📦", t: "Pedidos al por mayor", d: "El pedido se envía a una caja, se alista y se factura." },
      { i: "🏷️", t: "Series y garantías", d: "Registre los números de serie y las garantías de lo que vende." },
      { i: "👥", t: "Clientes y niveles de precio", d: "Cada cliente tiene su Precio 1, 2 o 3: el cajero no elige el nivel, lo trae la ficha." },
      { i: "💰", t: "Cuentas por cobrar", d: "Clientes a crédito, abonos y estados de cuenta. Ventas por cobrar de todas las sucursales en un solo lugar." },
      { i: "🧑‍💼", t: "FactPOS Vendedor", d: "El vendedor arma la venta con los precios del cliente desde su PC o su teléfono Android y la envía a la caja, donde el cajero cobra." },
    ],
  },
  {
    id: "inventario", nombre: "Inventario y compras", titulo: "Sepa cuánto tiene, dónde está y a cuánto le costó",
    intro: "Cada sucursal tiene su propio inventario, administrado desde la central. Todo movimiento queda en el kardex.",
    tarjetas: [
      { i: "📚", t: "Productos", d: "Ficha completa: tipo (inventariable, servicio o combo), marca, ITBIS, presentaciones con varios códigos de barra y foto.", l: ["Alta rápida por código de barras", "Duplicar para variantes", "Proveedores por producto"] },
      { i: "🧪", t: "Combos", d: "Al venderse descuentan cada componente; su existencia es lo que alcanza con los componentes. Anularlos devuelve todo." },
      { i: "📊", t: "Existencias y kardex", d: "Existencia por sucursal, mínimos y máximos, y el historial inmutable de cada entrada y salida con costo promedio." },
      { i: "🛬", t: "Compras", d: "Factura del proveedor (NCF, contado o crédito): entra al inventario y recalcula el costo promedio.", l: ["Marque lo comprado en oferta del proveedor", "Compare con la última compra"] },
      { i: "🔁", t: "Traspasos", d: "Mueva mercancía entre sucursales y almacenes, al costo. Un almacén central puede surtir a las tiendas con cantidades sugeridas." },
      { i: "🔢", t: "Conteos físicos", d: "Inventario a ciegas, con las diferencias a la vista y el ajuste correspondiente." },
      { i: "🛠️", t: "Ajustes", d: "Corrija existencias por mermas, daños o sobrantes sin romper el kardex." },
      { i: "⏳", t: "Lotes y vencimientos", d: "Control de fechas de vencimiento por lote." },
      { i: "📥", t: "Importar desde Excel o CSV", d: "Traiga su inventario de otro sistema: usted indica qué columna es cada dato y se revisa antes de cargar." },
    ],
  },
  {
    id: "precios", nombre: "Precios y ofertas", titulo: "Precios al instante y promociones que se controlan solas",
    intro: "Un solo motor calcula precios, ofertas, cupones e impuestos: la caja y el servidor dan exactamente el mismo resultado.",
    tarjetas: [
      { i: "💲", t: "Tres niveles de precio", d: "Defínalos por monto o por porcentaje de ganancia sobre el costo, con redondeo. Si el costo cambia, el sistema avisa y recalcula." },
      { i: "📈", t: "Ganancia y margen", d: "ITBIS desglosado, ganancia, margen sobre la venta, alerta de precio bajo el costo e historial de cambios con usuario." },
      { i: "🏬", t: "Precios por sucursal (opcional)", d: "Apagado por defecto: todas venden al precio general. Si lo activa, cada tienda puede tener los suyos." },
      { i: "🎁", t: "Ofertas", d: "Porcentaje, precio especial, 2x1 y 3x2, por volumen, por horario y días, y cupones.", l: ["Vigencia con un clic: hoy, fin de semana, este mes"] },
      { i: "🔟", t: "Ofertas con tope de unidades", d: "«20 whiskies a 800»: al agotarse, la caja avisa en todas las cajas y cobra el resto a precio normal." },
      { i: "📱", t: "Verificador de precios", d: "Pantallas en la tienda (Android y Windows) y consulta desde el celular del cliente con un QR que solo responde dentro de la tienda." },
    ],
  },
  {
    id: "fiscal", nombre: "Fiscal", titulo: "Facturación electrónica y todo lo fiscal en un solo lugar",
    intro: "e-CF de la DGII firmados en su propio servidor, con una guía para certificarse y un validador que le dice si ya puede facturar.",
    tarjetas: [
      { i: "🧾", t: "e-CF firmados y enviados", d: "Comprobantes electrónicos con su certificado digital, código de seguridad y QR en el ticket. Sin internet se sigue facturando y se envía al volver.", l: ["Crédito fiscal, consumo y nota de crédito en caja", "Resumen RFCE para consumo menor de RD$250,000"] },
      { i: "🧭", t: "Certificación DGII guiada", d: "Asistente en etapas para el set de pruebas, la simulación, las aprobaciones comerciales, las URL y la declaración jurada.", nuevo: true },
      { i: "✅", t: "¿Puedo facturar?", d: "Un validador que revisa certificado, ambiente, conexión con la DGII, registro como facturador, direcciones públicas y secuencias.", nuevo: true },
      { i: "🔢", t: "Secuencias e-NCF por sucursal", d: "Bloques por sucursal que nunca se repiten, editables después de crearlos, con aviso cuando se agotan o vencen.", nuevo: true },
      { i: "📥", t: "Comprobantes recibidos", d: "Reciba los e-CF de sus proveedores y responda la aprobación comercial desde una bandeja." },
      { i: "🔑", t: "Certificado digital", d: "Súbalo, vea su vigencia, reemplácelo o quítelo. Se guarda cifrado y se activa por sucursal.", nuevo: true },
      { i: "🗂️", t: "Comprobantes NCF (serie B)", d: "Rangos de NCF tradicionales y secuencias por sucursal, mientras convive con el comprobante electrónico." },
      { i: "🧮", t: "Impuestos", d: "Tasas de ITBIS, ISC, otros impuestos y propina legal, y la planilla de impuestos." },
      { i: "🔎", t: "Padrón de RNC", d: "Consulta de RNC y cédulas de la DGII, con verificación del dígito." },
    ],
  },
  {
    id: "negocios", nombre: "Restaurantes y bares", titulo: "También para negocios de mesas, barras y discotecas",
    intro: "Todo lo anterior, más lo que se necesita cuando se atiende por mesa o en una noche de mucha gente. Se activa solo para los negocios que lo usan.",
    tarjetas: [
      { i: "🍽️", t: "Cuentas abiertas y dividir la cuenta", d: "Una cuenta por mesa o por cliente; divida antes o después: en partes iguales, por montos o por producto." },
      { i: "🍸", t: "Comandas a la barra y la cocina", d: "Cada estación recibe solo lo suyo, en pantalla o impreso. El bartender marca «Listo»." },
      { i: "🧾", t: "Propina legal del 10 %", d: "Se calcula sobre el consumo sin ITBIS, se cobra aparte del comprobante y sale en el ticket y el cierre." },
      { i: "🥃", t: "Botellas y tragos", d: "Venda la botella o por tragos y dobles; el inventario se descuenta solo." },
      { i: "🎟️", t: "Entradas, aforo y vales", d: "Cobre la entrada, sepa cuánta gente hay adentro y canjee vales de consumo en la barra." },
      { i: "🛡️", t: "Control de cortesías y anulaciones", d: "Piden PIN de supervisor y motivo, y quedan en un reporte por noche." },
    ],
  },
  {
    id: "negocio", nombre: "Sucursales y equipos", titulo: "Varias sucursales, un solo panel",
    intro: "Una central y cada tienda con su servidor, sus cajas y su inventario. Cada tienda sigue vendiendo aunque se caiga el internet.",
    tarjetas: [
      { i: "🏬", t: "Sucursales y terminales", d: "Tiendas, cajas y servidores de cada local. Si tiene una sola tienda, la misma PC puede ser servidor principal y tienda." },
      { i: "🔄", t: "Sincronización automática", d: "Las sucursales se sincronizan solas, también después de un corte de luz o de internet." },
      { i: "🖨️", t: "Formatos de impresión", d: "Ticket de 58 y 80 mm, media carta y carta, con su logo, encabezado y pie." },
      { i: "🔌", t: "Equipos de la caja", d: "Impresora, gaveta, báscula y datáfono de cada terminal." },
      { i: "🎨", t: "Apariencia de su marca", d: "Suba su logo y la plataforma (y el ticket) toma sus colores, con contraste legible garantizado." },
      { i: "✉️", t: "Correo y envíos", d: "Envíe reportes y facturas por correo desde el sistema." },
    ],
  },
  {
    id: "seguridad", nombre: "Seguridad y control", titulo: "Cada quien ve y hace solo lo que le toca",
    intro: "Las acciones delicadas piden permiso, quedan registradas y los datos se respaldan.",
    tarjetas: [
      { i: "👮", t: "Usuarios y permisos", d: "Cuentas, roles y permisos por persona y por sucursal." },
      { i: "🔐", t: "PIN de supervisor", d: "Descuentos, cambios de precio, anulaciones y cortesías requieren el PIN y un motivo." },
      { i: "🛡️", t: "Verificación en 2 pasos y equipos autorizados", d: "Proteja la administración con un segundo factor y decida desde qué equipos se entra." },
      { i: "💾", t: "Respaldos cifrados", d: "Copias en el equipo, en USB u OneDrive y en la nube." },
      { i: "🚨", t: "Incidentes y soporte", d: "Registro de fallas y caídas de conexión para saber qué pasó y cuándo." },
      { i: "🧰", t: "Puesta en marcha", d: "Una lista de lo que falta para empezar a vender: empresa, comprobantes, productos, cajas y usuarios." },
    ],
  },
  {
    id: "sistema", nombre: "Instalación y actualizaciones", titulo: "Instalar y mantener al día, sin ser técnico",
    intro: "Un instalador para el servidor, otro para cada caja y apps para administrar desde el celular.",
    tarjetas: [
      { i: "💿", t: "Instaladores", d: "Servidor, caja, verificador de precios y apps de administración. Los nombres de los instaladores no cambian con cada versión.", nuevo: true },
      { i: "⬆️", t: "Actualizaciones", d: "Cuando hay versión nueva, la administración pregunta «¿Actualizar ahora?». Las cajas y sucursales siguen al servidor principal. Solo quien tiene permiso ve el aviso.", nuevo: true },
      { i: "📋", t: "Versiones de los equipos", d: "Qué versión tiene cada servidor y verificador, y cuáles están desactualizados." },
      { i: "🌐", t: "Acceso remoto", d: "Entre desde cualquier lugar a la dirección fija de su empresa, con reglas, equipos autorizados y enlaces de acceso.", nuevo: true },
      { i: "📲", t: "Apps de administración y vendedor", d: "Para Windows y Android, además de la administración web instalable en el celular." },
      { i: "🪪", t: "Licencia", d: "Plan, vigencia y activación de su empresa." },
    ],
  },
  {
    id: "reportes", nombre: "Reportes", titulo: "Los números del negocio, cuando los necesite",
    intro: "Ventas, cierres, inventario, impuestos y más, por sucursal o de todas juntas.",
    tarjetas: [
      { i: "📈", t: "Resumen del día", d: "Ventas del día, alertas y existencias por reponer, de un vistazo." },
      { i: "🧾", t: "Cierres de caja", d: "Cuadre de cada turno, revisión de diferencias y depósitos." },
      { i: "💸", t: "Retiros y gastos", d: "Retiros, gastos y movimientos de caja." },
      { i: "📑", t: "Reportes", d: "Ventas, inventario, impuestos y más; consulte por fechas y sucursales." },
    ],
  },
];

const tarjeta = (t: Tarjeta) =>
  `<div class="tarj"><div class="ic">${t.i}</div><h3>${t.t}${t.nuevo ? '<span class="nuevo">NUEVO</span>' : ""}</h3><p>${t.d}</p>${t.l ? `<ul class="mini-l">${t.l.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}</div>`;

const area = (a: Area) =>
  `<section class="area" id="${a.id}"><div class="cont"><div class="tit"><small>${a.nombre}</small><h2>${a.titulo}</h2><p>${a.intro}</p></div><div class="rejilla">${a.tarjetas.map(tarjeta).join("")}</div></div></section>`;

const cuerpo = `
<div class="ph"><div class="cont">
  <span class="etq"><i></i>Todo FactPOS, módulo por módulo</span>
  <h1>Todo lo que hace FactPOS</h1>
  <p>Caja, inventario, precios, facturación electrónica e-CF, varias sucursales y control del negocio. Este es el recorrido completo, por áreas.</p>
  <div class="acc"><a class="btn p" href="/demo">Probar la demo</a><a class="btn s" href="/#descargar">Descargar</a><a class="btn s" href="/facturacion-electronica">Ver facturación electrónica</a></div>
</div></div>
<div class="indice"><div class="cont">${AREAS.map((a) => `<a href="#${a.id}">${a.nombre}</a>`).join("")}</div></div>
${AREAS.map(area).join("\n")}
<section><div class="cont"><div class="cta">
  <h2>¿Lo vemos funcionando en su negocio?</h2>
  <p>Descargue el instalador y disfrute 15 días de demo, sin pagar y sin tarjeta. Cuando quiera seguir, activamos su licencia.</p>
  <div class="acc"><a class="btn p" href="/#descargar">Descargar y probar 15 días</a><a class="btn s" href="/#contacto">Hablar con nosotros</a><a class="btn s" href="/#planes">Ver planes</a></div>
</div></div></section>`;

export const PAGINA_FUNCIONES = documento({
  ruta: "/funciones",
  activa: "funciones",
  titulo: "Funciones · FactPOS",
  descripcion: "Todo lo que hace FactPOS: caja rápida, inventario, precios y ofertas, facturación electrónica e-CF de la DGII, restaurantes y bares, varias sucursales y seguridad.",
  cuerpo,
});
