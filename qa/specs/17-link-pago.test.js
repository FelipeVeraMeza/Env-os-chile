// Link de pago: se paga sin sesión, solo muestra folio/monto/empresa, sirve para un solo envío y se registra en seguridad.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { API, datosEnvio, escenario, peticion } from '../cliente.js';

let esc;
let envio;
let link;
const token = (url) => url.split('#/pagar/')[1];
before(async () => {
  esc = await escenario();
  envio = (await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } })).datos;
});

test('CP-150 · El cliente genera un link de pago; se reutiliza mientras está vigente', async () => {
  const r = await peticion('POST', `/api/envios/${envio.id}/link-pago`, { sesion: esc.cliente });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.match(r.datos.url, /#\/pagar\/[\w-]{30,}$/);
  assert.equal(r.datos.monto, 3500);
  link = r.datos;
  const otra = await peticion('POST', `/api/envios/${envio.id}/link-pago`, { sesion: esc.cliente });
  assert.equal(otra.datos.url, link.url);
});

test('CP-151 · Solo el dueño o administración generan links (repartidor 403, otro cliente 404)', async () => {
  assert.equal((await peticion('POST', `/api/envios/${envio.id}/link-pago`, { sesion: esc.repartidor })).status, 403);
  assert.equal((await peticion('POST', `/api/envios/${envio.id}/link-pago`, { sesion: esc.clienteB })).status, 404);
});

test('CP-152 · La página del link se abre sin sesión ni clave y no muestra datos personales', async () => {
  const r = await fetch(`${API}/api/pago-publico/${token(link.url)}`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.folio, envio.folio);
  assert.equal(d.monto, 3500);
  assert.equal(d.vigente, true);
  const texto = JSON.stringify(d);
  for (const privado of ['Destinatario QA', '8765 4321', 'Providencia', 'Zapatillas', 'QA ClienteA']) assert.ok(!texto.includes(privado), privado);
});

test('CP-153 · Pagar con el link deja el envío pagado con un pago verificado; no se paga dos veces', async () => {
  const base = API;
  const pagar = () => fetch(`${base}/api/pago-publico/${token(link.url)}/pagar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"resultado":"aprobado"}' });
  const r = await pagar();
  assert.equal(r.status, 200, await r.clone().text());
  const d = await peticion('GET', `/api/envios/${envio.id}`, { sesion: esc.cliente });
  assert.equal(d.datos.estado_pago, 'pagado');
  const pagos = (await peticion('GET', '/api/cobranza/pagos', { sesion: esc.admin })).datos;
  const p = pagos.find((x) => x.envio_id === envio.id && x.estado === 'aprobado');
  assert.ok(p?.verificado_en && p.transaccion_id);
  assert.equal((await pagar()).status, 409);
  const info = await (await fetch(`${base}/api/pago-publico/${token(link.url)}`)).json();
  assert.equal(info.pagado, true);
  assert.equal((await peticion('POST', `/api/envios/${envio.id}/link-pago`, { sesion: esc.cliente })).status, 409, 'un envío pagado no genera links');
});

test('CP-154 · Un link inventado responde 404 y queda en la bitácora de seguridad', async () => {
  const r = await fetch(`${API}/api/pago-publico/inventado-${'x'.repeat(30)}`);
  assert.equal(r.status, 404);
  const ev = (await peticion('GET', '/api/seguridad/eventos?tipo=enlace_invalido&limite=5', { sesion: esc.admin })).datos;
  assert.ok(ev.some((e) => e.detalle?.motivo === 'link de pago inexistente'));
});

test('CP-155 · Un link de un envío anulado no permite pagar', async () => {
  const e = (await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } })).datos;
  const l = (await peticion('POST', `/api/envios/${e.id}/link-pago`, { sesion: esc.cliente })).datos;
  assert.equal((await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.cliente, json: { estado: 'anulado', motivo: 'QA' } })).status, 200);
  const r = await fetch(`${API}/api/pago-publico/${token(l.url)}/pagar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 409);
  const d = await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.cliente });
  assert.equal(d.datos.estado_pago, 'pendiente');
});
