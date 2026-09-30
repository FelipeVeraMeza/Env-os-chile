-- Operación con muchos usuarios a la vez y funciones operativas (septiembre 2026).

-- Un solo reclamo activo por envío, garantizado por la base aunque dos personas lo pidan a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS reclamo_activo_unico ON reclamo_seguro (envio_id) WHERE estado <> 'rechazado';

-- Orden de la ruta que define el repartidor (RF-60).
ALTER TABLE envio ADD COLUMN IF NOT EXISTS orden_ruta INTEGER;

-- Reembolso del pago (RF-57): el envío queda con estado_pago = 'reembolsado'.
ALTER TABLE envio ADD COLUMN IF NOT EXISTS reembolso_monto INTEGER CHECK (reembolso_monto IS NULL OR reembolso_monto > 0);
ALTER TABLE envio ADD COLUMN IF NOT EXISTS reembolso_medio TEXT;
ALTER TABLE envio ADD COLUMN IF NOT EXISTS reembolso_nota TEXT;
ALTER TABLE envio ADD COLUMN IF NOT EXISTS reembolsado_en TIMESTAMPTZ;
ALTER TABLE envio ADD CONSTRAINT envio_reembolso_tope CHECK (reembolso_monto IS NULL OR reembolso_monto <= tarifa_total);

-- Derechos del titular de datos (RF-58, Ley 21.719).
ALTER TABLE destinatario ADD COLUMN IF NOT EXISTS anonimizado_en TIMESTAMPTZ;

-- Al cambiar la contraseña, los enlaces de restablecimiento anteriores dejan de servir (RF-02).
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS password_cambiado_en TIMESTAMPTZ;

-- Índices para muchos usuarios y 100.000 envíos (RNF-09).
CREATE INDEX IF NOT EXISTS envio_comuna_idx ON envio (comuna_id);
CREATE INDEX IF NOT EXISTS envio_repartidor_estado_idx ON envio (repartidor_id, estado);
CREATE INDEX IF NOT EXISTS envio_entregado_idx ON envio (entregado_en) WHERE estado = 'entregado';
CREATE INDEX IF NOT EXISTS envio_pagado_idx ON envio (pagado_en) WHERE estado_pago = 'pagado';
CREATE INDEX IF NOT EXISTS auditoria_entidad_idx ON auditoria (entidad, entidad_id);
CREATE INDEX IF NOT EXISTS auditoria_fecha_idx ON auditoria (fecha DESC);
CREATE INDEX IF NOT EXISTS pago_envio_idx ON pago (envio_id);

-- El QR del ticket abre Google Maps con la dirección (pedido del cliente, 26-09-2026).
UPDATE config SET valor = jsonb_set(valor, '{qr_destino}', '"google"') WHERE clave = 'operacion' AND valor->>'qr_destino' = 'pagina';
