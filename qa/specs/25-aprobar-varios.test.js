// Pedido 07-10: un cliente hace muchos envíos en el día y los paga con UNA transferencia. Cobranza los agrupa por
// cliente y administración aprueba el pago de todos de una vez (con o sin comprobante subido).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, formulario, jpegPrueba, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const crear = async (sesion = esc.cliente) => {
  const r = await peticion('POST', '/api/envios', { sesion, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return r.datos;
};
const carrito = (ids, sesion = esc.cliente) => peticion('POST', '/api/envios/comprobante-lote', {
  sesion, form: formulario({ envio_ids: ids.join(','), referencia: `OP-${ids[0]}` }, { archivo: [jpegPrueba(), 'transferencia.jpg'] }) });
const grupoDe = async (clienteId) => (await peticion('GET', '/api/cobranza/por-cliente', { sesion: esc.admin })).datos.find((c) => c.cliente_id === clienteId);
const aprobar = (ids, sesion = esc.admin, referencia = 'CARTOLA-1') => peticion('POST', '/api/cobranza/aprobar-varios', { sesion, json: { envio_ids: ids, referencia } });

test('CP-250 · Cobranza agrupa por cliente lo por pagar y lo pendiente de aprobación', async () => {
  const [a, b, c] = [await crear(), await crear(), await crear()];
  assert.equal((await carrito([a.id, b.id])).status, 201);
  const g = await grupoDe(esc.cliente.usuario.id);
  assert.ok(g, 'el cliente aparece agrupado');
  for (const e of [a, b, c]) assert.ok(g.envios.some((x) => x.id === e.id), `incluye ${e.folio}`);
  assert.ok(g.en_revision >= 2 && g.por_pagar >= 1);
  assert.equal(g.envios.find((x) => x.id === a.id).grupo, g.envios.find((x) => x.id === b.id).grupo, 'los del mismo comprobante comparten grupo');
  assert.equal(g.envios.find((x) => x.id === c.id).grupo, null);
  assert.equal(g.total, g.monto_por_pagar + g.monto_en_revision);
  assert.ok(g.envios.every((x) => x.destinatario_nombre && x.comuna_nombre), 'cada envío trae destinatario y comuna para comparar');
  const comp = (await peticion('GET', '/api/cobranza/comprobantes', { sesion: esc.admin })).datos.find((x) => x.envios?.some((v) => v.envio_id === a.id));
  assert.equal(comp.envios.length, 2, 'el comprobante del carrito trae sus 2 envíos');
  assert.equal(comp.monto, a.tarifa_total + b.tarifa_total, 'y el total a comparar');
  assert.ok(comp.envios.every((v) => v.destinatario_nombre && v.comuna_nombre));
  assert.equal((await peticion('GET', '/api/cobranza/por-cliente', { sesion: esc.cliente })).status, 403);
});

test('CP-251 · 30 envíos de un cliente se aprueban de una vez: con comprobante y sin él', async () => {
  const envios = [];
  for (let i = 0; i < 30; i++) envios.push(await crear(esc.clienteB));
  assert.equal((await carrito(envios.slice(0, 20).map((e) => e.id), esc.clienteB)).status, 201, 'un comprobante paga 20');
  const r = await aprobar(envios.map((e) => e.id));
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.envio_ids.length, 30);
  assert.equal(r.datos.comprobantes_aprobados, 1, 'el comprobante del carrito se aprobó una sola vez');
  assert.equal(r.datos.total, envios.reduce((s, e) => s + e.tarifa_total, 0));
  for (const e of [envios[0], envios[29]]) {
    const d = (await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.admin })).datos;
    assert.equal(d.estado_pago, 'pagado');
    assert.equal(d.pago_medio, 'transferencia');
  }
  const conComp = (await peticion('GET', `/api/envios/${envios[0].id}`, { sesion: esc.clienteB })).datos;
  assert.ok(conComp.pagos.some((x) => x.estado === 'aprobado' && x.comprobante?.url), 'el comprobante aprobado sigue visible en el envío');
  assert.equal(conComp.pagos.find((x) => x.estado === 'aprobado').lote_folios.length, 20, 'y muestra los 20 envíos que pagó');
  assert.equal(await grupoDe(esc.clienteB.usuario.id), undefined, 'ya no tiene nada por cobrar');
  assert.equal((await aprobar([envios[0].id])).status, 409, 'no se aprueba dos veces');
});

test('CP-252 · Marcar un envío de un carrito aprueba el carrito completo', async () => {
  const [a, b] = [await crear(), await crear()];
  assert.equal((await carrito([a.id, b.id])).status, 201);
  const r = await aprobar([a.id]);
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.deepEqual(r.datos.envio_ids.sort((x, y) => x - y), [a.id, b.id].sort((x, y) => x - y));
});

test('CP-253 · Todo o nada: otro cliente, un anulado o sin permiso no aprueban nada', async () => {
  const a = await crear();
  const otro = await crear(esc.clienteB);
  assert.equal((await aprobar([a.id, otro.id])).status, 422, 'solo un cliente a la vez');
  const anulado = await crear();
  assert.equal((await peticion('POST', `/api/envios/${anulado.id}/estado`, { sesion: esc.cliente, json: { estado: 'anulado', motivo: 'QA' } })).status, 200);
  const r = await aprobar([a.id, anulado.id]);
  assert.equal(r.status, 409);
  assert.match(r.datos.error, new RegExp(anulado.folio));
  assert.equal((await peticion('GET', `/api/envios/${a.id}`, { sesion: esc.admin })).datos.estado_pago, 'pendiente', 'no se aprobó ninguno');
  assert.equal((await aprobar([a.id], esc.cliente)).status, 403);
  assert.equal((await aprobar([a.id], esc.repartidor)).status, 403);
  assert.equal((await aprobar([])).status, 422);
});
