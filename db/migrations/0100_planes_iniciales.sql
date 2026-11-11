-- Los tres planes de FactPOS (de menor a mayor) con sus funciones para la página web.
-- No toca precios: se definen en Portal › Planes y precios. Se puede volver a editar desde ahí.
INSERT INTO portal_planes (id, codigo, nombre, descripcion, sucursales_incluidas, orden, activo)
SELECT gen_random_uuid(), v.codigo, v.nombre, v.descripcion, v.suc, v.orden, TRUE
  FROM (VALUES ('basico', 'Básico', 'Una tienda que empieza a facturar.', 1, 1),
               ('profesional', 'Profesional', 'Hasta 3 tiendas con administración central.', 3, 2),
               ('multisucursal', 'Multisucursal', 'Cadenas: 10 tiendas o más y soporte prioritario.', 10, 3)) AS v(codigo, nombre, descripcion, suc, orden)
 WHERE NOT EXISTS (SELECT 1 FROM portal_planes p WHERE p.codigo = v.codigo);

UPDATE portal_planes SET
    descripcion = 'Una tienda que empieza a facturar.', sucursales_incluidas = 1, orden = 1, destacado = FALSE, etiqueta = NULL,
    funciones = ARRAY[
      '1 sucursal con sus cajas',
      'Caja rápida: escaneo, pago mixto, ventas en pausa y descuentos',
      'Facturación electrónica e-CF a la DGII',
      'Notas de crédito, anulación con PIN y reimpresión como copia',
      'Inventario con kardex y compras con factura del proveedor',
      'Clientes, cuentas por cobrar y cierres de caja',
      'Administración web con reportes',
      'Permisos por usuario y PIN de supervisor',
      'Funciona sin internet y se actualiza sola',
      'Soporte por mensaje']
 WHERE codigo = 'basico';

UPDATE portal_planes SET
    descripcion = 'Hasta 3 tiendas con administración central.', sucursales_incluidas = 3, orden = 2, destacado = TRUE, etiqueta = 'Más popular',
    funciones = ARRAY[
      'Todo lo del plan Básico',
      'Hasta 3 sucursales con administración central',
      'Inventario, precios y cajas propios en cada sucursal, sincronizados solos',
      'Ofertas y cupones: 2x1, por volumen, por horario y con tope de unidades',
      'Verificador de precios en pantalla y consulta por QR desde el celular',
      'Traspasos entre tiendas, conteos a ciegas, lotes y vencimientos',
      'Cierres de caja y resumen diario por correo',
      'Delivery con liquidación del repartidor',
      'Verificación en 2 pasos y equipos autorizados',
      'Respaldos cifrados',
      'Soporte por WhatsApp']
 WHERE codigo = 'profesional';

UPDATE portal_planes SET
    descripcion = 'Cadenas: 10 tiendas o más y soporte prioritario.', sucursales_incluidas = 10, orden = 3, destacado = FALSE, etiqueta = NULL,
    funciones = ARRAY[
      'Todo lo del plan Profesional',
      '10 sucursales o más (se pueden agregar más)',
      'Dirección propia que no cambia: su-empresa.factpos.app',
      'Reportes consolidados y comparación entre sucursales',
      'Avisos de incidentes al servicio técnico',
      'Respaldo extra en la nube',
      'Soporte prioritario y ayuda con la instalación']
 WHERE codigo = 'multisucursal';
