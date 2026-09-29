-- Inicio de sesión real (AUTH_MODE=jwt).
-- sesion_version: al cambiar la contraseña sube en 1 y todas las sesiones anteriores dejan de servir.
-- debe_cambiar_clave: la contraseña la puso administración; se pide cambiarla al entrar.
ALTER TABLE usuario
  ADD COLUMN sesion_version     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN debe_cambiar_clave BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN ultimo_acceso      TIMESTAMPTZ;
