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
