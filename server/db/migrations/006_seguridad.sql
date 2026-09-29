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
