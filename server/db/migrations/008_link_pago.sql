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
