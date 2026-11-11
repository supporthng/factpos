-- Usuarios que entraron con una contraseña inicial y deben cambiarla antes de usar la administración.
-- Va en una tabla aparte (no en «usuarios») para no tocar lo que se sincroniza con las sucursales.
CREATE TABLE IF NOT EXISTS usuarios_clave_temporal (
    usuario_id  UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    creada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
