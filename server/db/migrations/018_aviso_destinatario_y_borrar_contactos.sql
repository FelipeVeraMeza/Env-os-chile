-- Pedido del cliente del 12-10-2026: al crear un envío se avisa por correo al destinatario con el enlace de seguimiento.
ALTER TABLE envio ADD COLUMN IF NOT EXISTS aviso_destinatario_en TIMESTAMPTZ;

-- Pedido del cliente del 12-10-2026: el cliente puede borrar contactos de Guardados. Si el contacto ya tiene envíos,
-- se oculta (los envíos lo siguen necesitando para el historial, la etiqueta y el seguimiento); si no, se borra.
ALTER TABLE destinatario ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMPTZ;
