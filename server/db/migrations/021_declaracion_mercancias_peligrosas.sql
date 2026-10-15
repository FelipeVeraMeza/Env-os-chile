-- Nuevo envío (pedido 15-10-2026): el cliente declara, de forma obligatoria, que no envía mercancías peligrosas.
-- Se guarda cuándo lo declaró (vacío en los envíos creados antes de este cambio).
ALTER TABLE envio ADD COLUMN IF NOT EXISTS declara_sin_peligrosas_en TIMESTAMPTZ;
