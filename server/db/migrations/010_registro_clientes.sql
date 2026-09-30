-- Los clientes crean su cuenta desde la pantalla de ingreso ("Crear cuenta de cliente"), pedido del cliente 30-09-2026.
-- Se activa una sola vez; administración puede volver a cerrarlo en Tarifas y reglas.
UPDATE config SET valor = jsonb_set(valor, '{registro_clientes}', 'true'::jsonb) WHERE clave = 'operacion';
