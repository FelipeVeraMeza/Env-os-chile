-- Fechas en hora de Chile. La base (Supabase incluida) trabaja en UTC: entre las 21:00 y la medianoche de Chile,
-- CURRENT_DATE ya es "mañana" y un costo registrado hoy quedaba fuera del día y del mes en el panel.
ALTER TABLE costo ALTER COLUMN fecha SET DEFAULT (now() AT TIME ZONE 'America/Santiago')::date;
