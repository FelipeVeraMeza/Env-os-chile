// Pedidos del cliente del 19 y 22-10-2026: formas de ordenar la ruta, espera y foto del intento fallido en el
// seguimiento y horario de atención.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CENTRO_COMUNA, distanciaKm, MODOS_RUTA, optimizarRuta, ubicar } from '../../server/lib/rutas.js';
import { CONFIG_POR_DEFECTO, historialPublico, textoEspera } from '../../server/lib/reglas.js';

const PARADAS = [
  { id: 1, comuna: 'Maipú', calle: 'Pajaritos' },
  { id: 2, comuna: 'Las Condes', calle: 'Apoquindo' },
  { id: 3, comuna: 'Providencia', calle: 'Providencia' },
  { id: 4, comuna: 'Puente Alto', calle: 'Concha y Toro' },
  { id: 5, comuna: 'Quilicura', calle: 'Matta' },
  { id: 6, comuna: 'La Florida', calle: 'Vicuña Mackenna' },
];
const ORIGEN = CENTRO_COMUNA.Santiago;
const pos = (id) => ubicar(PARADAS.find((p) => p.id === id));

test('hay cuatro formas de ordenar la ruta', () => {
  assert.deepEqual(Object.keys(MODOS_RUTA), ['corta', 'circular', 'cerca_lejos', 'lejos_cerca']);
});

test('de la más cercana a la más lejana y al revés', () => {
  const cerca = optimizarRuta(PARADAS, ORIGEN, 'cerca_lejos');
  const dist = cerca.map((id) => distanciaKm(ORIGEN, pos(id)));
  assert.deepEqual([...dist].sort((a, b) => a - b), dist, 'distancias crecientes');
  assert.deepEqual(optimizarRuta(PARADAS, ORIGEN, 'lejos_cerca'), [...cerca].reverse());
});

test('la ruta circular termina más cerca del punto de partida que la más corta', () => {
  const vuelta = (orden) => distanciaKm(pos(orden.at(-1)), ORIGEN);
  const circular = optimizarRuta(PARADAS, ORIGEN, 'circular');
  const corta = optimizarRuta(PARADAS, ORIGEN, 'corta');
  assert.equal(new Set(circular).size, PARADAS.length);
  assert.ok(vuelta(circular) <= vuelta(corta), `circular termina a ${vuelta(circular)} km, corta a ${vuelta(corta)} km`);
});

test('sin modo se mantiene la ruta más corta de siempre', () => {
  assert.deepEqual(optimizarRuta(PARADAS, ORIGEN), optimizarRuta(PARADAS, ORIGEN, 'corta'));
});

test('el seguimiento muestra cuánto esperó el repartidor y si hay foto del intento', () => {
  const h = historialPublico([
    { estado: 'creado', fecha: '2026-10-21T10:00:00Z' },
    { estado: 'en_ruta', fecha: '2026-10-21T11:00:00Z' },
    { estado: 'fallido', motivo: 'espera_excedida', fecha: '2026-10-21T12:05:30Z', llegada_en: '2026-10-21T12:00:00Z', foto: true },
    { estado: 'reagendado', fecha: '2026-10-21T13:00:00Z' },
    { estado: 'en_ruta', motivo: 'Salió al intento 2', fecha: '2026-10-22T10:00:00Z' },
    { estado: 'fallido', motivo: 'nadie_en_domicilio — Dato privado', fecha: '2026-10-22T10:30:00Z', foto: false },
  ], 3);
  const [f1, f2] = h.filter((x) => x.estado === 'fallido');
  assert.equal(f1.espera, 'El repartidor esperó 5 min en el destino');
  assert.equal(f1.foto, true);
  assert.equal(f1.intento, 1);
  assert.equal(f2.espera, null, 'sin "Llegué" no hay espera que mostrar');
  assert.equal(f2.foto, false);
  assert.equal(f2.detalle, 'Nadie en el domicilio', 'nunca el detalle privado del repartidor');
  assert.equal(h.find((x) => x.estado === 'en_ruta' && x.intento === 2).label, 'En ruta: intento 2 de 3');
});

test('texto de la espera', () => {
  assert.equal(textoEspera('2026-10-21T12:00:00Z', '2026-10-21T12:00:40Z'), 'El repartidor esperó menos de 1 minuto en el destino');
  assert.equal(textoEspera(null, '2026-10-21T12:00:40Z'), null);
  assert.equal(textoEspera('2026-10-21T12:10:00Z', '2026-10-21T12:00:00Z'), null, 'llegada posterior al registro: no se muestra');
});

test('horario de atención por defecto: lunes a viernes de 9:00 a 20:30', () => {
  assert.equal(CONFIG_POR_DEFECTO.operacion.horario_atencion, 'Lunes a viernes de 9:00 a 20:30 hrs.');
});
