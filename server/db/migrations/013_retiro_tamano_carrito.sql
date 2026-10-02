-- Pedidos del cliente del 01-10-2026:
--  1) Dirección de RETIRO: el repartidor necesita saber dónde retirar el paquete (no solo dónde entregarlo).
--  2) Paquete simplificado: el cliente solo marca "estándar" o "sobredimensionado" (sin pesar ni medir).
--  3) Carrito: varios envíos se pagan con UNA transferencia y un solo comprobante (un "lote").
--  4) GPS opcional al entregar: sin señal también se puede cerrar la entrega.

-- 1) Dirección de retiro de cada envío y la predeterminada de cada cliente.
ALTER TABLE envio
  ADD COLUMN retiro_calle      TEXT,
  ADD COLUMN retiro_numero     TEXT,
  ADD COLUMN retiro_depto      TEXT,
  ADD COLUMN retiro_referencia TEXT,
  ADD COLUMN retiro_comuna_id  INTEGER REFERENCES comuna(id);
ALTER TABLE usuario
  ADD COLUMN retiro_calle      TEXT,
  ADD COLUMN retiro_numero     TEXT,
  ADD COLUMN retiro_depto      TEXT,
  ADD COLUMN retiro_referencia TEXT,
  ADD COLUMN retiro_comuna_id  INTEGER REFERENCES comuna(id);

-- 2) Tamaño declarado. Con tamaño, el peso y las medidas pasan a ser opcionales.
ALTER TABLE envio ADD COLUMN tamano TEXT CHECK (tamano IN ('estandar', 'sobredimensionado'));
ALTER TABLE envio ALTER COLUMN peso_kg DROP NOT NULL, ALTER COLUMN largo_cm DROP NOT NULL,
  ALTER COLUMN ancho_cm DROP NOT NULL, ALTER COLUMN alto_cm DROP NOT NULL;
ALTER TABLE envio ADD CONSTRAINT envio_tamano_o_medidas
  CHECK (tamano IS NOT NULL OR (peso_kg IS NOT NULL AND largo_cm IS NOT NULL AND ancho_cm IS NOT NULL AND alto_cm IS NOT NULL)) NOT VALID;

-- 3) Lote de pago: todos los pagos de un mismo comprobante comparten el lote y se aprueban o rechazan juntos.
ALTER TABLE pago ADD COLUMN lote TEXT;
CREATE INDEX pago_lote_idx ON pago (lote) WHERE lote IS NOT NULL;

-- 4) GPS opcional (se puede volver a exigir en Tarifas y reglas).
UPDATE config SET valor = jsonb_set(valor, '{gps_obligatorio}', 'false'::jsonb) WHERE clave = 'operacion';
