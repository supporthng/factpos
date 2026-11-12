-- =====================================================================
-- 0121 · Planes de facturación electrónica con el proveedor MSeller (ecf.mseller.app)
--   costo_usd = lo que cobra MSeller por cuenta de cliente al mes (cada cliente tiene su propia cuenta y plan en MSeller).
--   precio_usd = lo que se cobra al cliente de FactPOS: propuesta con 50 % de margen, editable en el portal.
--   Los planes anteriores se conservan (los clientes que ya los tienen no cambian).
-- =====================================================================
INSERT INTO portal_ecf_planes (id, codigo, nombre, max_mes, costo_usd, precio_usd, orden)
SELECT gen_random_uuid(), v.codigo, v.nombre, v.max_mes, v.costo, v.precio, v.orden FROM (VALUES
    ('ms-gratis',    'Gratis (hasta 250)',          250,   0,   0,   10),
    ('ms-emprende',  'Emprende (hasta 500)',        500,   15,  23,  11),
    ('ms-basico',    'Básico (hasta 1,000)',        1000,  24,  36,  12),
    ('ms-negocio',   'Negocio (hasta 2,500)',       2500,  41,  62,  13),
    ('ms-avanzado',  'Avanzado (hasta 6,000)',      6000,  84,  126, 14),
    ('ms-empresa',   'Empresa (hasta 10,000)',      10000, 128, 192, 15)
) AS v(codigo, nombre, max_mes, costo, precio, orden)
WHERE NOT EXISTS (SELECT 1 FROM portal_ecf_planes p WHERE p.codigo = v.codigo);
