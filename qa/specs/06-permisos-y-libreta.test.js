import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, peticion } from '../cliente.js';

let esc;
let envio;
before(async () => {
  esc = await escenario();
  const r = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  envio = r.datos;
});

test('CP-60 · Un cliente no ve los envíos de otro cliente (RF-04)', async () => {
  assert.equal((await peticion('GET', `/api/envios/${envio.id}`, { sesion: esc.clienteB })).status, 404);
  const lista = await peticion('GET', '/api/envios', { sesion: esc.clienteB });
  assert.ok(lista.datos.items.every((e) => e.cliente_id === esc.clienteB.usuario.id));
});

test('CP-61 · Solo administración ve ganancias, usuarios y asigna repartidores', async () => {
  for (const s of [esc.cliente, esc.repartidor]) {
    assert.equal((await peticion('GET', '/api/reportes/ganancias', { sesion: s })).status, 403);
    assert.equal((await peticion('GET', '/api/usuarios', { sesion: s })).status, 403);
    assert.equal((await peticion('POST', `/api/envios/${envio.id}/asignar`, { sesion: s, json: { repartidor_id: esc.repartidor.usuario.id } })).status, 403);
  }
  assert.equal((await peticion('GET', '/api/reportes/ganancias', { sesion: esc.admin })).status, 200);
});

test('CP-62 · El repartidor no puede crear envíos', async () => {
  const r = await peticion('POST', '/api/envios', { sesion: esc.repartidor, json: datosEnvio(esc.comuna.id) });
  assert.equal(r.status, 403);
});

test('CP-63 · El cliente puede anular su envío mientras no esté pagado ni asignado', async () => {
  const r = await peticion('POST', `/api/envios/${envio.id}/estado`, { sesion: esc.cliente, json: { estado: 'anulado', motivo: 'Ya no se envía' } });
  assert.equal(r.status, 200);
  assert.equal(r.datos.estado, 'anulado');
  const detalle = await peticion('GET', `/api/envios/${envio.id}`, { sesion: esc.cliente });
  assert.equal(detalle.status, 200, 'el envío anulado no se borra (RF-33)');
});

test('CP-64 · Libreta: el destinatario queda registrado y admite varias direcciones', async () => {
  const lib = await peticion('GET', '/api/destinatarios', { sesion: esc.cliente });
  const dest = lib.datos.find((d) => d.nombre === 'Destinatario QA');
  assert.ok(dest, 'el destinatario del envío queda en la libreta');
  const nueva = await peticion('POST', `/api/destinatarios/${dest.id}/direcciones`, {
    sesion: esc.cliente, json: { alias: 'Casa nueva', calle: 'Irarrázaval', numero: '3000', comuna_id: esc.comuna.id, es_principal: true },
  });
  assert.equal(nueva.status, 201);
  const otra = await peticion('POST', '/api/envios', {
    sesion: esc.cliente,
    json: { destinatario_id: dest.id, direccion_id: nueva.datos.id, descripcion_producto: 'Libro', bultos: 1, peso_kg: 1, largo_cm: 20, ancho_cm: 15, alto_cm: 5, valor_declarado: 15000 },
  });
  assert.equal(otra.status, 201, JSON.stringify(otra.datos));
  assert.equal(otra.datos.calle, 'Irarrázaval');
  const lib2 = await peticion('GET', '/api/destinatarios', { sesion: esc.cliente });
  assert.equal(lib2.datos.find((d) => d.id === dest.id).direcciones.length, 2);
});

test('CP-65 · Un cliente no puede usar la libreta de otro cliente', async () => {
  const lib = await peticion('GET', '/api/destinatarios', { sesion: esc.cliente });
  const dest = lib.datos[0];
  const r = await peticion('POST', '/api/envios', {
    sesion: esc.clienteB,
    json: { destinatario_id: dest.id, direccion_id: dest.direcciones[0].id, descripcion_producto: 'X', bultos: 1, peso_kg: 1, largo_cm: 1, ancho_cm: 1, alto_cm: 1 },
  });
  assert.equal(r.status, 422);
});

test('CP-66 · Registro: búsqueda por folio y exportación CSV (RF-28, RF-37)', async () => {
  const r = await peticion('GET', `/api/envios?q=${envio.folio}`, { sesion: esc.cliente });
  assert.equal(r.datos.items.length, 1);
  const csv = await peticion('GET', '/api/envios/exportar.csv', { sesion: esc.cliente, crudo: true });
  assert.equal(csv.status, 200);
  const texto = await csv.text();
  assert.match(texto, /"Folio";"Estado";"Pago"/);
  assert.ok(texto.includes(envio.folio));
});
