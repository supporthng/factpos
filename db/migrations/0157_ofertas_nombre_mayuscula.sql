-- Los nombres de las ofertas van siempre en mayúsculas (desde ahora se guardan así; esto convierte las que ya existían).
UPDATE ofertas SET nombre = upper(nombre) WHERE nombre <> upper(nombre);
