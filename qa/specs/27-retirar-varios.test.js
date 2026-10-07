// Pedido 07-10: "Asignado" se muestra como "Por retirar" y el repartidor marca retirados varios paquetes de una vez.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, pagarPorTransferencia, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const porRetirar = async (repartidor = esc.repartidor) => {
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  assert.equal(c.status, 201, JSON.stringify(c.datos));
  await pagarPorTransferencia(esc, c.datos.id);
  const a = await peticion('POST', `/api/envios/${c.datos.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: repartidor.usuario.id } });
  assert.equal(a.status, 200, JSON.stringify(a.datos));
  return a.datos;
};
const retirar = (ids, sesion = esc.repartidor) => peticion('POST', '/api/envios/retirar-varios', { sesion, json: { envio_ids: ids } });

test('CP-270 · Con repartidor el estado se llama "Por retirar" (seguimiento incluido)', async () => {
  const e = await porRetirar();
  assert.equal(e.estado, 'asignado');
  const s = (await peticion('GET', `/api/seguimiento/${e.folio}`)).datos;
  assert.equal(s.estado_label, 'Por retirar');
  assert.equal(s.historial.at(-1).label, 'Por retirar');
});

test('CP-271 · El repartidor marca retirados varios paquetes de una vez; quedan en ruta', async () => {
  const lista = [await porRetirar(), await porRetirar(), await porRetirar()];
  const r = await retirar(lista.map((e) => e.id));
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.retirados, 3);
  for (const e of lista) {
    const d = (await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.repartidor })).datos;
    assert.equal(d.estado, 'en_ruta');
    assert.match(d.historial.at(-1).motivo, /Retirado junto con 3 paquetes/);
  }
  const s = (await peticion('GET', `/api/seguimiento/${lista[0].folio}`)).datos;
  assert.match(s.historial.at(-1).label, /^Retirado: en ruta de entrega/);
});

test('CP-272 · Todo o nada: uno ya retirado, ajeno o sin pagar no deja retirar ninguno; el cliente no puede', async () => {
  const [a, b] = [await porRetirar(), await porRetirar()];
  assert.equal((await retirar([a.id])).status, 200);
  const r = await retirar([a.id, b.id]);
  assert.equal(r.status, 409, 'a ya estaba retirado');
  assert.match(r.datos.error, new RegExp(a.folio));
  assert.equal((await peticion('GET', `/api/envios/${b.id}`, { sesion: esc.repartidor })).datos.estado, 'asignado', 'b no se tocó');
  const ajeno = await porRetirar(esc.repartidorB);
  assert.equal((await retirar([b.id, ajeno.id])).status, 404);
  assert.equal((await retirar([b.id], esc.cliente)).status, 403);
  assert.equal((await retirar([])).status, 422);
  assert.equal((await retirar([b.id])).status, 200);
});
