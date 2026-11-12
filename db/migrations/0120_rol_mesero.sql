-- =====================================================================
-- 0120 · Rol «Mesero» listo para usar en restaurantes, bares y discotecas
--   Solo entra al salón con su PIN: toma pedidos de sus mesas y pide la pre-cuenta (no abre turno ni cobra).
-- =====================================================================
INSERT INTO roles (id, empresa_id, nombre, permisos)
SELECT gen_random_uuid(), e.id, 'Mesero', ARRAY['salon.mesero']
  FROM empresas e
 WHERE e.tipo_negocio IS DISTINCT FROM 'TIENDA'
   AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.empresa_id = e.id AND lower(r.nombre) = 'mesero');
