import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { envioEnRuta, escenario, peticion } from '../cliente.js';

let esc;
let envio;
before(async () => {
  esc = await escenario();
  envio = await envioEnRuta(esc);
});

const estado = (sesion, estado, extra = {}) => peticion('POST', `/api/envios/${envio.id}/estado`, { sesion, json: { estado, ...extra } });

test('CP-40 · Intento fallido exige motivo (RF-31)', async () => {
  const r = await estado(esc.repartidor, 'fallido');
  assert.equal(r.status, 422);
});

test('CP-41 · "Espera excedida" solo se acepta tras registrar llegada y cumplir 5 min', async () => {
  const sinLlegada = await estado(esc.repartidor, 'fallido', { motivo: 'espera_excedida' });
  assert.equal(sinLlegada.status, 409);
  const llegada = await peticion('POST', `/api/envios/${envio.id}/llegada`, { sesion: esc.repartidor });
  assert.equal(llegada.status, 200);
  assert.equal(llegada.datos.espera_max_min, 5);
  const antes = await estado(esc.repartidor, 'fallido', { motivo: 'espera_excedida' });
  assert.equal(antes.status, 409, 'antes de 5 minutos no se puede declarar espera excedida');
});

test('CP-42 · Máximo 3 intentos: al tercero ya no se puede reagendar, solo devolver', async () => {
  for (let intento = 1; intento <= 3; intento++) {
    const f = await estado(esc.repartidor, 'fallido', { motivo: 'nadie_en_domicilio', lat: -33.45, lon: -70.66 });
    assert.equal(f.status, 200, JSON.stringify(f.datos));
    assert.equal(f.datos.intentos, intento);
    if (intento < 3) {
      assert.equal((await estado(esc.admin, 'reagendado')).status, 200);
      assert.equal((await estado(esc.repartidor, 'en_ruta')).status, 200);
    }
  }
  const reag = await estado(esc.admin, 'reagendado');
  assert.equal(reag.status, 409);
  assert.match(reag.datos.error, /3 intentos/);
  const dev = await estado(esc.admin, 'devuelto');
  assert.equal(dev.status, 200);
  assert.equal(dev.datos.estado, 'devuelto');
});

test('CP-43 · Un estado final no admite más cambios', async () => {
  const r = await estado(esc.admin, 'en_ruta');
  assert.equal(r.status, 409);
});

test('CP-44 · El seguimiento público muestra los intentos (x de 3)', async () => {
  const r = await peticion('GET', `/api/seguimiento/${envio.folio}`);
  assert.equal(r.datos.intentos, 3);
  assert.equal(r.datos.intentos_max, 3);
});
