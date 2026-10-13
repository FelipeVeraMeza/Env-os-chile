-- Soporte como conversación (pedido 13-10-2026). Antes cada mensaje tenía una sola respuesta: el cliente no podía
-- contestar y una segunda respuesta borraba la primera. Ahora cada mensaje es un "caso" con número (SOP-2026-000045),
-- un enlace privado para quien escribió sin cuenta, motivo, mensajes de ida y vuelta (con foto o PDF), notas internas
-- de administración y aviso de respuesta nueva para el cliente.
ALTER TABLE mensaje_soporte ADD COLUMN IF NOT EXISTS folio_caso TEXT;
ALTER TABLE mensaje_soporte ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE mensaje_soporte ADD COLUMN IF NOT EXISTS motivo TEXT NOT NULL DEFAULT 'otro';
ALTER TABLE mensaje_soporte ADD COLUMN IF NOT EXISTS no_leido_cliente BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mensaje_soporte ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS soporte_mensaje (
  id          SERIAL PRIMARY KEY,
  caso_id     INTEGER NOT NULL REFERENCES mensaje_soporte(id) ON DELETE CASCADE,
  autor       TEXT NOT NULL CHECK (autor IN ('cliente', 'admin')),
  usuario_id  INTEGER REFERENCES usuario(id) ON DELETE SET NULL, -- vacío si escribió sin iniciar sesión
  texto       TEXT NOT NULL DEFAULT '',
  interno     BOOLEAN NOT NULL DEFAULT FALSE,                  -- nota de administración: el cliente no la ve
  adjunto_ruta   TEXT,
  adjunto_mime   TEXT,
  adjunto_nombre TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS soporte_mensaje_caso_idx ON soporte_mensaje (caso_id, creado_en, id);
ALTER TABLE soporte_mensaje ENABLE ROW LEVEL SECURITY;

-- Respuestas rápidas que administración guarda para no escribir lo mismo cada vez.
CREATE TABLE IF NOT EXISTS soporte_plantilla (
  id        SERIAL PRIMARY KEY,
  titulo    TEXT NOT NULL,
  texto     TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE soporte_plantilla ENABLE ROW LEVEL SECURITY;
INSERT INTO soporte_plantilla (titulo, texto)
SELECT * FROM (VALUES
  ('Pago aprobado', 'Hola, ya aprobamos tu pago: el envío quedó listo para el retiro. ¡Gracias!'),
  ('Horario de retiro', 'Retiramos al día siguiente de agendado, entre las 9:00 y las 13:00 hrs. Te avisamos si hay algún cambio.'),
  ('Revisando el caso', 'Hola, estamos revisando tu caso y te respondemos aquí apenas tengamos novedades.')
) AS v(titulo, texto)
WHERE NOT EXISTS (SELECT 1 FROM soporte_plantilla);

-- Los mensajes que ya existían pasan a ser casos: número, enlace y la conversación con su mensaje y su respuesta.
UPDATE mensaje_soporte SET
  folio_caso = 'SOP-' || to_char(creado_en AT TIME ZONE 'America/Santiago', 'YYYY') || '-' || lpad(id::text, 6, '0'),
  token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  actualizado_en = COALESCE(respondido_en, creado_en)
WHERE folio_caso IS NULL;
INSERT INTO soporte_mensaje (caso_id, autor, usuario_id, texto, creado_en)
SELECT m.id, 'cliente', m.usuario_id, m.mensaje, m.creado_en FROM mensaje_soporte m
WHERE NOT EXISTS (SELECT 1 FROM soporte_mensaje s WHERE s.caso_id = m.id);
INSERT INTO soporte_mensaje (caso_id, autor, usuario_id, texto, creado_en)
SELECT m.id, 'admin', m.respondido_por, m.respuesta, COALESCE(m.respondido_en, m.creado_en) FROM mensaje_soporte m
WHERE m.respuesta IS NOT NULL AND NOT EXISTS (SELECT 1 FROM soporte_mensaje s WHERE s.caso_id = m.id AND s.autor = 'admin');
-- El contador de folios SOP sigue desde el último número usado, para no repetir los de los casos convertidos.
INSERT INTO folio_contador (prefijo, anio, ultimo)
SELECT 'SOP', substr(folio_caso, 5, 4)::int, max(id) FROM mensaje_soporte GROUP BY substr(folio_caso, 5, 4)
ON CONFLICT (prefijo, anio) DO UPDATE SET ultimo = GREATEST(folio_contador.ultimo, EXCLUDED.ultimo);

CREATE UNIQUE INDEX IF NOT EXISTS mensaje_soporte_folio_idx ON mensaje_soporte (folio_caso);
CREATE UNIQUE INDEX IF NOT EXISTS mensaje_soporte_token_idx ON mensaje_soporte (token);
CREATE INDEX IF NOT EXISTS mensaje_soporte_no_leido_idx ON mensaje_soporte (usuario_id) WHERE no_leido_cliente;
