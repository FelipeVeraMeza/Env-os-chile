import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ruta = new URL('../../supabase/base-de-datos-completa.sql', import.meta.url);

test('el SQL para Supabase está al día con las migraciones y los datos (npm run sql:supabase)', () => {
  const antes = fs.readFileSync(ruta, 'utf8');
  execFileSync(process.execPath, ['scripts/generar-sql-supabase.js'], { cwd: new URL('../..', import.meta.url) });
  const despues = fs.readFileSync(ruta, 'utf8');
  assert.equal(antes, despues, 'Ejecuta "npm run sql:supabase" y sube el archivo actualizado');
  for (const m of fs.readdirSync(new URL('../../server/db/migrations/', import.meta.url))) assert.ok(despues.includes(`Migración ${m}`), m);
  assert.equal((despues.match(/^ {6}\('.*', (true|false)\)/gm) || []).length, 346);
  assert.doesNotMatch(despues, /\$2[aby]\$\d{2}\$|sb_secret_|eyJhbGci/, 'el SQL no debe contener contraseñas, hashes ni claves');
});
