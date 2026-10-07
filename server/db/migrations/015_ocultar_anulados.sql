-- Pedido del cliente del 07-10-2026: un envío anulado deja de aparecer en la cuenta del cliente 24 horas después
-- de anularse, o antes si el cliente lo elimina. No se borra de la base: administración lo sigue viendo
-- (cobranza, reportes, historial) y al reactivarlo vuelve a aparecer.
ALTER TABLE envio ADD COLUMN IF NOT EXISTS oculto_cliente_en TIMESTAMPTZ;
