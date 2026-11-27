/**
 * Contenido de las PROPUESTAS comerciales del portal: una por tipo de sistema (la edición estándar y cada edición).
 * Lo que el proveedor envía a un posible cliente: para quién es, qué problemas resuelve y qué funciones trae.
 * Los textos salen de lo que el sistema hace hoy; si una función no existe todavía, no se promete aquí.
 */
export interface TarjetaProp { i: string; t: string; d: string; l?: string[] }
export interface AreaProp { nombre: string; titulo: string; intro: string; tarjetas: TarjetaProp[] }
export interface PropuestaTipo {
  /** id de la edición (EDICIONES) o «ESTANDAR» para FactPOS a secas */
  id: string;
  slug: string;
  nombre: string;
  /** a quién va dirigida: «Para mueblerías y tiendas de electrodomésticos» */
  para: string;
  titulo: string;
  resumen: string;
  /** problemas del día a día que resuelve (lenguaje del dueño del negocio) */
  retos: { t: string; d: string }[];
  areas: AreaProp[];
  /** frase breve para el mensaje de WhatsApp: viñetas */
  viñetas: string[];
}

/** Lo que trae TODA edición de FactPOS (se muestra al final de cada propuesta). */
export const BASE_COMUN: TarjetaProp[] = [
  { i: "🧾", t: "Facturación electrónica e-CF", d: "Comprobantes fiscales electrónicos de la DGII, con su código QR y envío por correo al cliente." },
  { i: "🏬", t: "Varias sucursales", d: "Todas sus tiendas conectadas, con inventario propio por sucursal y administración desde un solo lugar." },
  { i: "📶", t: "Sigue vendiendo sin internet", d: "La caja tiene el catálogo en memoria: si se cae el internet, factura y sincroniza al volver." },
  { i: "🔐", t: "Usuarios, permisos y PIN", d: "Cada empleado ve y hace solo lo que le toca; los descuentos, anulaciones y cambios de precio piden PIN de supervisor y quedan auditados." },
  { i: "📊", t: "Reportes y cierres de caja", d: "Ventas, ganancias, impuestos y cuadre de cada turno con conteo ciego, por sucursal o todas juntas." },
  { i: "🌐", t: "Acceso desde cualquier lugar", d: "Entre a su administración desde la computadora o el celular, con una dirección fija para su empresa." },
  { i: "⬆️", t: "Se actualiza solo", d: "Nuevas versiones sin perder lo que ya tiene cargado, con soporte cercano." },
];

export const PASOS: { t: string; d: string }[] = [
  { t: "Prueba gratis 15 días", d: "Descargue el instalador y úselo sin pagar y sin tarjeta." },
  { t: "Cargamos su inventario", d: "Traiga sus productos desde Excel o CSV: usted indica qué columna es cada dato y se revisa antes de cargar." },
  { t: "Capacitamos a su equipo", d: "Cajeros y administradores aprenden con manuales ilustrados y acompañamiento." },
  { t: "Activamos su licencia", d: "Cuando esté conforme, activamos su licencia y sigue con todo ya cargado." },
];

export const PROPUESTAS: PropuestaTipo[] = [
  // ------------------------------------------------------------------------------------------ FactPOS estándar
  {
    id: "ESTANDAR", slug: "tienda", nombre: "FactPOS",
    para: "Para colmados, supermercados, licorerías, ferreterías y tiendas en general",
    titulo: "Venda más rápido y tenga su inventario bajo control",
    resumen: "Punto de venta e inventario para comercios: caja ágil con lector de código de barras, precios por nivel, ofertas y facturación electrónica.",
    retos: [
      { t: "Cajas lentas y errores al cobrar", d: "Con el escaneo instantáneo y el cálculo automático de ITBIS, la fila se mueve y el cajero no se equivoca." },
      { t: "No saber cuánto tiene ni cuánto gana", d: "Existencias por sucursal, kardex y margen de ganancia a la vista antes de fijar un precio." },
      { t: "Promociones que se hacen a mano", d: "2x1, paga 5 lleva 6, precio especial o paquetes: se programan una vez y la caja las aplica sola." },
      { t: "Facturar a la DGII", d: "Comprobantes electrónicos desde la misma caja, con RNC verificado." },
    ],
    areas: [
      { nombre: "Caja", titulo: "La caja: rápida, clara y a prueba de errores", intro: "El cajero solo factura. El catálogo vive en la caja, así que escanear no espera al servidor.", tarjetas: [
        { i: "⚡", t: "Escaneo instantáneo", d: "Lector de código de barras, cantidades con 3*código, etiquetas de balanza y búsqueda por nombre." },
        { i: "💳", t: "Pago mixto", d: "Efectivo, tarjeta, transferencia y crédito en la misma factura, con cambio." },
        { i: "⏸️", t: "Ventas en pausa", d: "Pause una venta y retómela después; sobrevive aunque se reinicie la caja." },
        { i: "🖥️", t: "Pantalla del cliente", d: "Segunda pantalla con los productos, el total y las ofertas del negocio." },
        { i: "🛵", t: "Delivery", d: "Pedido, despacho, entrega y liquidación del repartidor, activable por sucursal." },
      ] },
      { nombre: "Precios y ofertas", titulo: "Precios al instante y promociones que se aplican solas", intro: "Un solo motor calcula precios, ofertas y cupones: la caja y el servidor dan exactamente el mismo resultado.", tarjetas: [
        { i: "💲", t: "Tres niveles de precio", d: "Detalle, mayor y especial; cada cliente trae su nivel y el cajero no tiene que elegirlo." },
        { i: "📈", t: "Ganancia y margen", d: "ITBIS desglosado, margen sobre la venta y alerta de precio bajo el costo." },
        { i: "🏷️", t: "Ofertas", d: "Porcentaje, precio especial, lleva y paga, por volumen y paquetes («3 por 2,500»), con fechas, horarios y tope de unidades." },
        { i: "🎟️", t: "Cupones", d: "Cupones con monto o porcentaje, límite de usos y vigencia." },
      ] },
      { nombre: "Inventario y compras", titulo: "Sepa cuánto tiene, dónde está y a cuánto le costó", intro: "Cada sucursal tiene su inventario y todo movimiento queda en el kardex.", tarjetas: [
        { i: "📚", t: "Productos y presentaciones", d: "Ficha completa con varias presentaciones y códigos de barra, marca, ITBIS y foto." },
        { i: "📊", t: "Existencias y kardex", d: "Mínimos y máximos, y el historial de cada entrada y salida con costo promedio." },
        { i: "🛬", t: "Compras a proveedores", d: "La factura entra al inventario y recalcula el costo promedio." },
        { i: "🔁", t: "Traspasos y conteos", d: "Mueva mercancía entre sucursales y haga conteos físicos a ciegas con ajuste automático." },
        { i: "📥", t: "Importar desde Excel", d: "Traiga su inventario de otro sistema sin digitarlo de nuevo." },
      ] },
      { nombre: "Clientes y cobros", titulo: "Venda a crédito sin perder el control", intro: "Los clientes con crédito, sus abonos y sus estados de cuenta, en un solo lugar.", tarjetas: [
        { i: "💰", t: "Cuentas por cobrar", d: "Clientes a crédito, abonos y estados de cuenta de todas las sucursales." },
        { i: "📝", t: "Cotizaciones y pedidos", d: "Prepare cotizaciones y envíelas por correo; los pedidos al por mayor se alistan y se facturan." },
        { i: "🧑‍💼", t: "FactPOS Vendedor", d: "El vendedor arma la venta desde su PC o su teléfono y la envía a la caja, donde el cajero cobra." },
      ] },
    ],
    viñetas: ["Caja rápida con lector de código de barras, ITBIS y facturación electrónica", "Inventario por sucursal con kardex y alertas de reposición", "3 niveles de precio, ofertas y control de ganancia", "La caja sigue vendiendo aunque falle el internet"],
  },
  // ------------------------------------------------------------------------------------------ Mueblería
  {
    id: "MUEBLERIA", slug: "muebleria", nombre: "FactPOS Mueblería",
    para: "Para mueblerías y tiendas de electrodomésticos",
    titulo: "Venta a plazos, cobranza en ruta y entregas bajo control",
    resumen: "Todo lo del punto de venta, más planes de financiamiento, cuotas y mora, cobro en ruta, entregas con chofer y garantías por número de serie.",
    retos: [
      { t: "Cuotas y atrasos en cuadernos", d: "Cada venta a plazos genera su plan de cuotas; el sistema calcula la mora y le dice quién está atrasado." },
      { t: "Cobradores en la calle", d: "Recibos de ingreso y cobranza en ruta, con lo cobrado por cada cobrador al cierre." },
      { t: "Entregas que se pierden", d: "Cada entrega queda asignada a un chofer, con su estado hasta que el cliente recibe." },
      { t: "Garantías sin respaldo", d: "El número de serie de cada equipo queda ligado a la factura y a su garantía." },
    ],
    areas: [
      { nombre: "Venta a plazos", titulo: "Financie sus ventas sin llevar cuentas a mano", intro: "Defina sus planes y el sistema arma las cuotas, la inicial y el contrato.", tarjetas: [
        { i: "📅", t: "Planes de financiamiento", d: "Defina cuántas cuotas, la inicial y el interés de cada plan; el cajero solo elige el plan del cliente." },
        { i: "🧮", t: "Plan de cuotas", d: "Calendario de cuotas por cliente con lo pagado, lo pendiente y el próximo vencimiento." },
        { i: "⏰", t: "Mora y recuperación", d: "Cálculo de mora, clientes atrasados y seguimiento para recuperar lo vencido." },
        { i: "📄", t: "Documentos de la venta", d: "Pagaré y contrato impresos desde el sistema, con los datos del cliente y de la venta." },
      ] },
      { nombre: "Cobranza", titulo: "Cobre a tiempo, en la tienda o en la calle", intro: "Cada pago queda registrado con su recibo y se aplica a la cuota que corresponde.", tarjetas: [
        { i: "🧾", t: "Recibos de ingreso", d: "Abonos y pagos de cuotas con recibo impreso y aplicado al plan del cliente." },
        { i: "🛣️", t: "Cobranza en ruta", d: "Reparta los clientes por cobrador y registre lo cobrado en la calle." },
        { i: "💰", t: "Cuentas por cobrar", d: "Todo lo que le deben, por cliente y por sucursal, con estados de cuenta." },
      ] },
      { nombre: "Entregas y garantías", titulo: "Lo que vende llega a su destino y queda garantizado", intro: "Del almacén a la casa del cliente, con responsable en cada paso.", tarjetas: [
        { i: "🚚", t: "Entregas con chofer", d: "Programe la entrega, asigne el chofer y siga su estado hasta la recepción." },
        { i: "🏷️", t: "Series y garantías", d: "Registre el número de serie y la garantía de cada equipo vendido." },
        { i: "📝", t: "Cotizaciones", d: "Prepare cotizaciones con el plan de pago y envíelas por correo." },
      ] },
      { nombre: "Tienda", titulo: "Y todo el punto de venta", intro: "La mueblería también necesita una caja ágil y un inventario ordenado.", tarjetas: [
        { i: "⚡", t: "Caja rápida", d: "Escaneo, pago mixto, descuentos con PIN y ventas en pausa." },
        { i: "📚", t: "Inventario", d: "Existencias por sucursal, kardex, compras y traspasos entre tiendas y almacenes." },
        { i: "🏷️", t: "Ofertas y precios", d: "Niveles de precio, ofertas y control de ganancia." },
      ] },
    ],
    viñetas: ["Venta a plazos con planes de cuotas, inicial y mora", "Cobranza en ruta y recibos de ingreso", "Entregas con chofer y garantías por número de serie", "Facturación electrónica e inventario por sucursal"],
  },
  // ------------------------------------------------------------------------------------------ Farmacia
  {
    id: "FARMACIA", slug: "farmacia", nombre: "FactPOS Farmacia",
    para: "Para farmacias y droguerías",
    titulo: "Vencimientos con aviso, tramería ordenada y venta con receta",
    resumen: "Todo lo del punto de venta, más lotes y fechas de vencimiento con alertas, ubicación de cada producto en tramería y control de medicamentos con receta.",
    retos: [
      { t: "Productos vencidos en el estante", d: "Cada lote guarda su fecha de vencimiento y el sistema avisa antes de que se venza." },
      { t: "Buscar el producto en la tramería", d: "Cada producto tiene su ubicación, para que el despachador lo encuentre sin dar vueltas." },
      { t: "Medicamentos que exigen receta", d: "La venta de productos con receta queda controlada y registrada." },
      { t: "Competir en precio", d: "Niveles de precio, ofertas y margen a la vista para decidir con números." },
    ],
    areas: [
      { nombre: "Farmacia", titulo: "Lo propio de una farmacia", intro: "Funciones pensadas para el despacho de medicamentos.", tarjetas: [
        { i: "⏳", t: "Lotes y vencimientos", d: "Control de lotes con su fecha de vencimiento y avisos antes de que caduquen." },
        { i: "🗄️", t: "Ubicación en tramería", d: "Registre dónde está cada producto y encuéntrelo de inmediato al despachar." },
        { i: "📋", t: "Venta con receta", d: "Los medicamentos que lo requieren se venden con su receta y queda el registro." },
        { i: "🔎", t: "Búsqueda por nombre o código", d: "Encuentre el producto por nombre comercial, genérico o código de barras." },
      ] },
      { nombre: "Caja", titulo: "Una caja rápida y segura", intro: "El despachador cobra en segundos y el supervisor controla lo delicado.", tarjetas: [
        { i: "⚡", t: "Escaneo instantáneo", d: "Lector de código de barras y búsqueda rápida por nombre." },
        { i: "💳", t: "Pago mixto", d: "Efectivo, tarjeta, transferencia y crédito en la misma factura." },
        { i: "🔐", t: "Descuentos con PIN", d: "Descuentos y cambios de precio con PIN del supervisor y auditoría." },
      ] },
      { nombre: "Inventario y compras", titulo: "Compre lo que se vende y no lo que se vence", intro: "Existencias, mínimos y compras con el costo siempre actualizado.", tarjetas: [
        { i: "📊", t: "Existencias y kardex", d: "Existencia por sucursal, mínimos y el historial de cada movimiento." },
        { i: "🛬", t: "Compras a proveedores", d: "La factura entra al inventario con su lote y recalcula el costo." },
        { i: "🔢", t: "Conteos físicos", d: "Inventario a ciegas con las diferencias a la vista." },
        { i: "📥", t: "Importar desde Excel", d: "Traiga su catálogo de medicamentos sin digitarlo de nuevo." },
      ] },
      { nombre: "Precios", titulo: "Precios y ofertas claros", intro: "Un solo motor de precios en toda la farmacia.", tarjetas: [
        { i: "💲", t: "Niveles de precio", d: "Precios distintos para clientes distintos, como aseguradoras o empresas." },
        { i: "🏷️", t: "Ofertas", d: "Descuentos y promociones con fechas y horarios, aplicados solos en la caja." },
        { i: "📈", t: "Margen de ganancia", d: "ITBIS desglosado y alerta si un precio queda bajo el costo." },
      ] },
    ],
    viñetas: ["Lotes y fechas de vencimiento con aviso", "Ubicación de cada producto en tramería", "Venta de medicamentos con receta", "Caja rápida, facturación electrónica e inventario por sucursal"],
  },
  // ------------------------------------------------------------------------------------------ Bar y restaurante
  {
    id: "BAR_RESTAURANTE", slug: "bar-restaurante", nombre: "FactPOS Bar y Restaurante",
    para: "Para bares, restaurantes y discotecas",
    titulo: "Mesas, comandas, cuentas abiertas y propina sin enredos",
    resumen: "Todo lo del punto de venta, más salón con mesas, comandas, cuentas abiertas por mesa, propina y delivery.",
    retos: [
      { t: "Cuentas que se pierden", d: "Cada mesa tiene su cuenta abierta; se agregan pedidos durante la noche y se cobra al final." },
      { t: "Pedidos que no llegan a cocina o barra", d: "La comanda sale al área que prepara el pedido, sin papelitos." },
      { t: "La propina y el cuadre", d: "La propina se registra aparte y el cierre de caja cuadra por turno." },
      { t: "Ventas por delivery", d: "Pedido, despacho y liquidación del repartidor desde el mismo sistema." },
    ],
    areas: [
      { nombre: "Salón", titulo: "El salón, mesa por mesa", intro: "Mapa de mesas y cuentas abiertas para que el mesero no pierda el hilo.", tarjetas: [
        { i: "🪑", t: "Mesas y salón", d: "Vea qué mesas están libres y cuáles ocupadas, y abra la cuenta de cada una." },
        { i: "🧾", t: "Cuentas abiertas", d: "Agregue pedidos durante la noche y cobre al final, junto o separado." },
        { i: "🍽️", t: "Comandas", d: "Cada pedido sale a la cocina o a la barra, según el producto." },
        { i: "🤝", t: "Propina", d: "Registre la propina en la cuenta y llévela al cierre del turno." },
      ] },
      { nombre: "Caja", titulo: "Cobrar rápido, también en la hora pico", intro: "La misma caja del punto de venta, afinada para restaurantes.", tarjetas: [
        { i: "💳", t: "Pago mixto", d: "Efectivo, tarjeta, transferencia y crédito en la misma cuenta." },
        { i: "🔐", t: "Control con PIN", d: "Anulaciones y descuentos con PIN del supervisor y todo auditado." },
        { i: "🛵", t: "Delivery", d: "Pedido, despacho, entrega y liquidación del repartidor." },
      ] },
      { nombre: "Inventario", titulo: "Sepa cuánto se consume", intro: "Bebidas e insumos con sus existencias al día.", tarjetas: [
        { i: "🧪", t: "Combos", d: "Un combo descuenta cada componente del inventario al venderse." },
        { i: "📊", t: "Existencias y kardex", d: "Mínimos, alertas de reposición y el historial de cada movimiento." },
        { i: "🔢", t: "Conteos físicos", d: "Inventario de barra y almacén a ciegas, con las diferencias a la vista." },
      ] },
      { nombre: "Precios", titulo: "Promociones para llenar el local", intro: "Happy hour y ofertas por horario, aplicadas solas.", tarjetas: [
        { i: "🏷️", t: "Ofertas por horario", d: "Descuentos o precios especiales en ciertos días y horas, sin que el mesero tenga que acordarse." },
        { i: "📈", t: "Ganancia y margen", d: "Margen de cada producto a la vista." },
      ] },
    ],
    viñetas: ["Mesas, cuentas abiertas y comandas por área", "Propina y cierre de caja por turno", "Delivery con liquidación del repartidor", "Ofertas por horario (happy hour) y facturación electrónica"],
  },
  // ------------------------------------------------------------------------------------------ Auto Detailing
  {
    id: "AUTOLAVADO", slug: "auto-detailing", nombre: "FactPOS Auto Detailing",
    para: "Para autolavados y centros de detailing",
    titulo: "Recepción de vehículos, órdenes de lavado y comisión por trabajador",
    resumen: "Todo lo del punto de venta, más recepción de vehículos, órdenes de lavado por bahía y comisión para quien hizo el trabajo.",
    retos: [
      { t: "Vehículos sin seguimiento", d: "Cada vehículo se recibe con su placa y su orden, y se sabe en qué etapa va." },
      { t: "Bahías mal aprovechadas", d: "Vea qué bahía está ocupada y qué trabajo tiene, para repartir mejor el día." },
      { t: "Pagar la comisión a cada lavador", d: "La comisión se calcula por trabajo y por persona, sin hojas de cálculo." },
      { t: "Cobrar y facturar el servicio", d: "La orden termina en factura con comprobante fiscal desde la misma caja." },
    ],
    areas: [
      { nombre: "Lavado", titulo: "De la recepción a la entrega", intro: "Cada vehículo, su orden y su responsable.", tarjetas: [
        { i: "🚗", t: "Recepción de vehículos", d: "Registre la placa, el cliente y el servicio solicitado al recibir el vehículo." },
        { i: "🧼", t: "Órdenes de lavado", d: "Cada servicio es una orden con su estado, desde que entra hasta que se entrega." },
        { i: "🛠️", t: "Bahías", d: "Asigne cada orden a una bahía y vea cuáles están ocupadas." },
        { i: "💵", t: "Comisión por trabajador", d: "Calcule lo que le corresponde a cada lavador por los trabajos que hizo." },
      ] },
      { nombre: "Caja", titulo: "Cobrar el servicio sin vueltas", intro: "La orden se convierte en factura en la misma caja.", tarjetas: [
        { i: "⚡", t: "Caja rápida", d: "Cobre servicios y productos (ceras, ambientadores) en la misma factura." },
        { i: "💳", t: "Pago mixto", d: "Efectivo, tarjeta y transferencia, con cuadre al cierre del turno." },
        { i: "🔐", t: "Control con PIN", d: "Descuentos y anulaciones con PIN del supervisor." },
      ] },
      { nombre: "Clientes", titulo: "Clientes que vuelven", intro: "Su historial a la mano.", tarjetas: [
        { i: "👥", t: "Clientes y vehículos", d: "Cada cliente con sus datos y precio, para cobrarle correctamente." },
        { i: "💰", t: "Cuentas por cobrar", d: "Clientes a crédito, como flotas o empresas, con sus abonos y estados de cuenta." },
      ] },
      { nombre: "Inventario", titulo: "Productos de lavado bajo control", intro: "Insumos y productos de venta con su existencia.", tarjetas: [
        { i: "📊", t: "Existencias y kardex", d: "Control de los productos que vende y de los insumos que usa." },
        { i: "🏷️", t: "Ofertas", d: "Promociones y precios especiales con fechas y horarios." },
      ] },
    ],
    viñetas: ["Recepción de vehículos y órdenes de lavado", "Bahías y estado de cada trabajo", "Comisión por trabajador", "Caja rápida y facturación electrónica"],
  },
];

export const propuestaPorId = (id: string) => PROPUESTAS.find((p) => p.id === id);
export const propuestaPorSlug = (s: string) => PROPUESTAS.find((p) => p.slug === s);
