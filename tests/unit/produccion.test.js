import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarProduccion } from '../../server/config.js';

const completo = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_DB_PASSWORD: 'x',
  JWT_SECRET: 'a'.repeat(64),
  ADMIN_EMAIL: 'admin@ejemplo.cl',
  ADMIN_PASSWORD: 'Una.Clave.Larga.2026',
  AUTH_MODE: 'demo',
  DEMO_CLAVE: 'demo',
};

test('fuera de producción no exige variables', () => {
  assert.deepEqual(validarProduccion({}), []);
});

test('producción con todas las variables arranca', () => {
  assert.deepEqual(validarProduccion(completo), []);
  const { SUPABASE_URL, SUPABASE_DB_PASSWORD, ...conUrl } = completo;
  assert.deepEqual(validarProduccion({ ...conUrl, DATABASE_URL: 'postgres://u:p@h/d' }), []);
});

test('producción sin variables críticas no arranca (sin valores de respaldo)', () => {
  const faltan = validarProduccion({ NODE_ENV: 'production' });
  for (const nombre of ['Base de datos', 'JWT_SECRET', 'ADMIN_EMAIL']) {
    assert.ok(faltan.some((f) => f.startsWith(nombre)), `debe exigir ${nombre}`);
  }
});

test('producción rechaza JWT_SECRET corto y ADMIN_PASSWORD débil', () => {
  assert.equal(validarProduccion({ ...completo, JWT_SECRET: 'corto' }).length, 1);
  assert.equal(validarProduccion({ ...completo, ADMIN_PASSWORD: 'abc' }).length, 1);
});

test('DEMO_CLAVE es opcional: la demo puede quedar abierta', () => {
  const { DEMO_CLAVE, ...sinDemo } = completo;
  assert.deepEqual(validarProduccion(sinDemo), []);
  assert.deepEqual(validarProduccion({ ...sinDemo, AUTH_MODE: 'jwt' }), []);
});

test('producción rechaza textos de ejemplo sin reemplazar', () => {
  const faltan = validarProduccion({ ...completo, SUPABASE_DB_PASSWORD: 'PEGAR_AQUI_LA_NUEVA_CLAVE_DE_LA_BASE', JWT_SECRET: 'CAMBIAR_POR_UNA_CADENA_LARGA_ALEATORIA' });
  assert.equal(faltan.length, 1);
  assert.match(faltan[0], /SUPABASE_DB_PASSWORD, JWT_SECRET/);
});
