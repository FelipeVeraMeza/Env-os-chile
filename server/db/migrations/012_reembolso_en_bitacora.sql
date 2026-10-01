-- El reembolso de un envío queda en la bitácora del pago que se devuelve (respaldo ante reclamos y para que
-- Cobranza descuente lo devuelto). Antes solo quedaba en la ficha del envío.
ALTER TABLE pago_evento DROP CONSTRAINT IF EXISTS pago_evento_tipo_check;
ALTER TABLE pago_evento ADD CONSTRAINT pago_evento_tipo_check
  CHECK (tipo IN ('inicio', 'notificacion', 'verificacion', 'rechazo', 'conciliacion', 'reembolso'));
