-- Pedido del cliente del 09-10-2026: un lugar para escribir a soporte (desde el inicio de la página, sin sesión, o
-- desde la cuenta del cliente) y que los mensajes lleguen a la cuenta de administración, que los responde ahí mismo.
CREATE TABLE IF NOT EXISTS mensaje_soporte (
  id             SERIAL PRIMARY KEY,
  usuario_id     INTEGER REFERENCES usuario(id) ON DELETE SET NULL, -- vacío si escribió sin iniciar sesión
  nombre         TEXT NOT NULL,
  contacto       TEXT,          -- correo o teléfono para responder (obligatorio sin sesión)
  folio          TEXT,          -- envío por el que consulta (opcional)
  mensaje        TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'nuevo' CHECK (estado IN ('nuevo', 'respondido', 'cerrado')),
  respuesta      TEXT,
  respondido_por INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  respondido_en  TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mensaje_soporte_estado_idx ON mensaje_soporte (estado, creado_en DESC);
CREATE INDEX IF NOT EXISTS mensaje_soporte_usuario_idx ON mensaje_soporte (usuario_id, creado_en DESC);
ALTER TABLE mensaje_soporte ENABLE ROW LEVEL SECURITY;
