import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitador } from '../../server/lib/http.js';

// Simula una solicitud Express mínima y devuelve el error (o null) y las cabeceras.
function llamar(mw, ip = '1.1.1.1') {
  const cabeceras = {};
  let error = null;
  mw({ ip }, { set: (k, v) => { cabeceras[k] = v; } }, (e) => { error = e || null; });
  return { error, cabeceras };
}

test('limitador: deja pasar hasta el máximo y luego responde 429 con Retry-After', () => {
  const mw = limitador({ nombre: 't1', max: 3 });
  for (let i = 0; i < 3; i++) assert.equal(llamar(mw).error, null);
  const r = llamar(mw);
  assert.equal(r.error.status, 429);
  assert.ok(Number(r.cabeceras['Retry-After']) > 0);
  assert.equal(r.cabeceras['RateLimit-Remaining'], '0');
});

test('limitador: cuenta por IP y max = 0 lo desactiva', () => {
  const mw = limitador({ nombre: 't2', max: 1 });
  assert.equal(llamar(mw, 'a').error, null);
  assert.equal(llamar(mw, 'b').error, null);
  assert.equal(llamar(mw, 'a').error.status, 429);
  const libre = limitador({ nombre: 't3', max: 0 });
  for (let i = 0; i < 50; i++) assert.equal(llamar(libre).error, null);
});

test('limitador: la ventana se reinicia', async () => {
  const mw = limitador({ nombre: 't4', max: 1, ventanaMs: 30 });
  assert.equal(llamar(mw).error, null);
  assert.equal(llamar(mw).error.status, 429);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(llamar(mw).error, null);
});
