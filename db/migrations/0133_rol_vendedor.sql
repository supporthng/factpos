-- =====================================================================
-- 0133 · Rol «Vendedor» listo para usar
--   Arma la venta y la envía a una caja para cobrar, prepara cotizaciones y consulta existencias de las sucursales.
--   No ve compras, precios, reportes ni cierres.
-- =====================================================================
INSERT INTO roles (id, empresa_id, nombre, permisos)
SELECT gen_random_uuid(), e.id, 'Vendedor', ARRAY['admin.vender', 'admin.cotizaciones']
  FROM empresas e
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.empresa_id = e.id AND lower(r.nombre) = 'vendedor');
