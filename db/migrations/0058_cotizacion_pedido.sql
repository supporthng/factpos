-- Una cotización aceptada puede convertirse en pedido de cliente (se alista y se factura desde la caja).
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS pedido_id UUID REFERENCES pedidos_clientes(id);
