-- Promesas de pago: cuándo y cuánto prometió pagar un cliente. Si cumple se detecta por los abonos que entren después de la promesa.
CREATE TABLE cxc_promesas (
    id              UUID PRIMARY KEY,
    empresa_id      UUID NOT NULL REFERENCES empresas(id),
    cliente_id      UUID NOT NULL REFERENCES clientes(id),
    monto           NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    fecha_promesa   DATE NOT NULL,
    nota            TEXT,
    cancelada       BOOLEAN NOT NULL DEFAULT FALSE,
    usuario_id      UUID REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_cxc_promesas_cliente ON cxc_promesas (cliente_id, fecha_promesa);
CREATE INDEX ix_cxc_promesas_empresa ON cxc_promesas (empresa_id, fecha_promesa) WHERE NOT cancelada;

-- Con su estado: CUMPLIDA (los abonos desde que se anotó alcanzan el monto), VENCIDA (pasó la fecha sin cumplir), PENDIENTE o CANCELADA
CREATE OR REPLACE VIEW rpt_cxc_promesas AS
SELECT p.id, p.empresa_id, p.cliente_id, cl.nombre AS cliente, cl.telefono, p.monto, p.fecha_promesa, p.nota, p.creado_en,
       COALESCE(ab.cobrado, 0) AS cobrado,
       CASE WHEN p.cancelada THEN 'CANCELADA'
            WHEN COALESCE(ab.cobrado, 0) >= p.monto THEN 'CUMPLIDA'
            WHEN p.fecha_promesa < (now() AT TIME ZONE 'America/Santo_Domingo')::date THEN 'VENCIDA'
            ELSE 'PENDIENTE' END AS estado
  FROM cxc_promesas p
  JOIN clientes cl ON cl.id = p.cliente_id
  LEFT JOIN LATERAL (SELECT -SUM(m.monto) AS cobrado FROM cxc_movimientos m
                      WHERE m.cliente_id = p.cliente_id AND m.tipo = 'ABONO' AND m.monto < 0 AND m.creado_en >= p.creado_en) ab ON TRUE;
