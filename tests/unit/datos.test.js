import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listarComunas } from '../../server/db/data/comunas.js';
import { quitarExif, tieneExif } from '../../server/lib/exif.js';
import { resolverObjetivo } from '../../qa/entornos.js';

test('346 comunas, sin duplicados por región', () => {
  const c = listarComunas();
  assert.equal(c.length, 346);
  assert.equal(new Set(c.map((x) => `${x.region}|${x.nombre}`)).size, 346);
  assert.equal(new Set(c.map((x) => x.region)).size, 16);
  assert.equal(c.filter((x) => x.region === 'Metropolitana').length, 52);
});

test('EXIF se elimina de un JPEG', () => {
  const jpeg = Buffer.from(fs.readFileSync(new URL('./fixtures/jpeg-con-exif.b64', import.meta.url), 'utf8').trim(), 'base64');
  assert.ok(tieneExif(jpeg));
  const limpio = quitarExif(jpeg);
  assert.ok(!tieneExif(limpio));
  assert.ok(limpio.length < jpeg.length);
  assert.equal(limpio.subarray(-2).toString('hex'), 'ffd9');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(quitarExif(png), png);
});

test('entornos: resuelve URLs de local, railway y vercel', () => {
  const vars = { URL_LOCAL: 'http://localhost:3000/', URL_RAILWAY: 'https://api.up.railway.app', URL_VERCEL: 'https://web.vercel.app' };
  assert.deepEqual(resolverObjetivo('local', vars), { objetivo: 'local', web: 'http://localhost:3000', api: 'http://localhost:3000' });
  assert.deepEqual(resolverObjetivo('vercel', vars), { objetivo: 'vercel', web: 'https://web.vercel.app', api: 'https://api.up.railway.app' });
  assert.throws(() => resolverObjetivo('railway', { URL_RAILWAY: 'https://CAMBIAR-POR-TU-APP.up.railway.app' }), /entornos\.env/);
  assert.throws(() => resolverObjetivo('marte', vars), /desconocido/);
});

test('conexión: Supabase activa SSL y quita sslmode; local sin SSL', async () => {
  const { configBaseDatos } = await import('../../server/config.js');
  const pooler = configBaseDatos({ DATABASE_URL: 'postgresql://postgres.abc:clave@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require' });
  assert.equal(pooler.esSupabase, true);
  assert.equal(pooler.pooler, true);
  assert.deepEqual(pooler.ssl, { rejectUnauthorized: false });
  assert.doesNotMatch(pooler.url, /sslmode/);
  assert.equal(pooler.max, 5);
  const local = configBaseDatos({ DATABASE_URL: 'postgres://envios:envios@localhost:5432/envios' });
  assert.equal(local.ssl, false);
  assert.equal(configBaseDatos({ DATABASE_URL: 'postgres://u:p@h:5432/d', DATABASE_SSL: 'true' }).ssl.rejectUnauthorized, false);
  assert.equal(configBaseDatos({ DATABASE_URL: 'postgres://u:p@x.supabase.co:5432/d', DATABASE_SSL: 'false' }).ssl, false);
  const conCa = configBaseDatos({ DATABASE_URL: 'postgres://u:p@x.pooler.supabase.com/d', DATABASE_CA_CERT: '-----BEGIN-----\\nabc' });
  assert.equal(conCa.ssl.rejectUnauthorized, true);
  assert.match(conCa.ssl.ca, /\nabc/);
});

test('errores de conexión comunes traen una instrucción concreta', async () => {
  const { explicarErrorConexion } = await import('../../server/db/pool.js');
  assert.match(explicarErrorConexion({ code: '28P01', message: 'password authentication failed for user "postgres"' }), /postgres\.<ref/);
  assert.match(explicarErrorConexion({ code: 'ENETUNREACH', message: 'connect ENETUNREACH 2600:1f18::1:5432' }), /Session pooler/);
  assert.match(explicarErrorConexion({ message: 'Tenant or user not found' }), /postgres\.<ref/);
  assert.match(explicarErrorConexion({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }), /pausa/);
  assert.equal(explicarErrorConexion({ message: 'otra cosa' }), null);
});
