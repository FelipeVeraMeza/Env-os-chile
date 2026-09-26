// Funciones operativas: reembolsos, derechos del titular y orden de la ruta (RF-57, RF-58, RF-60).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, envioEnRuta, escenario, formulario, jpegPrueba, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

async function envioPagado() {
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  await peticion('POST', `/api/envios/${c.datos.id}/pago-manual`, { sesion: esc.admin, json: { medio: 'transferencia' } });
  return c.datos;
}

test('CP-90 · Reembolso: solo de envíos anulados o devueltos, una vez y sin superar lo pagado (RF-57)', async () => {
  const e = await envioPagado();
  const antes = await peticion('POST', `/api/envios/${e.id}/reembolso`, { sesion: esc.admin, json: { monto: 3500, medio: 'transferencia' } });
  assert.equal(antes.status, 409, 'un envío vigente no se reembolsa');
  assert.equal((await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.admin, json: { estado: 'anulado', motivo: 'Cliente desiste' } })).status, 200);
  assert.equal((await peticion('POST', `/api/envios/${e.id}/reembolso`, { sesion: esc.cliente, json: { monto: 3500, medio: 'transferencia' } })).status, 403);
  const excede = await peticion('POST', `/api/envios/${e.id}/reembolso`, { sesion: esc.admin, json: { monto: 99999, medio: 'transferencia' } });
  assert.equal(excede.status, 422);
  const ok = await peticion('POST', `/api/envios/${e.id}/reembolso`, { sesion: esc.admin, json: { monto: 2000, medio: 'transferencia', nota: 'OP 123' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  assert.equal(ok.datos.estado_pago, 'reembolsado');
  assert.equal(ok.datos.reembolso_monto, 2000);
  assert.equal((await peticion('POST', `/api/envios/${e.id}/reembolso`, { sesion: esc.admin, json: { monto: 1500, medio: 'transferencia' } })).status, 409, 'no se reembolsa dos veces');
  const rep = await peticion('GET', '/api/reportes/ganancias', { sesion: esc.admin });
  assert.ok(rep.datos.reembolsos >= 2000);
  assert.equal(rep.datos.cobrado_neto, rep.datos.cobrado - rep.datos.reembolsos);
});

test('CP-91 · Derechos del titular: exportar y anonimizar un destinatario sin perder los envíos (RF-58)', async () => {
  const enCurso = await envioEnRuta(esc, { destinatario: { nombre: 'Titular QA Anonimizar', telefono: '+56 9 4444 3333' } });
  const dest = enCurso.destinatario_id;
  assert.equal((await peticion('GET', `/api/destinatarios/${dest}/exportar`, { sesion: esc.cliente })).status, 403);
  const exp = await peticion('GET', `/api/destinatarios/${dest}/exportar`, { sesion: esc.admin });
  assert.equal(exp.status, 200);
  assert.equal(exp.datos.titular.nombre, 'Titular QA Anonimizar');
  assert.ok(exp.datos.envios.some((x) => x.folio === enCurso.folio));
  assert.equal((await peticion('POST', `/api/destinatarios/${dest}/anonimizar`, { sesion: esc.admin })).status, 409, 'no con envíos en curso');
  const ent = await peticion('POST', `/api/envios/${enCurso.id}/entregar`, {
    sesion: esc.repartidor, form: formulario({ lat: -33.43, lon: -70.61, receptor: 'Titular' }, { foto: [jpegPrueba(), 'e.jpg'] }) });
  assert.equal(ent.status, 200);
  assert.equal((await peticion('POST', `/api/destinatarios/${dest}/anonimizar`, { sesion: esc.admin })).status, 200);
  const d = await peticion('GET', `/api/envios/${enCurso.id}`, { sesion: esc.admin });
  assert.equal(d.status, 200, 'el envío se conserva');
  assert.equal(d.datos.destinatario_nombre, 'Titular anonimizado');
  assert.equal(d.datos.destinatario_telefono, '');
  assert.equal(d.datos.entrega_receptor, null);
  assert.equal(d.datos.estado, 'entregado');
  assert.equal((await peticion('POST', `/api/destinatarios/${dest}/anonimizar`, { sesion: esc.admin })).status, 409);
});

test('CP-92 · El repartidor ordena su ruta y la ve en ese orden; no puede tocar envíos ajenos (RF-60)', async () => {
  const a = await envioEnRuta(esc);
  const b = await envioEnRuta(esc);
  const ajeno = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  const lista = await peticion('GET', '/api/envios?estado=en_ruta&limite=100&orden=ruta', { sesion: esc.repartidor });
  const ids = lista.datos.items.map((e) => e.id);
  const nuevo = [b.id, a.id, ...ids.filter((id) => id !== a.id && id !== b.id)];
  assert.equal((await peticion('PUT', '/api/envios/ruta/orden', { sesion: esc.repartidor, json: { ids: nuevo } })).status, 200);
  const despues = await peticion('GET', '/api/envios?estado=en_ruta&limite=100&orden=ruta', { sesion: esc.repartidor });
  assert.deepEqual(despues.datos.items.slice(0, 2).map((e) => e.id), [b.id, a.id]);
  const intruso = await peticion('PUT', '/api/envios/ruta/orden', { sesion: esc.repartidor, json: { ids: [a.id, ajeno.datos.id] } });
  assert.equal(intruso.status, 403);
  assert.equal((await peticion('PUT', '/api/envios/ruta/orden', { sesion: esc.cliente, json: { ids: [a.id] } })).status, 403);
});
