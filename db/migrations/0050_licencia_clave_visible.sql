-- La clave de activación (FPS-…) se guarda en la nube del cliente para mostrarla en Administración › Licencia.
ALTER TABLE licencia ADD COLUMN IF NOT EXISTS clave_activacion TEXT;
