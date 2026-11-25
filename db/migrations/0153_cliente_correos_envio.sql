-- Correos a los que se envían las facturas de un cliente: la próxima vez que se le envíe, el sistema ofrece los mismos
-- (se pueden agregar o quitar). Se guarda lo último que se usó. No se sincroniza.
CREATE TABLE IF NOT EXISTS cliente_correos_envio (
    cliente_id     UUID PRIMARY KEY REFERENCES clientes(id) ON DELETE CASCADE,
    correos        TEXT[] NOT NULL,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
