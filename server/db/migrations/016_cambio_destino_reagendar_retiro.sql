-- Pedidos del cliente del 07-10-2026:
--  1) Cambiar la dirección de destino antes de que el repartidor retire el paquete, aunque ya esté pagado.
--  2) Reagendar el retiro cuando el repartidor ya tomó el servicio: el cliente elige otro día (9:00 a 13:00 hrs).

-- Día de retiro elegido al reagendar (sin fecha = el día siguiente a la confirmación, según el horario de retiro).
ALTER TABLE envio
  ADD COLUMN IF NOT EXISTS retiro_fecha        DATE,
  ADD COLUMN IF NOT EXISTS retiro_reagendado   INTEGER NOT NULL DEFAULT 0 CHECK (retiro_reagendado >= 0),
  ADD COLUMN IF NOT EXISTS destino_cambiado    INTEGER NOT NULL DEFAULT 0 CHECK (destino_cambiado >= 0);
