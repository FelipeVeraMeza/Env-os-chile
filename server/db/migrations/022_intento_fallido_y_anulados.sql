-- Pedidos del cliente del 22-10-2026:
--  1) Intento fallido con foto: el repartidor saca una foto en cada intento fallido y el seguimiento la muestra bajo ese
--     intento. La foto queda ligada al paso del historial (envio_estado) que registró el intento.
--  2) El seguimiento muestra cuánto esperó el repartidor en el destino: se guarda en el paso del historial la hora en que
--     tocó "Llegué al destino" (antes se borraba de envio.llegada_en al registrar el fallido).
--  3) Los anulados dejan de hacer ruido en la lista de administración: se ocultan 24 h después de anularse o antes si
--     administración los elimina de la lista. No se borran de la base (cobranza, reportes, historial, filtro "Anulado").

ALTER TABLE adjunto DROP CONSTRAINT IF EXISTS adjunto_tipo_check;
ALTER TABLE adjunto ADD CONSTRAINT adjunto_tipo_check
  CHECK (tipo IN ('foto_paquete', 'foto_entrega', 'boleta', 'comprobante_pago', 'firma_entrega', 'foto_fallido'));
ALTER TABLE adjunto ADD COLUMN IF NOT EXISTS envio_estado_id INTEGER REFERENCES envio_estado(id);

ALTER TABLE envio_estado ADD COLUMN IF NOT EXISTS llegada_en TIMESTAMPTZ;

ALTER TABLE envio ADD COLUMN IF NOT EXISTS oculto_admin_en TIMESTAMPTZ;
