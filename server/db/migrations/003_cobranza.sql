-- Cobranza y verificación de pagos. Ver docs/15-diagnostico-envios-y-cobranza.md
-- Objetivo: que "pagado" signifique que el dinero realmente se cobró (verificado con el proveedor
-- o por administración), saber cuánto se lleva la pasarela y cuándo llega el abono a la cuenta.

-- Cada cobro (en línea o manual) queda como una fila de "pago" con su verificación y conciliación.
ALTER TABLE pago
  ADD COLUMN medio             TEXT,             -- en_linea, transferencia, efectivo, otro
  ADD COLUMN transaccion_id    TEXT,             -- identificador del pago en la pasarela
  ADD COLUMN comision_estimada INTEGER NOT NULL DEFAULT 0 CHECK (comision_estimada >= 0),
  ADD COLUMN neto_estimado     INTEGER,
  ADD COLUMN verificacion      TEXT CHECK (verificacion IN ('simulado', 'webhook', 'consulta_api', 'manual')),
  ADD COLUMN verificado_en     TIMESTAMPTZ,
  ADD COLUMN verificado_por    INTEGER REFERENCES usuario(id),
  ADD COLUMN abono_estimado_en DATE,
  ADD COLUMN monto_abonado     INTEGER CHECK (monto_abonado >= 0),
  ADD COLUMN comision_real     INTEGER CHECK (comision_real >= 0),
  ADD COLUMN abonado_en        DATE,
  ADD COLUMN conciliado_por    INTEGER REFERENCES usuario(id),
  ADD COLUMN creado_por        INTEGER REFERENCES usuario(id);

-- Pagos simulados que ya estaban aprobados: quedan verificados por el simulador.
UPDATE pago SET verificacion = 'simulado', verificado_en = actualizado_en, medio = 'en_linea',
  transaccion_id = COALESCE(transaccion_id, referencia), neto_estimado = monto
WHERE estado = 'aprobado';

-- Pagos manuales registrados antes de este cambio: se les crea su fila de pago verificada.
INSERT INTO pago (envio_id, proveedor, medio, monto, estado, token, referencia, verificacion, verificado_en, neto_estimado, creado_en, actualizado_en)
SELECT e.id, 'manual', e.pago_medio, e.tarifa_total, 'aprobado', gen_random_uuid()::text, e.pago_referencia,
       'manual', COALESCE(e.pagado_en, now()), e.tarifa_total, COALESCE(e.pagado_en, now()), COALESCE(e.pagado_en, now())
FROM envio e
WHERE e.estado_pago = 'pagado'
  AND NOT EXISTS (SELECT 1 FROM pago p WHERE p.envio_id = e.id AND p.estado = 'aprobado');

-- Un pago aprobado siempre está verificado, y un envío no se cobra dos veces.
ALTER TABLE pago ADD CONSTRAINT pago_aprobado_verificado CHECK (estado <> 'aprobado' OR verificado_en IS NOT NULL);
ALTER TABLE pago ADD CONSTRAINT pago_conciliado_cuadra CHECK (abonado_en IS NULL OR monto_abonado + comision_real = monto);
CREATE UNIQUE INDEX pago_aprobado_unico ON pago (envio_id) WHERE estado = 'aprobado';
CREATE UNIQUE INDEX pago_transaccion_unica ON pago (proveedor, transaccion_id) WHERE transaccion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pago_envio_idx ON pago (envio_id);

-- Bitácora inmutable de todo lo que informa la pasarela o hace administración sobre un pago
-- (inicio, notificación, verificación, rechazo, conciliación). Sirve de respaldo ante reclamos.
CREATE TABLE pago_evento (
  id               BIGSERIAL PRIMARY KEY,
  pago_id          INTEGER NOT NULL REFERENCES pago(id),
  tipo             TEXT NOT NULL CHECK (tipo IN ('inicio', 'notificacion', 'verificacion', 'rechazo', 'conciliacion')),
  estado_informado TEXT,
  monto_informado  INTEGER,
  firma_valida     BOOLEAN,
  datos            JSONB,
  usuario_id       INTEGER REFERENCES usuario(id),
  fecha            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pago_evento_pago_idx ON pago_evento (pago_id);
ALTER TABLE pago_evento ENABLE ROW LEVEL SECURITY;

-- La comisión que cobra la pasarela es un costo y descuenta de la ganancia neta.
ALTER TABLE costo DROP CONSTRAINT IF EXISTS costo_tipo_check;
ALTER TABLE costo ADD CONSTRAINT costo_tipo_check
  CHECK (tipo IN ('bencina', 'comision', 'peaje', 'mantencion', 'seguro', 'pasarela', 'otro'));
ALTER TABLE costo ADD COLUMN pago_id INTEGER REFERENCES pago(id);

-- Regla dura en la base: un envío solo pasa a "pagado" si existe un pago aprobado y verificado.
CREATE FUNCTION envio_exige_pago_verificado() RETURNS trigger AS $fn$
BEGIN
  IF NEW.estado_pago = 'pagado' AND OLD.estado_pago IS DISTINCT FROM 'pagado' AND NOT EXISTS (
    SELECT 1 FROM pago WHERE envio_id = NEW.id AND estado = 'aprobado' AND verificado_en IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'El envío % no tiene un pago verificado', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'envio_pago_verificado';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER envio_pago_verificado BEFORE UPDATE OF estado_pago ON envio
  FOR EACH ROW EXECUTE FUNCTION envio_exige_pago_verificado();
