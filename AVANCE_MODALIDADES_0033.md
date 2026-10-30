# Avance de integración: selector de caja y ticket

Se incorpora en Cobro el selector E31/E32/B01/B02/SIN y se envía al servidor, donde la numeración transaccional ya estaba preparada. El ticket identifica el NCF, e-NCF o número interno y no intenta mostrar QR ni firma electrónica para facturas B/SIN. El número de venta sigue siendo independiente.

## Pendiente y limitaciones

- No se habilitaron todavía pantallas administrativas para gestionar rangos NCF; B01/B02 fallan si no existen rangos autorizados cargados en la base.
- Falta resolver anulación y corrección de B01/B02/SIN, restricciones de modalidad por empresa, políticas fiscales y sincronización/contingencia para estas modalidades.
- No se han ejecutado pruebas de compilación ni integración (no hay node_modules instalados en el paquete de origen).
- No ejecutar migraciones en producción sin respaldo, pruebas y revisión fiscal.
