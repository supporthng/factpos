-- La sucursal avisa a la nube si envía sus cierres con su propia cuenta de correo;
-- así la nube (cuenta de toda la empresa) no los manda otra vez.
ALTER TABLE sync_sucursales ADD COLUMN IF NOT EXISTS correo_propio boolean NOT NULL DEFAULT false;
