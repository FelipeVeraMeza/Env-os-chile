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
