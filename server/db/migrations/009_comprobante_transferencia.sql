-- Pago por transferencia con comprobante: el cliente sube la imagen de la transferencia, el pago queda
-- "en revisión" y administración lo aprueba o lo rechaza (con motivo). Si se rechaza, el cliente sube
-- un comprobante nuevo. El pago manda en todo: sin pago aprobado no hay ticket, ni asignación, ni retiro.
-- Pendiente a futuro: emitir la boleta electrónica en el SII al aprobar el pago (docs/14, D-13).

-- El envío muestra que su pago está en revisión mientras administración mira el comprobante.
ALTER TABLE envio DROP CONSTRAINT IF EXISTS envio_estado_pago_check;
ALTER TABLE envio ADD CONSTRAINT envio_estado_pago_check
  CHECK (estado_pago IN ('pendiente', 'en_revision', 'pagado', 'reembolsado'));

-- El pago por transferencia pasa por "en_revision" antes de quedar aprobado o rechazado.
ALTER TABLE pago DROP CONSTRAINT IF EXISTS pago_estado_check;
ALTER TABLE pago ADD CONSTRAINT pago_estado_check
  CHECK (estado IN ('iniciado', 'en_revision', 'aprobado', 'rechazado', 'anulado'));

-- La imagen del comprobante es un adjunto más del envío (bucket privado, enlace firmado).
ALTER TABLE adjunto DROP CONSTRAINT IF EXISTS adjunto_tipo_check;
ALTER TABLE adjunto ADD CONSTRAINT adjunto_tipo_check
  CHECK (tipo IN ('foto_paquete', 'foto_entrega', 'boleta', 'comprobante_pago'));

ALTER TABLE pago
  ADD COLUMN comprobante_adjunto_id INTEGER REFERENCES adjunto(id),
  ADD COLUMN revisado_por           INTEGER REFERENCES usuario(id),
  ADD COLUMN revisado_en            TIMESTAMPTZ,
  ADD COLUMN motivo_rechazo         TEXT;

-- Un pago en revisión siempre tiene su comprobante, y un rechazo siempre dice por qué.
ALTER TABLE pago ADD CONSTRAINT pago_revision_con_comprobante
  CHECK (estado <> 'en_revision' OR comprobante_adjunto_id IS NOT NULL);
ALTER TABLE pago ADD CONSTRAINT pago_rechazo_con_motivo
  CHECK (comprobante_adjunto_id IS NULL OR estado <> 'rechazado' OR motivo_rechazo IS NOT NULL);
-- Un solo comprobante en revisión por envío a la vez.
CREATE UNIQUE INDEX pago_en_revision_unico ON pago (envio_id) WHERE estado = 'en_revision';
CREATE INDEX pago_en_revision_idx ON pago (creado_en) WHERE estado = 'en_revision';

-- Regla dura: un envío solo queda en manos de un repartidor si está pagado. NOT VALID para no
-- impedir el arranque si hubiera un registro antiguo asignado sin pago.
ALTER TABLE envio ADD CONSTRAINT envio_asignado_pagado
  CHECK (estado NOT IN ('asignado', 'en_ruta', 'reagendado') OR estado_pago IN ('pagado', 'reembolsado')) NOT VALID;
