-- =============================================================================
--  PLATAFORMA DE GESTIÓN DE ENVÍOS · BASE DE DATOS COMPLETA PARA SUPABASE
--  Generado por: npm run sql:supabase   (no editar a mano)
--
--  CÓMO USARLO: Supabase → SQL Editor → New query → pegar TODO este archivo → Run.
--  Se puede ejecutar más de una vez: si la base ya existe, no hace nada.
--
--  Crea: 3 migraciones, seguridad RLS, 346 comunas de Chile (34 en cobertura
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
  ('tarifas', '{"base":3500,"bulto_adicional_domicilio":3500,"bulto_adicional_punto":0,"recargo_horario_especial":1000,"peso_max_kg":20,"dim_max_cm":60}'::jsonb),
  ('operacion', '{"intentos_max":3,"espera_max_min":5,"gps_obligatorio":true,"registro_clientes":false,"qr_destino":"google"}'::jsonb),
  ('ticket', '{"pie":"Conserve este ticket. Consultas y reclamos indicando el folio."}'::jsonb),
  ('listas', '{"couriers":["Blue Express","Starken","Chilexpress","Correos de Chile","Otra"],"franjas":["08:00 – 10:00","10:00 – 13:00","13:00 – 16:00","16:00 – 19:00","19:00 – 21:00","21:00 – 23:00"]}'::jsonb),
  ('pagos', '{"proveedor":"simulado"}'::jsonb)
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

-- Verificación: debe mostrar 346 comunas, 34 en cobertura y 5 claves de configuración.
SELECT
  (SELECT count(*) FROM comuna) AS comunas,
  (SELECT count(*) FROM comuna WHERE en_cobertura) AS en_cobertura,
  (SELECT count(*) FROM config) AS configuracion,
  (SELECT string_agg(nombre, ', ' ORDER BY nombre) FROM schema_migracion) AS migraciones;
