-- Reglas de integridad que antes solo validaba la API. Se agregan NOT VALID: rigen para todo dato
-- nuevo o modificado, sin impedir que el servidor arranque si hubiera un registro antiguo distinto.

-- Paquete: medidas y peso positivos, montos no negativos.
ALTER TABLE envio ADD CONSTRAINT envio_medidas_positivas
  CHECK (peso_kg > 0 AND largo_cm > 0 AND ancho_cm > 0 AND alto_cm > 0) NOT VALID;
ALTER TABLE envio ADD CONSTRAINT envio_montos_no_negativos
  CHECK (tarifa_base >= 0 AND recargo_bultos >= 0 AND recargo_horario >= 0 AND tarifa_total >= 0 AND intentos >= 0) NOT VALID;

-- Todo envío confirmado tiene folio, y los que están en manos de un repartidor tienen repartidor.
ALTER TABLE envio ADD CONSTRAINT envio_confirmado_con_folio
  CHECK (estado = 'borrador' OR folio IS NOT NULL) NOT VALID;
ALTER TABLE envio ADD CONSTRAINT envio_con_repartidor
  CHECK (estado NOT IN ('asignado', 'en_ruta', 'reagendado') OR repartidor_id IS NOT NULL) NOT VALID;

-- Entregado implica fecha de entrega; punto courier implica empresa y punto; horario especial implica franja.
ALTER TABLE envio ADD CONSTRAINT envio_entregado_con_fecha
  CHECK (estado <> 'entregado' OR entregado_en IS NOT NULL) NOT VALID;
ALTER TABLE envio ADD CONSTRAINT envio_punto_courier_completo
  CHECK (tipo_destino <> 'punto_courier' OR (courier_empresa IS NOT NULL AND courier_punto IS NOT NULL)) NOT VALID;
ALTER TABLE envio ADD CONSTRAINT envio_horario_con_franja
  CHECK (NOT horario_especial OR franja_horaria IS NOT NULL) NOT VALID;

-- Pagado implica fecha de pago; el pago es por el monto exacto del envío.
ALTER TABLE envio ADD CONSTRAINT envio_pagado_con_fecha
  CHECK (estado_pago <> 'pagado' OR pagado_en IS NOT NULL) NOT VALID;
ALTER TABLE pago ADD CONSTRAINT pago_monto_no_negativo CHECK (monto >= 0) NOT VALID;

-- Coordenadas GPS dentro de rango.
ALTER TABLE envio ADD CONSTRAINT envio_gps_valido
  CHECK ((entrega_lat IS NULL OR entrega_lat BETWEEN -90 AND 90) AND (entrega_lon IS NULL OR entrega_lon BETWEEN -180 AND 180)) NOT VALID;

-- Índices para las consultas más frecuentes (listados del cliente y del repartidor, disponibles, historial).
CREATE INDEX IF NOT EXISTS envio_disponibles_idx ON envio (estado, estado_pago) WHERE repartidor_id IS NULL;
CREATE INDEX IF NOT EXISTS envio_cliente_creado_idx ON envio (cliente_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS envio_repartidor_estado_idx ON envio (repartidor_id, estado);
CREATE INDEX IF NOT EXISTS auditoria_fecha_idx ON auditoria (fecha);
CREATE INDEX IF NOT EXISTS reclamo_estado_idx ON reclamo_seguro (estado);
