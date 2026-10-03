-- Pedidos del cliente del 03-10-2026:
--  1) Firma del destinatario en la pantalla del repartidor al entregar (queda como un adjunto más del envío).
--  2) Aviso antes de que un envío sin pagar se anule solo: se guarda cuándo se avisó para no repetirlo.
--  3) Reactivar un envío anulado por falta de pago: se guarda cuándo se reactivó (reinicia el plazo de pago).

ALTER TABLE adjunto DROP CONSTRAINT IF EXISTS adjunto_tipo_check;
ALTER TABLE adjunto ADD CONSTRAINT adjunto_tipo_check
  CHECK (tipo IN ('foto_paquete', 'foto_entrega', 'boleta', 'comprobante_pago', 'firma_entrega'));

ALTER TABLE envio
  ADD COLUMN aviso_vencimiento_en TIMESTAMPTZ,
  ADD COLUMN reactivado_en        TIMESTAMPTZ;
