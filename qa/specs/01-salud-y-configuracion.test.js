import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API, WEB, peticion } from '../cliente.js';

test('CP-01 · La API responde y la base de datos está disponible (RNF-03)', async () => {
  const r = await peticion('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.db, 'ok');
});

test('CP-02 · La interfaz web carga y expone su configuración de API', async () => {
  const html = await fetch(`${WEB}/`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /html/);
  const cfg = await fetch(`${WEB}/config.js`);
  assert.equal(cfg.status, 200);
  assert.match(await cfg.text(), /API_URL/);
});

test('CP-03 · Existen las 346 comunas de Chile con su región (RF-08)', async () => {
  const r = await peticion('GET', '/api/comunas');
  assert.equal(r.status, 200);
  assert.equal(r.datos.length, 346);
  assert.ok(r.datos.every((c) => c.region && c.provincia));
});

test('CP-04 · Cobertura inicial dentro de Santiago con tarifa $3.500', async () => {
  const r = await peticion('GET', '/api/comunas?cobertura=1');
  const nombres = r.datos.map((c) => c.nombre);
  for (const c of ['Santiago', 'Providencia', 'Maipú', 'Puente Alto']) assert.ok(nombres.includes(c), `${c} debería estar en cobertura`);
  assert.ok(!nombres.includes('Valparaíso'));
});

test('CP-05 · Reglas comerciales publicadas: $3.500 hasta 10 kg y 40 cm, +$2.000 hasta 20 kg y 60 cm, +$1.000 horario, 3 intentos, 5 min', async () => {
  const r = await peticion('GET', '/api/config/publica');
  assert.equal(r.status, 200);
  const { tarifas, operacion, couriers } = r.datos;
  assert.equal(tarifas.base, 3500);
  assert.equal(tarifas.recargo_horario_especial, 1000);
  assert.equal(tarifas.peso_estandar_kg, 10);
  assert.equal(tarifas.dim_estandar_cm, 40);
  assert.equal(tarifas.recargo_sobredimension, 2000);
  assert.equal(tarifas.peso_max_kg, 20);
  assert.equal(tarifas.dim_max_cm, 60);
  assert.equal(operacion.intentos_max, 3);
  assert.equal(operacion.espera_max_min, 5);
  assert.ok(couriers.includes('Blue Express') && couriers.includes('Starken'));
});

test('CP-06 · Sin identificación la API rechaza operaciones privadas', async () => {
  const r = await peticion('GET', '/api/envios');
  assert.equal(r.status, 401);
  assert.ok(API);
});
