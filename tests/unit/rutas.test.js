import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CENTRO_COMUNA, distanciaKm, optimizarRuta, ubicar } from '../../server/lib/rutas.js';
import { COMUNAS_POR_REGION, COBERTURA_INICIAL } from '../../server/db/data/comunas.js';

test('todas las comunas de la cobertura inicial tienen centro para ordenar la ruta', () => {
  const rm = COMUNAS_POR_REGION.Metropolitana;
  const cobertura = [...rm.Santiago, ...Object.values(rm).flat().filter((c) => COBERTURA_INICIAL.has(c))];
  for (const c of cobertura) assert.ok(CENTRO_COMUNA[c], `falta el centro de ${c}`);
});

test('distancia entre Providencia y Maipú es razonable (~15 km)', () => {
  const d = distanciaKm(CENTRO_COMUNA.Providencia, CENTRO_COMUNA['Maipú']);
  assert.ok(d > 12 && d < 18, `distancia ${d}`);
});

test('ubicar usa el GPS si existe y si no el centro de la comuna', () => {
  assert.deepEqual(ubicar({ lat: -33.4, lon: -70.6, comuna: 'Maipú' }), [-33.4, -70.6]);
  assert.deepEqual(ubicar({ lat: null, lon: null, comuna: 'Maipú' }), CENTRO_COMUNA['Maipú']);
});

test('la ruta parte por lo más cercano y no zigzaguea entre comunas', () => {
  const paradas = [
    { id: 1, comuna: 'Maipú', calle: 'Pajaritos' },
    { id: 2, comuna: 'Las Condes', calle: 'Apoquindo' },
    { id: 3, comuna: 'Providencia', calle: 'Providencia' },
    { id: 4, comuna: 'Maipú', calle: 'Pajaritos' },
    { id: 5, comuna: 'Cerrillos', calle: 'Lo Errázuriz' },
  ];
  const orden = optimizarRuta(paradas, CENTRO_COMUNA.Providencia);
  assert.equal(orden[0], 3, 'empieza en Providencia, donde está el repartidor');
  assert.equal(orden.length, 5);
  assert.equal(new Set(orden).size, 5);
  const iMaipu = orden.indexOf(1);
  assert.equal(Math.abs(iMaipu - orden.indexOf(4)), 1, 'las dos paradas de Maipú quedan seguidas');
});

test('con una o ninguna parada devuelve lo mismo', () => {
  assert.deepEqual(optimizarRuta([]), []);
  assert.deepEqual(optimizarRuta([{ id: 9, comuna: 'Santiago' }]), [9]);
});

test('200 paradas se ordenan rápido', () => {
  const comunas = Object.keys(CENTRO_COMUNA);
  const paradas = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, comuna: comunas[i % comunas.length], calle: `Calle ${i % 7}` }));
  const t = Date.now();
  const orden = optimizarRuta(paradas);
  assert.equal(new Set(orden).size, 200);
  assert.ok(Date.now() - t < 2000, `tardó ${Date.now() - t} ms`);
});
