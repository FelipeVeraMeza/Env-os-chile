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
