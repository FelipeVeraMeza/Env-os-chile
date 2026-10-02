-- =============================================================================
--  PLATAFORMA DE GESTIÓN DE ENVÍOS · BASE DE DATOS COMPLETA PARA SUPABASE
--  Generado por: npm run sql:supabase   (no editar a mano)
--
--  CÓMO USARLO: Supabase → SQL Editor → New query → pegar TODO este archivo → Run.
--  Se puede ejecutar más de una vez: si la base ya existe, no hace nada.
--
--  Crea: 14 migraciones, seguridad RLS, 346 comunas de Chile (34 en cobertura
--  dentro de Santiago), tarifas ($3.500 base, +$1.000 horario especial, 20 kg / 60 cm),
--  reglas de operación (3 intentos, 5 min de espera) y el bucket privado de fotos y boletas.
--  Los usuarios los crea la app en su primer arranque (ADMIN_EMAIL / ADMIN_PASSWORD en Railway).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migracion (
  nombre TEXT PRIMARY KEY,
  aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Migración 001_inicial.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '001_inicial.sql') THEN
    -- Plataforma de Gestión de Envíos · esquema inicial
    -- Ver docs/06-consideraciones-tecnicas.md (modelo de datos)

    CREATE TABLE usuario (
      id            SERIAL PRIMARY KEY,
      nombre        TEXT NOT NULL,
      correo        TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      rol           TEXT NOT NULL CHECK (rol IN ('admin', 'cliente', 'repartidor')),
      telefono      TEXT,
      rut           TEXT,
      activo        BOOLEAN NOT NULL DEFAULT TRUE,
      creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE zona (
      id      SERIAL PRIMARY KEY,
      nombre  TEXT NOT NULL UNIQUE,
      tarifa  INTEGER NOT NULL CHECK (tarifa >= 0),
      color   TEXT,
      orden   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE comuna (
      id            SERIAL PRIMARY KEY,
      nombre        TEXT NOT NULL,
      provincia     TEXT NOT NULL,
      region        TEXT NOT NULL,
      zona_id       INTEGER REFERENCES zona(id),
      en_cobertura  BOOLEAN NOT NULL DEFAULT FALSE,
      tarifa_base   INTEGER CHECK (tarifa_base >= 0),
      UNIQUE (nombre, region)
    );

    -- Libreta de destinatarios del cliente: un destinatario puede tener varias direcciones.
    CREATE TABLE destinatario (
      id             SERIAL PRIMARY KEY,
      cliente_id     INTEGER NOT NULL REFERENCES usuario(id),
      nombre         TEXT NOT NULL,
      telefono       TEXT NOT NULL,
      correo         TEXT,
      rut            TEXT,
      notas          TEXT,
      creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX destinatario_cliente_idx ON destinatario (cliente_id);

    CREATE TABLE direccion (
      id              SERIAL PRIMARY KEY,
      destinatario_id INTEGER NOT NULL REFERENCES destinatario(id),
      alias           TEXT,
      calle           TEXT NOT NULL,
      numero          TEXT NOT NULL,
      depto           TEXT,
      referencia      TEXT,
      comuna_id       INTEGER NOT NULL REFERENCES comuna(id),
      lat             DOUBLE PRECISION,
      lon             DOUBLE PRECISION,
      es_principal    BOOLEAN NOT NULL DEFAULT FALSE,
      activa          BOOLEAN NOT NULL DEFAULT TRUE,
      creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX direccion_destinatario_idx ON direccion (destinatario_id);

    CREATE TABLE folio_contador (
      prefijo TEXT NOT NULL,
      anio    INTEGER NOT NULL,
      ultimo  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (prefijo, anio)
    );

    CREATE TABLE envio (
      id                  SERIAL PRIMARY KEY,
      folio               TEXT UNIQUE,
      token_qr            TEXT NOT NULL UNIQUE,
      cliente_id          INTEGER NOT NULL REFERENCES usuario(id),
      destinatario_id     INTEGER NOT NULL REFERENCES destinatario(id),
      direccion_id        INTEGER NOT NULL REFERENCES direccion(id),
      comuna_id           INTEGER NOT NULL REFERENCES comuna(id),
      tipo_destino        TEXT NOT NULL DEFAULT 'domicilio' CHECK (tipo_destino IN ('domicilio', 'punto_courier')),
      courier_empresa     TEXT,
      courier_punto       TEXT,
      courier_codigo      TEXT,
      descripcion_producto TEXT NOT NULL,
      bultos              INTEGER NOT NULL DEFAULT 1 CHECK (bultos >= 1),
      peso_kg             NUMERIC(6, 2) NOT NULL,
      largo_cm            INTEGER NOT NULL,
      ancho_cm            INTEGER NOT NULL,
      alto_cm             INTEGER NOT NULL,
      valor_declarado     INTEGER NOT NULL DEFAULT 0 CHECK (valor_declarado >= 0),
      horario_especial    BOOLEAN NOT NULL DEFAULT FALSE,
      franja_horaria      TEXT,
      tarifa_base         INTEGER NOT NULL,
      recargo_bultos      INTEGER NOT NULL DEFAULT 0,
      recargo_horario     INTEGER NOT NULL DEFAULT 0,
      tarifa_total        INTEGER NOT NULL,
      estado              TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN
                            ('borrador','creado','asignado','en_ruta','entregado','fallido','reagendado','devuelto','anulado')),
      estado_pago         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_pago IN ('pendiente','pagado','reembolsado')),
      pago_medio          TEXT,
      pago_referencia     TEXT,
      pagado_en           TIMESTAMPTZ,
      repartidor_id       INTEGER REFERENCES usuario(id),
      intentos            INTEGER NOT NULL DEFAULT 0,
      llegada_en          TIMESTAMPTZ,
      entrega_lat         DOUBLE PRECISION,
      entrega_lon         DOUBLE PRECISION,
      entrega_precision_m DOUBLE PRECISION,
      entrega_receptor    TEXT,
      observaciones       TEXT,
      creado_por          INTEGER NOT NULL REFERENCES usuario(id),
      creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmado_en       TIMESTAMPTZ,
      entregado_en        TIMESTAMPTZ,
      actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- Regla dura: no se retira ni se entrega un envío que no está pagado.
      CONSTRAINT envio_pagado_para_retirar CHECK (
        estado NOT IN ('en_ruta','entregado') OR estado_pago IN ('pagado','reembolsado')
      )
    );
    CREATE INDEX envio_estado_idx ON envio (estado);
    CREATE INDEX envio_cliente_idx ON envio (cliente_id);
    CREATE INDEX envio_repartidor_idx ON envio (repartidor_id);
    CREATE INDEX envio_creado_idx ON envio (creado_en);

    CREATE TABLE adjunto (
      id              SERIAL PRIMARY KEY,
      envio_id        INTEGER NOT NULL REFERENCES envio(id),
      tipo            TEXT NOT NULL CHECK (tipo IN ('foto_paquete','foto_entrega','boleta')),
      nombre_original TEXT,
      mime            TEXT NOT NULL,
      tamano          INTEGER NOT NULL,
      ruta            TEXT NOT NULL,
      sha256          TEXT NOT NULL,
      subido_por      INTEGER NOT NULL REFERENCES usuario(id),
      subido_en       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX adjunto_envio_idx ON adjunto (envio_id);

    CREATE TABLE envio_estado (
      id              SERIAL PRIMARY KEY,
      envio_id        INTEGER NOT NULL REFERENCES envio(id),
      estado_anterior TEXT,
      estado_nuevo    TEXT NOT NULL,
      motivo          TEXT,
      usuario_id      INTEGER REFERENCES usuario(id),
      lat             DOUBLE PRECISION,
      lon             DOUBLE PRECISION,
      fecha           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX envio_estado_envio_idx ON envio_estado (envio_id);

    CREATE TABLE pago (
      id          SERIAL PRIMARY KEY,
      envio_id    INTEGER NOT NULL REFERENCES envio(id),
      proveedor   TEXT NOT NULL,
      monto       INTEGER NOT NULL,
      estado      TEXT NOT NULL DEFAULT 'iniciado' CHECK (estado IN ('iniciado','aprobado','rechazado','anulado')),
      token       TEXT NOT NULL UNIQUE,
      referencia  TEXT,
      creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Reclamo de seguro: la boleta es OBLIGATORIA (NOT NULL a nivel de base de datos).
    CREATE TABLE reclamo_seguro (
      id                SERIAL PRIMARY KEY,
      numero            TEXT NOT NULL UNIQUE,
      envio_id          INTEGER NOT NULL REFERENCES envio(id),
      motivo            TEXT NOT NULL CHECK (motivo IN ('perdida','dano','robo','otro')),
      descripcion       TEXT,
      monto_reclamado   INTEGER NOT NULL CHECK (monto_reclamado > 0),
      boleta_adjunto_id INTEGER NOT NULL REFERENCES adjunto(id),
      boleta_numero     TEXT NOT NULL,
      boleta_fecha      DATE NOT NULL,
      boleta_monto      INTEGER NOT NULL CHECK (boleta_monto > 0),
      boleta_emisor_rut TEXT,
      estado            TEXT NOT NULL DEFAULT 'solicitado' CHECK (estado IN ('solicitado','en_revision','aprobado','rechazado','pagado')),
      monto_aprobado    INTEGER CHECK (monto_aprobado >= 0),
      resolucion_nota   TEXT,
      creado_por        INTEGER NOT NULL REFERENCES usuario(id),
      creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
      resuelto_por      INTEGER REFERENCES usuario(id),
      resuelto_en       TIMESTAMPTZ,
      pagado_en         TIMESTAMPTZ,
      CONSTRAINT reclamo_monto_tope CHECK (monto_reclamado <= boleta_monto),
      CONSTRAINT reclamo_aprobado_tope CHECK (monto_aprobado IS NULL OR monto_aprobado <= monto_reclamado)
    );
    CREATE INDEX reclamo_envio_idx ON reclamo_seguro (envio_id);

    CREATE TABLE costo (
      id          SERIAL PRIMARY KEY,
      fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
      tipo        TEXT NOT NULL CHECK (tipo IN ('bencina','comision','peaje','mantencion','seguro','otro')),
      monto       INTEGER NOT NULL CHECK (monto > 0),
      envio_id    INTEGER REFERENCES envio(id),
      reclamo_id  INTEGER REFERENCES reclamo_seguro(id),
      nota        TEXT,
      creado_por  INTEGER REFERENCES usuario(id),
      creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE config (
      clave TEXT PRIMARY KEY,
      valor JSONB NOT NULL
    );

    CREATE TABLE auditoria (
      id          BIGSERIAL PRIMARY KEY,
      usuario_id  INTEGER REFERENCES usuario(id),
      accion      TEXT NOT NULL,
      entidad     TEXT NOT NULL,
      entidad_id  TEXT,
      datos       JSONB,
      fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip          TEXT
    );
    INSERT INTO schema_migracion (nombre) VALUES ('001_inicial.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 002_seguridad_supabase.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '002_seguridad_supabase.sql') THEN
    -- En Supabase, las tablas del esquema "public" quedan expuestas por su API REST (Data API)
    -- a quien tenga la clave pública del proyecto. Activamos RLS sin políticas: la API de Supabase
    -- no puede leer ni escribir nada, y este servidor (dueño de las tablas) sigue funcionando igual.
    -- En un PostgreSQL normal (local o Railway) no tiene efecto práctico.
    ALTER TABLE usuario          ENABLE ROW LEVEL SECURITY;
    ALTER TABLE zona             ENABLE ROW LEVEL SECURITY;
    ALTER TABLE comuna           ENABLE ROW LEVEL SECURITY;
    ALTER TABLE destinatario     ENABLE ROW LEVEL SECURITY;
    ALTER TABLE direccion        ENABLE ROW LEVEL SECURITY;
    ALTER TABLE folio_contador   ENABLE ROW LEVEL SECURITY;
    ALTER TABLE envio            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE adjunto          ENABLE ROW LEVEL SECURITY;
    ALTER TABLE envio_estado     ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pago             ENABLE ROW LEVEL SECURITY;
    ALTER TABLE reclamo_seguro   ENABLE ROW LEVEL SECURITY;
    ALTER TABLE costo            ENABLE ROW LEVEL SECURITY;
    ALTER TABLE config           ENABLE ROW LEVEL SECURITY;
    ALTER TABLE auditoria        ENABLE ROW LEVEL SECURITY;
    ALTER TABLE schema_migracion ENABLE ROW LEVEL SECURITY;
    INSERT INTO schema_migracion (nombre) VALUES ('002_seguridad_supabase.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 003_cobranza.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '003_cobranza.sql') THEN
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
    INSERT INTO schema_migracion (nombre) VALUES ('003_cobranza.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 003_multiusuario_y_operacion.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '003_multiusuario_y_operacion.sql') THEN
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
    INSERT INTO schema_migracion (nombre) VALUES ('003_multiusuario_y_operacion.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 004_integridad.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '004_integridad.sql') THEN
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
    INSERT INTO schema_migracion (nombre) VALUES ('004_integridad.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 005_sesiones.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '005_sesiones.sql') THEN
    -- Inicio de sesión real (AUTH_MODE=jwt).
    -- sesion_version: al cambiar la contraseña sube en 1 y todas las sesiones anteriores dejan de servir.
    -- debe_cambiar_clave: la contraseña la puso administración; se pide cambiarla al entrar.
    ALTER TABLE usuario
      ADD COLUMN sesion_version     INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN debe_cambiar_clave BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN ultimo_acceso      TIMESTAMPTZ;
    INSERT INTO schema_migracion (nombre) VALUES ('005_sesiones.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 006_seguridad.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '006_seguridad.sql') THEN
    -- Sistema de seguridad: registro de eventos (quién hizo qué, desde dónde, cuántos datos se llevó)
    -- y alertas automáticas ante patrones de ataque. Ver docs/17-seguridad.md

    CREATE TABLE evento_seguridad (
      id          BIGSERIAL PRIMARY KEY,
      fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
      tipo        TEXT NOT NULL,
      nivel       TEXT NOT NULL DEFAULT 'info' CHECK (nivel IN ('info', 'aviso', 'alerta')),
      usuario_id  INTEGER REFERENCES usuario(id),
      correo      TEXT,          -- cuenta objetivo (p. ej. en un inicio de sesión fallido)
      ip          TEXT,
      agente      TEXT,          -- navegador / programa que hizo la petición
      ruta        TEXT,
      registros   INTEGER,       -- cuántos registros o archivos se extrajeron
      detalle     JSONB
    );
    CREATE INDEX evento_seguridad_fecha_idx ON evento_seguridad (fecha DESC);
    CREATE INDEX evento_seguridad_tipo_idx ON evento_seguridad (tipo, fecha DESC);
    CREATE INDEX evento_seguridad_ip_idx ON evento_seguridad (ip, fecha DESC);
    CREATE INDEX evento_seguridad_usuario_idx ON evento_seguridad (usuario_id, fecha DESC);
    CREATE INDEX evento_seguridad_correo_idx ON evento_seguridad (correo, fecha DESC) WHERE correo IS NOT NULL;

    CREATE TABLE alerta_seguridad (
      id            BIGSERIAL PRIMARY KEY,
      creada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
      ultima_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
      veces         INTEGER NOT NULL DEFAULT 1,
      regla         TEXT NOT NULL,
      nivel         TEXT NOT NULL CHECK (nivel IN ('aviso', 'alerta', 'critica')),
      titulo        TEXT NOT NULL,
      clave         TEXT NOT NULL,   -- agrupa repeticiones de la misma alerta mientras está abierta
      ip            TEXT,
      usuario_id    INTEGER REFERENCES usuario(id),
      detalle       JSONB,
      estado        TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'revisada')),
      revisada_por  INTEGER REFERENCES usuario(id),
      revisada_en   TIMESTAMPTZ,
      nota          TEXT
    );
    CREATE UNIQUE INDEX alerta_abierta_unica ON alerta_seguridad (clave) WHERE estado = 'abierta';
    CREATE INDEX alerta_estado_idx ON alerta_seguridad (estado, ultima_en DESC);

    ALTER TABLE evento_seguridad ENABLE ROW LEVEL SECURITY;
    ALTER TABLE alerta_seguridad ENABLE ROW LEVEL SECURITY;

    -- Registros a prueba de manipulación: nadie puede modificar ni borrar eventos de seguridad ni la
    -- auditoría (ni siquiera la aplicación). Si alguien entra, no puede borrar sus huellas desde la app.
    CREATE FUNCTION bitacora_inmutable() RETURNS trigger AS $fn$
    BEGIN
      RAISE EXCEPTION 'La bitácora % no se puede modificar ni borrar', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END
    $fn$ LANGUAGE plpgsql SET search_path = public;

    CREATE TRIGGER evento_seguridad_inmutable BEFORE UPDATE OR DELETE ON evento_seguridad
      FOR EACH ROW EXECUTE FUNCTION bitacora_inmutable();
    CREATE TRIGGER auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria
      FOR EACH ROW EXECUTE FUNCTION bitacora_inmutable();
    CREATE TRIGGER pago_evento_inmutable BEFORE UPDATE OR DELETE ON pago_evento
      FOR EACH ROW EXECUTE FUNCTION bitacora_inmutable();
    -- TRUNCATE no dispara los triggers por fila: también se bloquea.
    CREATE TRIGGER evento_seguridad_sin_truncar BEFORE TRUNCATE ON evento_seguridad
      FOR EACH STATEMENT EXECUTE FUNCTION bitacora_inmutable();
    CREATE TRIGGER auditoria_sin_truncar BEFORE TRUNCATE ON auditoria
      FOR EACH STATEMENT EXECUTE FUNCTION bitacora_inmutable();
    CREATE TRIGGER pago_evento_sin_truncar BEFORE TRUNCATE ON pago_evento
      FOR EACH STATEMENT EXECUTE FUNCTION bitacora_inmutable();
    INSERT INTO schema_migracion (nombre) VALUES ('006_seguridad.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 007_fecha_chile.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '007_fecha_chile.sql') THEN
    -- Fechas en hora de Chile. La base (Supabase incluida) trabaja en UTC: entre las 21:00 y la medianoche de Chile,
    -- CURRENT_DATE ya es "mañana" y un costo registrado hoy quedaba fuera del día y del mes en el panel.
    ALTER TABLE costo ALTER COLUMN fecha SET DEFAULT (now() AT TIME ZONE 'America/Santiago')::date;
    INSERT INTO schema_migracion (nombre) VALUES ('007_fecha_chile.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 008_link_pago.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '008_link_pago.sql') THEN
    -- Link de pago: permite que cualquiera (el cliente o quien paga por él) pague un envío desde un enlace,
    -- sin iniciar sesión. El enlace es un token aleatorio imposible de adivinar, vence y deja de servir al pagarse.
    CREATE TABLE link_pago (
      id          SERIAL PRIMARY KEY,
      token       TEXT NOT NULL UNIQUE,
      envio_id    INTEGER NOT NULL REFERENCES envio(id),
      creado_por  INTEGER REFERENCES usuario(id),
      creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
      vence_en    TIMESTAMPTZ NOT NULL,
      revocado_en TIMESTAMPTZ,
      pagado_en   TIMESTAMPTZ,
      visitas     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX link_pago_envio_idx ON link_pago (envio_id);
    ALTER TABLE link_pago ENABLE ROW LEVEL SECURITY;
    INSERT INTO schema_migracion (nombre) VALUES ('008_link_pago.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 009_comprobante_transferencia.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '009_comprobante_transferencia.sql') THEN
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
    INSERT INTO schema_migracion (nombre) VALUES ('009_comprobante_transferencia.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 010_registro_clientes.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '010_registro_clientes.sql') THEN
    -- Los clientes crean su cuenta desde la pantalla de ingreso ("Crear cuenta de cliente"), pedido del cliente 30-09-2026.
    -- Se activa una sola vez; administración puede volver a cerrarlo en Tarifas y reglas.
    UPDATE config SET valor = jsonb_set(valor, '{registro_clientes}', 'true'::jsonb) WHERE clave = 'operacion';
    INSERT INTO schema_migracion (nombre) VALUES ('010_registro_clientes.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 011_tarifa_sobredimension.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '011_tarifa_sobredimension.sql') THEN
    -- Tarifas nuevas (pedido del cliente 30-09-2026): la cantidad de bultos no cambia el precio.
    -- Estándar hasta 10 kg y 40×40×40 cm: $3.500 · sobredimensionado hasta 20 kg y 60×60×60 cm: +$2.000 · sobre eso no se recibe.
    ALTER TABLE envio ADD COLUMN recargo_sobredimension INTEGER NOT NULL DEFAULT 0 CHECK (recargo_sobredimension >= 0);

    -- Se quita el cobro por bulto adicional guardado en Ajustes (los valores nuevos se toman por defecto).
    UPDATE config SET valor = valor - 'bulto_adicional_domicilio' - 'bulto_adicional_punto' WHERE clave = 'tarifas';
    INSERT INTO schema_migracion (nombre) VALUES ('011_tarifa_sobredimension.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 012_reembolso_en_bitacora.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '012_reembolso_en_bitacora.sql') THEN
    -- El reembolso de un envío queda en la bitácora del pago que se devuelve (respaldo ante reclamos y para que
    -- Cobranza descuente lo devuelto). Antes solo quedaba en la ficha del envío.
    ALTER TABLE pago_evento DROP CONSTRAINT IF EXISTS pago_evento_tipo_check;
    ALTER TABLE pago_evento ADD CONSTRAINT pago_evento_tipo_check
      CHECK (tipo IN ('inicio', 'notificacion', 'verificacion', 'rechazo', 'conciliacion', 'reembolso'));
    INSERT INTO schema_migracion (nombre) VALUES ('012_reembolso_en_bitacora.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Migración 013_retiro_tamano_carrito.sql
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = '013_retiro_tamano_carrito.sql') THEN
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
    INSERT INTO schema_migracion (nombre) VALUES ('013_retiro_tamano_carrito.sql');
  END IF;
END
$migracion$;

-- ---------------------------------------------------------------------------
-- Zona "Santiago" y 346 comunas (solo si la tabla está vacía)
-- ---------------------------------------------------------------------------
INSERT INTO zona (nombre, tarifa, color, orden) VALUES ('Santiago', 3500, '#1d4ed8', 1)
ON CONFLICT (nombre) DO NOTHING;

DO $comunas$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM comuna) THEN
    INSERT INTO comuna (nombre, provincia, region, zona_id, en_cobertura)
    SELECT v.nombre, v.provincia, v.region, CASE WHEN v.cob THEN (SELECT id FROM zona WHERE nombre = 'Santiago') END, v.cob
    FROM (VALUES
      ('Arica', 'Arica', 'Arica y Parinacota', false),
      ('Camarones', 'Arica', 'Arica y Parinacota', false),
      ('Putre', 'Parinacota', 'Arica y Parinacota', false),
      ('General Lagos', 'Parinacota', 'Arica y Parinacota', false),
      ('Iquique', 'Iquique', 'Tarapacá', false),
      ('Alto Hospicio', 'Iquique', 'Tarapacá', false),
      ('Pozo Almonte', 'Tamarugal', 'Tarapacá', false),
      ('Camiña', 'Tamarugal', 'Tarapacá', false),
      ('Colchane', 'Tamarugal', 'Tarapacá', false),
      ('Huara', 'Tamarugal', 'Tarapacá', false),
      ('Pica', 'Tamarugal', 'Tarapacá', false),
      ('Antofagasta', 'Antofagasta', 'Antofagasta', false),
      ('Mejillones', 'Antofagasta', 'Antofagasta', false),
      ('Sierra Gorda', 'Antofagasta', 'Antofagasta', false),
      ('Taltal', 'Antofagasta', 'Antofagasta', false),
      ('Calama', 'El Loa', 'Antofagasta', false),
      ('Ollagüe', 'El Loa', 'Antofagasta', false),
      ('San Pedro de Atacama', 'El Loa', 'Antofagasta', false),
      ('Tocopilla', 'Tocopilla', 'Antofagasta', false),
      ('María Elena', 'Tocopilla', 'Antofagasta', false),
      ('Copiapó', 'Copiapó', 'Atacama', false),
      ('Caldera', 'Copiapó', 'Atacama', false),
      ('Tierra Amarilla', 'Copiapó', 'Atacama', false),
      ('Chañaral', 'Chañaral', 'Atacama', false),
      ('Diego de Almagro', 'Chañaral', 'Atacama', false),
      ('Vallenar', 'Huasco', 'Atacama', false),
      ('Alto del Carmen', 'Huasco', 'Atacama', false),
      ('Freirina', 'Huasco', 'Atacama', false),
      ('Huasco', 'Huasco', 'Atacama', false),
      ('La Serena', 'Elqui', 'Coquimbo', false),
      ('Coquimbo', 'Elqui', 'Coquimbo', false),
      ('Andacollo', 'Elqui', 'Coquimbo', false),
      ('La Higuera', 'Elqui', 'Coquimbo', false),
      ('Paihuano', 'Elqui', 'Coquimbo', false),
      ('Vicuña', 'Elqui', 'Coquimbo', false),
      ('Illapel', 'Choapa', 'Coquimbo', false),
      ('Canela', 'Choapa', 'Coquimbo', false),
      ('Los Vilos', 'Choapa', 'Coquimbo', false),
      ('Salamanca', 'Choapa', 'Coquimbo', false),
      ('Ovalle', 'Limarí', 'Coquimbo', false),
      ('Combarbalá', 'Limarí', 'Coquimbo', false),
      ('Monte Patria', 'Limarí', 'Coquimbo', false),
      ('Punitaqui', 'Limarí', 'Coquimbo', false),
      ('Río Hurtado', 'Limarí', 'Coquimbo', false),
      ('Valparaíso', 'Valparaíso', 'Valparaíso', false),
      ('Casablanca', 'Valparaíso', 'Valparaíso', false),
      ('Concón', 'Valparaíso', 'Valparaíso', false),
      ('Juan Fernández', 'Valparaíso', 'Valparaíso', false),
      ('Puchuncaví', 'Valparaíso', 'Valparaíso', false),
      ('Quintero', 'Valparaíso', 'Valparaíso', false),
      ('Viña del Mar', 'Valparaíso', 'Valparaíso', false),
      ('Isla de Pascua', 'Isla de Pascua', 'Valparaíso', false),
      ('Los Andes', 'Los Andes', 'Valparaíso', false),
      ('Calle Larga', 'Los Andes', 'Valparaíso', false),
      ('Rinconada', 'Los Andes', 'Valparaíso', false),
      ('San Esteban', 'Los Andes', 'Valparaíso', false),
      ('La Ligua', 'Petorca', 'Valparaíso', false),
      ('Cabildo', 'Petorca', 'Valparaíso', false),
      ('Papudo', 'Petorca', 'Valparaíso', false),
      ('Petorca', 'Petorca', 'Valparaíso', false),
      ('Zapallar', 'Petorca', 'Valparaíso', false),
      ('Quillota', 'Quillota', 'Valparaíso', false),
      ('La Calera', 'Quillota', 'Valparaíso', false),
      ('Hijuelas', 'Quillota', 'Valparaíso', false),
      ('La Cruz', 'Quillota', 'Valparaíso', false),
      ('Nogales', 'Quillota', 'Valparaíso', false),
      ('San Antonio', 'San Antonio', 'Valparaíso', false),
      ('Algarrobo', 'San Antonio', 'Valparaíso', false),
      ('Cartagena', 'San Antonio', 'Valparaíso', false),
      ('El Quisco', 'San Antonio', 'Valparaíso', false),
      ('El Tabo', 'San Antonio', 'Valparaíso', false),
      ('Santo Domingo', 'San Antonio', 'Valparaíso', false),
      ('San Felipe', 'San Felipe de Aconcagua', 'Valparaíso', false),
      ('Catemu', 'San Felipe de Aconcagua', 'Valparaíso', false),
      ('Llaillay', 'San Felipe de Aconcagua', 'Valparaíso', false),
      ('Panquehue', 'San Felipe de Aconcagua', 'Valparaíso', false),
      ('Putaendo', 'San Felipe de Aconcagua', 'Valparaíso', false),
      ('Santa María', 'San Felipe de Aconcagua', 'Valparaíso', false),
      ('Quilpué', 'Marga Marga', 'Valparaíso', false),
      ('Limache', 'Marga Marga', 'Valparaíso', false),
      ('Olmué', 'Marga Marga', 'Valparaíso', false),
      ('Villa Alemana', 'Marga Marga', 'Valparaíso', false),
      ('Santiago', 'Santiago', 'Metropolitana', true),
      ('Cerrillos', 'Santiago', 'Metropolitana', true),
      ('Cerro Navia', 'Santiago', 'Metropolitana', true),
      ('Conchalí', 'Santiago', 'Metropolitana', true),
      ('El Bosque', 'Santiago', 'Metropolitana', true),
      ('Estación Central', 'Santiago', 'Metropolitana', true),
      ('Huechuraba', 'Santiago', 'Metropolitana', true),
      ('Independencia', 'Santiago', 'Metropolitana', true),
      ('La Cisterna', 'Santiago', 'Metropolitana', true),
      ('La Florida', 'Santiago', 'Metropolitana', true),
      ('La Granja', 'Santiago', 'Metropolitana', true),
      ('La Pintana', 'Santiago', 'Metropolitana', true),
      ('La Reina', 'Santiago', 'Metropolitana', true),
      ('Las Condes', 'Santiago', 'Metropolitana', true),
      ('Lo Barnechea', 'Santiago', 'Metropolitana', true),
      ('Lo Espejo', 'Santiago', 'Metropolitana', true),
      ('Lo Prado', 'Santiago', 'Metropolitana', true),
      ('Macul', 'Santiago', 'Metropolitana', true),
      ('Maipú', 'Santiago', 'Metropolitana', true),
      ('Ñuñoa', 'Santiago', 'Metropolitana', true),
      ('Pedro Aguirre Cerda', 'Santiago', 'Metropolitana', true),
      ('Peñalolén', 'Santiago', 'Metropolitana', true),
      ('Providencia', 'Santiago', 'Metropolitana', true),
      ('Pudahuel', 'Santiago', 'Metropolitana', true),
      ('Quilicura', 'Santiago', 'Metropolitana', true),
      ('Quinta Normal', 'Santiago', 'Metropolitana', true),
      ('Recoleta', 'Santiago', 'Metropolitana', true),
      ('Renca', 'Santiago', 'Metropolitana', true),
      ('San Joaquín', 'Santiago', 'Metropolitana', true),
      ('San Miguel', 'Santiago', 'Metropolitana', true),
      ('San Ramón', 'Santiago', 'Metropolitana', true),
      ('Vitacura', 'Santiago', 'Metropolitana', true),
      ('Puente Alto', 'Cordillera', 'Metropolitana', true),
      ('Pirque', 'Cordillera', 'Metropolitana', false),
      ('San José de Maipo', 'Cordillera', 'Metropolitana', false),
      ('Colina', 'Chacabuco', 'Metropolitana', false),
      ('Lampa', 'Chacabuco', 'Metropolitana', false),
      ('Tiltil', 'Chacabuco', 'Metropolitana', false),
      ('San Bernardo', 'Maipo', 'Metropolitana', true),
      ('Buin', 'Maipo', 'Metropolitana', false),
      ('Calera de Tango', 'Maipo', 'Metropolitana', false),
      ('Paine', 'Maipo', 'Metropolitana', false),
      ('Melipilla', 'Melipilla', 'Metropolitana', false),
      ('Alhué', 'Melipilla', 'Metropolitana', false),
      ('Curacaví', 'Melipilla', 'Metropolitana', false),
      ('María Pinto', 'Melipilla', 'Metropolitana', false),
      ('San Pedro', 'Melipilla', 'Metropolitana', false),
      ('Talagante', 'Talagante', 'Metropolitana', false),
      ('El Monte', 'Talagante', 'Metropolitana', false),
      ('Isla de Maipo', 'Talagante', 'Metropolitana', false),
      ('Padre Hurtado', 'Talagante', 'Metropolitana', false),
      ('Peñaflor', 'Talagante', 'Metropolitana', false),
      ('Rancagua', 'Cachapoal', 'O''Higgins', false),
      ('Codegua', 'Cachapoal', 'O''Higgins', false),
      ('Coinco', 'Cachapoal', 'O''Higgins', false),
      ('Coltauco', 'Cachapoal', 'O''Higgins', false),
      ('Doñihue', 'Cachapoal', 'O''Higgins', false),
      ('Graneros', 'Cachapoal', 'O''Higgins', false),
      ('Las Cabras', 'Cachapoal', 'O''Higgins', false),
      ('Machalí', 'Cachapoal', 'O''Higgins', false),
      ('Malloa', 'Cachapoal', 'O''Higgins', false),
      ('Mostazal', 'Cachapoal', 'O''Higgins', false),
      ('Olivar', 'Cachapoal', 'O''Higgins', false),
      ('Peumo', 'Cachapoal', 'O''Higgins', false),
      ('Pichidegua', 'Cachapoal', 'O''Higgins', false),
      ('Quinta de Tilcoco', 'Cachapoal', 'O''Higgins', false),
      ('Rengo', 'Cachapoal', 'O''Higgins', false),
      ('Requínoa', 'Cachapoal', 'O''Higgins', false),
      ('San Vicente', 'Cachapoal', 'O''Higgins', false),
      ('Pichilemu', 'Cardenal Caro', 'O''Higgins', false),
      ('La Estrella', 'Cardenal Caro', 'O''Higgins', false),
      ('Litueche', 'Cardenal Caro', 'O''Higgins', false),
      ('Marchigüe', 'Cardenal Caro', 'O''Higgins', false),
      ('Navidad', 'Cardenal Caro', 'O''Higgins', false),
      ('Paredones', 'Cardenal Caro', 'O''Higgins', false),
      ('San Fernando', 'Colchagua', 'O''Higgins', false),
      ('Chépica', 'Colchagua', 'O''Higgins', false),
      ('Chimbarongo', 'Colchagua', 'O''Higgins', false),
      ('Lolol', 'Colchagua', 'O''Higgins', false),
      ('Nancagua', 'Colchagua', 'O''Higgins', false),
      ('Palmilla', 'Colchagua', 'O''Higgins', false),
      ('Peralillo', 'Colchagua', 'O''Higgins', false),
      ('Placilla', 'Colchagua', 'O''Higgins', false),
      ('Pumanque', 'Colchagua', 'O''Higgins', false),
      ('Santa Cruz', 'Colchagua', 'O''Higgins', false),
      ('Talca', 'Talca', 'Maule', false),
      ('Constitución', 'Talca', 'Maule', false),
      ('Curepto', 'Talca', 'Maule', false),
      ('Empedrado', 'Talca', 'Maule', false),
      ('Maule', 'Talca', 'Maule', false),
      ('Pelarco', 'Talca', 'Maule', false),
      ('Pencahue', 'Talca', 'Maule', false),
      ('Río Claro', 'Talca', 'Maule', false),
      ('San Clemente', 'Talca', 'Maule', false),
      ('San Rafael', 'Talca', 'Maule', false),
      ('Cauquenes', 'Cauquenes', 'Maule', false),
      ('Chanco', 'Cauquenes', 'Maule', false),
      ('Pelluhue', 'Cauquenes', 'Maule', false),
      ('Curicó', 'Curicó', 'Maule', false),
      ('Hualañé', 'Curicó', 'Maule', false),
      ('Licantén', 'Curicó', 'Maule', false),
      ('Molina', 'Curicó', 'Maule', false),
      ('Rauco', 'Curicó', 'Maule', false),
      ('Romeral', 'Curicó', 'Maule', false),
      ('Sagrada Familia', 'Curicó', 'Maule', false),
      ('Teno', 'Curicó', 'Maule', false),
      ('Vichuquén', 'Curicó', 'Maule', false),
      ('Linares', 'Linares', 'Maule', false),
      ('Colbún', 'Linares', 'Maule', false),
      ('Longaví', 'Linares', 'Maule', false),
      ('Parral', 'Linares', 'Maule', false),
      ('Retiro', 'Linares', 'Maule', false),
      ('San Javier', 'Linares', 'Maule', false),
      ('Villa Alegre', 'Linares', 'Maule', false),
      ('Yerbas Buenas', 'Linares', 'Maule', false),
      ('Chillán', 'Diguillín', 'Ñuble', false),
      ('Bulnes', 'Diguillín', 'Ñuble', false),
      ('Chillán Viejo', 'Diguillín', 'Ñuble', false),
      ('El Carmen', 'Diguillín', 'Ñuble', false),
      ('Pemuco', 'Diguillín', 'Ñuble', false),
      ('Pinto', 'Diguillín', 'Ñuble', false),
      ('Quillón', 'Diguillín', 'Ñuble', false),
      ('San Ignacio', 'Diguillín', 'Ñuble', false),
      ('Yungay', 'Diguillín', 'Ñuble', false),
      ('Quirihue', 'Itata', 'Ñuble', false),
      ('Cobquecura', 'Itata', 'Ñuble', false),
      ('Coelemu', 'Itata', 'Ñuble', false),
      ('Ninhue', 'Itata', 'Ñuble', false),
      ('Portezuelo', 'Itata', 'Ñuble', false),
      ('Ránquil', 'Itata', 'Ñuble', false),
      ('Treguaco', 'Itata', 'Ñuble', false),
      ('San Carlos', 'Punilla', 'Ñuble', false),
      ('Coihueco', 'Punilla', 'Ñuble', false),
      ('Ñiquén', 'Punilla', 'Ñuble', false),
      ('San Fabián', 'Punilla', 'Ñuble', false),
      ('San Nicolás', 'Punilla', 'Ñuble', false),
      ('Concepción', 'Concepción', 'Biobío', false),
      ('Coronel', 'Concepción', 'Biobío', false),
      ('Chiguayante', 'Concepción', 'Biobío', false),
      ('Florida', 'Concepción', 'Biobío', false),
      ('Hualqui', 'Concepción', 'Biobío', false),
      ('Lota', 'Concepción', 'Biobío', false),
      ('Penco', 'Concepción', 'Biobío', false),
      ('San Pedro de la Paz', 'Concepción', 'Biobío', false),
      ('Santa Juana', 'Concepción', 'Biobío', false),
      ('Talcahuano', 'Concepción', 'Biobío', false),
      ('Tomé', 'Concepción', 'Biobío', false),
      ('Hualpén', 'Concepción', 'Biobío', false),
      ('Lebu', 'Arauco', 'Biobío', false),
      ('Arauco', 'Arauco', 'Biobío', false),
      ('Cañete', 'Arauco', 'Biobío', false),
      ('Contulmo', 'Arauco', 'Biobío', false),
      ('Curanilahue', 'Arauco', 'Biobío', false),
      ('Los Álamos', 'Arauco', 'Biobío', false),
      ('Tirúa', 'Arauco', 'Biobío', false),
      ('Los Ángeles', 'Biobío', 'Biobío', false),
      ('Antuco', 'Biobío', 'Biobío', false),
      ('Cabrero', 'Biobío', 'Biobío', false),
      ('Laja', 'Biobío', 'Biobío', false),
      ('Mulchén', 'Biobío', 'Biobío', false),
      ('Nacimiento', 'Biobío', 'Biobío', false),
      ('Negrete', 'Biobío', 'Biobío', false),
      ('Quilaco', 'Biobío', 'Biobío', false),
      ('Quilleco', 'Biobío', 'Biobío', false),
      ('San Rosendo', 'Biobío', 'Biobío', false),
      ('Santa Bárbara', 'Biobío', 'Biobío', false),
      ('Tucapel', 'Biobío', 'Biobío', false),
      ('Yumbel', 'Biobío', 'Biobío', false),
      ('Alto Biobío', 'Biobío', 'Biobío', false),
      ('Temuco', 'Cautín', 'La Araucanía', false),
      ('Carahue', 'Cautín', 'La Araucanía', false),
      ('Cunco', 'Cautín', 'La Araucanía', false),
      ('Curarrehue', 'Cautín', 'La Araucanía', false),
      ('Freire', 'Cautín', 'La Araucanía', false),
      ('Galvarino', 'Cautín', 'La Araucanía', false),
      ('Gorbea', 'Cautín', 'La Araucanía', false),
      ('Lautaro', 'Cautín', 'La Araucanía', false),
      ('Loncoche', 'Cautín', 'La Araucanía', false),
      ('Melipeuco', 'Cautín', 'La Araucanía', false),
      ('Nueva Imperial', 'Cautín', 'La Araucanía', false),
      ('Padre Las Casas', 'Cautín', 'La Araucanía', false),
      ('Perquenco', 'Cautín', 'La Araucanía', false),
      ('Pitrufquén', 'Cautín', 'La Araucanía', false),
      ('Pucón', 'Cautín', 'La Araucanía', false),
      ('Saavedra', 'Cautín', 'La Araucanía', false),
      ('Teodoro Schmidt', 'Cautín', 'La Araucanía', false),
      ('Toltén', 'Cautín', 'La Araucanía', false),
      ('Vilcún', 'Cautín', 'La Araucanía', false),
      ('Villarrica', 'Cautín', 'La Araucanía', false),
      ('Cholchol', 'Cautín', 'La Araucanía', false),
      ('Angol', 'Malleco', 'La Araucanía', false),
      ('Collipulli', 'Malleco', 'La Araucanía', false),
      ('Curacautín', 'Malleco', 'La Araucanía', false),
      ('Ercilla', 'Malleco', 'La Araucanía', false),
      ('Lonquimay', 'Malleco', 'La Araucanía', false),
      ('Los Sauces', 'Malleco', 'La Araucanía', false),
      ('Lumaco', 'Malleco', 'La Araucanía', false),
      ('Purén', 'Malleco', 'La Araucanía', false),
      ('Renaico', 'Malleco', 'La Araucanía', false),
      ('Traiguén', 'Malleco', 'La Araucanía', false),
      ('Victoria', 'Malleco', 'La Araucanía', false),
      ('Valdivia', 'Valdivia', 'Los Ríos', false),
      ('Corral', 'Valdivia', 'Los Ríos', false),
      ('Lanco', 'Valdivia', 'Los Ríos', false),
      ('Los Lagos', 'Valdivia', 'Los Ríos', false),
      ('Máfil', 'Valdivia', 'Los Ríos', false),
      ('Mariquina', 'Valdivia', 'Los Ríos', false),
      ('Paillaco', 'Valdivia', 'Los Ríos', false),
      ('Panguipulli', 'Valdivia', 'Los Ríos', false),
      ('La Unión', 'Ranco', 'Los Ríos', false),
      ('Futrono', 'Ranco', 'Los Ríos', false),
      ('Lago Ranco', 'Ranco', 'Los Ríos', false),
      ('Río Bueno', 'Ranco', 'Los Ríos', false),
      ('Puerto Montt', 'Llanquihue', 'Los Lagos', false),
      ('Calbuco', 'Llanquihue', 'Los Lagos', false),
      ('Cochamó', 'Llanquihue', 'Los Lagos', false),
      ('Fresia', 'Llanquihue', 'Los Lagos', false),
      ('Frutillar', 'Llanquihue', 'Los Lagos', false),
      ('Los Muermos', 'Llanquihue', 'Los Lagos', false),
      ('Llanquihue', 'Llanquihue', 'Los Lagos', false),
      ('Maullín', 'Llanquihue', 'Los Lagos', false),
      ('Puerto Varas', 'Llanquihue', 'Los Lagos', false),
      ('Castro', 'Chiloé', 'Los Lagos', false),
      ('Ancud', 'Chiloé', 'Los Lagos', false),
      ('Chonchi', 'Chiloé', 'Los Lagos', false),
      ('Curaco de Vélez', 'Chiloé', 'Los Lagos', false),
      ('Dalcahue', 'Chiloé', 'Los Lagos', false),
      ('Puqueldón', 'Chiloé', 'Los Lagos', false),
      ('Queilén', 'Chiloé', 'Los Lagos', false),
      ('Quellón', 'Chiloé', 'Los Lagos', false),
      ('Quemchi', 'Chiloé', 'Los Lagos', false),
      ('Quinchao', 'Chiloé', 'Los Lagos', false),
      ('Osorno', 'Osorno', 'Los Lagos', false),
      ('Puerto Octay', 'Osorno', 'Los Lagos', false),
      ('Purranque', 'Osorno', 'Los Lagos', false),
      ('Puyehue', 'Osorno', 'Los Lagos', false),
      ('Río Negro', 'Osorno', 'Los Lagos', false),
      ('San Juan de la Costa', 'Osorno', 'Los Lagos', false),
      ('San Pablo', 'Osorno', 'Los Lagos', false),
      ('Chaitén', 'Palena', 'Los Lagos', false),
      ('Futaleufú', 'Palena', 'Los Lagos', false),
      ('Hualaihué', 'Palena', 'Los Lagos', false),
      ('Palena', 'Palena', 'Los Lagos', false),
      ('Coyhaique', 'Coyhaique', 'Aysén', false),
      ('Lago Verde', 'Coyhaique', 'Aysén', false),
      ('Aysén', 'Aysén', 'Aysén', false),
      ('Cisnes', 'Aysén', 'Aysén', false),
      ('Guaitecas', 'Aysén', 'Aysén', false),
      ('Cochrane', 'Capitán Prat', 'Aysén', false),
      ('O''Higgins', 'Capitán Prat', 'Aysén', false),
      ('Tortel', 'Capitán Prat', 'Aysén', false),
      ('Chile Chico', 'General Carrera', 'Aysén', false),
      ('Río Ibáñez', 'General Carrera', 'Aysén', false),
      ('Punta Arenas', 'Magallanes', 'Magallanes', false),
      ('Laguna Blanca', 'Magallanes', 'Magallanes', false),
      ('Río Verde', 'Magallanes', 'Magallanes', false),
      ('San Gregorio', 'Magallanes', 'Magallanes', false),
      ('Cabo de Hornos', 'Antártica Chilena', 'Magallanes', false),
      ('Antártica', 'Antártica Chilena', 'Magallanes', false),
      ('Porvenir', 'Tierra del Fuego', 'Magallanes', false),
      ('Primavera', 'Tierra del Fuego', 'Magallanes', false),
      ('Timaukel', 'Tierra del Fuego', 'Magallanes', false),
      ('Natales', 'Última Esperanza', 'Magallanes', false),
      ('Torres del Paine', 'Última Esperanza', 'Magallanes', false)
    ) AS v(nombre, provincia, region, cob);
  END IF;
END
$comunas$;

-- ---------------------------------------------------------------------------
-- Configuración inicial (tarifas, operación, ticket, pagos, negocio)
-- ---------------------------------------------------------------------------
INSERT INTO config (clave, valor) VALUES
  ('negocio', '{"nombre":"Tu Empresa de Envíos","rut":"","telefono":"","correo":"","logo_url":""}'::jsonb),
  ('tarifas', '{"base":3500,"peso_estandar_kg":10,"dim_estandar_cm":40,"recargo_sobredimension":2000,"peso_max_kg":20,"dim_max_cm":60,"recargo_horario_especial":1000}'::jsonb),
  ('operacion', '{"intentos_max":3,"espera_max_min":5,"gps_obligatorio":false,"registro_clientes":true,"qr_destino":"google","autoasignacion":true,"punto_courier":false}'::jsonb),
  ('ticket', '{"pie":"Conserve este ticket. Consultas y reclamos indicando el folio."}'::jsonb),
  ('listas', '{"couriers":["Blue Express","Starken","Chilexpress","Correos de Chile","Otra"],"franjas":["08:00 – 10:00","10:00 – 13:00","13:00 – 16:00","16:00 – 19:00","19:00 – 21:00","21:00 – 23:00"]}'::jsonb),
  ('pagos', '{"proveedor":"simulado","en_linea":false}'::jsonb),
  ('transferencia', '{"banco":"","tipo_cuenta":"","numero_cuenta":"","titular":"","rut":"","correo":""}'::jsonb)
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Bucket PRIVADO para fotos de entrega y boletas (solo existe en Supabase)
-- ---------------------------------------------------------------------------
DO $bucket$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('envios-privado', 'envios-privado', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    ON CONFLICT (id) DO UPDATE SET public = false;
  END IF;
END
$bucket$;

COMMIT;

-- Verificación: debe mostrar 346 comunas, 34 en cobertura y 7 claves de configuración.
SELECT
  (SELECT count(*) FROM comuna) AS comunas,
  (SELECT count(*) FROM comuna WHERE en_cobertura) AS en_cobertura,
  (SELECT count(*) FROM config) AS configuracion,
  (SELECT string_agg(nombre, ', ' ORDER BY nombre) FROM schema_migracion) AS migraciones;
