import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatos, descubrirPooler, refDeProyecto, urlPooler } from '../../server/db/supabase-pooler.js';

test('extrae el ref del proyecto de SUPABASE_URL', () => {
  assert.equal(refDeProyecto('https://abcdefghijklmnopqrst.supabase.co'), 'abcdefghijklmnopqrst');
  assert.equal(refDeProyecto('https://abcdefghijklmnopqrst.supabase.co/'), 'abcdefghijklmnopqrst');
  assert.equal(refDeProyecto('https://otra-cosa.com'), null);
});

test('la contraseña con símbolos se codifica en la URL', () => {
  const url = urlPooler('ref123', 'Clave@Con:Simbolos/#?', 'aws-0-us-east-1.pooler.supabase.com');
  assert.equal(url, 'postgresql://postgres.ref123:Clave%40Con%3ASimbolos%2F%23%3F@aws-0-us-east-1.pooler.supabase.com:5432/postgres');
  const u = new URL(url);
  assert.equal(decodeURIComponent(u.password), 'Clave@Con:Simbolos/#?');
  assert.equal(u.username, 'postgres.ref123');
});

test('prueba las regiones con prefijos aws-0 y aws-1', () => {
  const c = candidatos('r', 'p');
  assert.ok(c.some((x) => x.host === 'aws-0-sa-east-1.pooler.supabase.com'));
  assert.ok(c.some((x) => x.host === 'aws-1-us-east-1.pooler.supabase.com'));
});

const errTenant = () => Promise.reject(new Error('Tenant or user not found'));

test('encuentra la región correcta', async () => {
  const r = await descubrirPooler({ ref: 'r', password: 'p', probar: (url) => (url.includes('aws-1-sa-east-1') ? Promise.resolve() : errTenant()) });
  assert.equal(r.region, 'sa-east-1');
  assert.equal(r.host, 'aws-1-sa-east-1.pooler.supabase.com');
});

test('contraseña incorrecta da un error claro', async () => {
  await assert.rejects(
    descubrirPooler({ ref: 'r', password: 'p', probar: (url) => (url.includes('us-east-1') && url.includes('aws-0') ? Promise.reject(Object.assign(new Error('password authentication failed for user'), { code: '28P01' })) : errTenant()) }),
    /contraseña de la base/,
  );
});

test('proyecto inexistente o sin red da un error claro', async () => {
  await assert.rejects(descubrirPooler({ ref: 'r', password: 'p', probar: errTenant }), /No se encontró el pooler/);
  await assert.rejects(descubrirPooler({ ref: 'r', password: 'p', probar: () => Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })) }), /No se pudo contactar/);
});
