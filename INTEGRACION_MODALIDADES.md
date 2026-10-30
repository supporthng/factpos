# Integración inicial de modalidades de facturación

Se conserva `ventas.numero_interno` como consecutivo general por caja. La migración 0032 agrega `ventas.numero_documento` para la numeración visible, rangos B01/B02 configurables y contador FI independiente por sucursal. La emisión E31/E32 mantiene el motor e-CF existente; B01/B02/SIN no llaman al emisor electrónico.

## Estado y límites

Esta es una **base técnica de integración**, no un despliegue listo para producción. Aún falta: interfaz para seleccionar modalidad en terminal; administración segura de rangos B (carga, autorizaciones y control de solapamientos); impresión de números B/FI; adaptación de anulaciones y notas de crédito para B/FI; reglas de contingencia, delivery y sincronización con nube; pruebas de migración, integración y fiscalidad. La migración no debe aplicarse en producción sin copia de seguridad y pruebas. La elección de modalidad debe obedecer a la habilitación fiscal de cada empresa, no al deseo del cajero.

## Cambios

- `db/migrations/0032_modalidades_facturacion.sql`
- `apps/servidor/src/fiscal/numeracion-modalidades.ts`
- `apps/servidor/src/rutas/ventas.ts`
- `apps/servidor/src/rutas/facturas.ts`

La función de asignación opera en la misma transacción que la venta. Si falla, se revierte el contador. La secuencia e-CF no se altera.
