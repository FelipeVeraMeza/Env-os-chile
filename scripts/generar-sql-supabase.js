// Genera supabase/base-de-datos-completa.sql: todo lo necesario para crear la base en Supabase
// pegándolo en el SQL Editor (tablas, seguridad RLS, 346 comunas, tarifas, configuración y bucket privado).
// Se arma desde las mismas migraciones y datos que usa el servidor, para que nunca queden distintos.
// Los usuarios NO van aquí: los crea el servidor en su primer arranque con ADMIN_EMAIL / ADMIN_PASSWORD
// (así ninguna contraseña queda escrita en el repositorio).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listarComunas } from '../server/db/data/comunas.js';
import { CONFIG_POR_DEFECTO } from '../server/lib/reglas.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirMig = path.join(raiz, 'server', 'db', 'migrations');
const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const migraciones = fs.readdirSync(dirMig).filter((f) => f.endsWith('.sql')).sort();
const partes = [];
partes.push(`-- =============================================================================
--  PLATAFORMA DE GESTIÓN DE ENVÍOS · BASE DE DATOS COMPLETA PARA SUPABASE
--  Generado por: npm run sql:supabase   (no editar a mano)
--
--  CÓMO USARLO: Supabase → SQL Editor → New query → pegar TODO este archivo → Run.
--  Se puede ejecutar más de una vez: si la base ya existe, no hace nada.
--
--  Crea: ${migraciones.length} migraciones, seguridad RLS, 346 comunas de Chile (34 en cobertura
--  dentro de Santiago), tarifas ($3.500 base, +$1.000 horario especial, 20 kg / 60 cm),
--  reglas de operación (3 intentos, 5 min de espera) y el bucket privado de fotos y boletas.
--  Los usuarios los crea la app en su primer arranque (ADMIN_EMAIL / ADMIN_PASSWORD en Railway).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migracion (
  nombre TEXT PRIMARY KEY,
  aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);

for (const m of migraciones) {
  const sql = fs.readFileSync(path.join(dirMig, m), 'utf8').trim();
  // Cada migración se ejecuta solo si no estaba aplicada (mismo registro que usa el servidor).
  partes.push(`-- ---------------------------------------------------------------------------
-- Migración ${m}
-- ---------------------------------------------------------------------------
DO $migracion$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migracion WHERE nombre = ${lit(m)}) THEN
${sql.split('\n').map((l) => `    ${l}`.trimEnd()).join('\n').replace(/\$/g, '$')}
    INSERT INTO schema_migracion (nombre) VALUES (${lit(m)});
  END IF;
END
$migracion$;
`);
}

const comunas = listarComunas();
partes.push(`-- ---------------------------------------------------------------------------
-- Zona "Santiago" y 346 comunas (solo si la tabla está vacía)
-- ---------------------------------------------------------------------------
INSERT INTO zona (nombre, tarifa, color, orden) VALUES ('Santiago', ${CONFIG_POR_DEFECTO.tarifas.base}, '#1d4ed8', 1)
ON CONFLICT (nombre) DO NOTHING;

DO $comunas$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM comuna) THEN
    INSERT INTO comuna (nombre, provincia, region, zona_id, en_cobertura)
    SELECT v.nombre, v.provincia, v.region, CASE WHEN v.cob THEN (SELECT id FROM zona WHERE nombre = 'Santiago') END, v.cob
    FROM (VALUES
${comunas.map((c) => `      (${lit(c.nombre)}, ${lit(c.provincia)}, ${lit(c.region)}, ${c.enCobertura})`).join(',\n')}
    ) AS v(nombre, provincia, region, cob);
  END IF;
END
$comunas$;
`);

partes.push(`-- ---------------------------------------------------------------------------
-- Configuración inicial (tarifas, operación, ticket, pagos, negocio)
-- ---------------------------------------------------------------------------
INSERT INTO config (clave, valor) VALUES
${Object.entries(CONFIG_POR_DEFECTO).map(([k, v]) => `  (${lit(k)}, ${lit(JSON.stringify(v))}::jsonb)`).join(',\n')}
ON CONFLICT (clave) DO NOTHING;
`);

partes.push(`-- ---------------------------------------------------------------------------
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

-- Verificación: debe mostrar 346 comunas, 34 en cobertura y ${Object.keys(CONFIG_POR_DEFECTO).length} claves de configuración.
SELECT
  (SELECT count(*) FROM comuna) AS comunas,
  (SELECT count(*) FROM comuna WHERE en_cobertura) AS en_cobertura,
  (SELECT count(*) FROM config) AS configuracion,
  (SELECT string_agg(nombre, ', ' ORDER BY nombre) FROM schema_migracion) AS migraciones;
`);

const destino = path.join(raiz, 'supabase', 'base-de-datos-completa.sql');
fs.writeFileSync(destino, partes.join('\n'));
console.log(`✔ ${path.relative(raiz, destino)} (${comunas.length} comunas, ${migraciones.length} migraciones)`);
