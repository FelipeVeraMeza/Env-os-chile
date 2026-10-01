import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, pagarPorTransferencia, peticion, todosDisponibles } from '../cliente.js';

let esc;
let envio;
before(async () => { esc = await escenario(); });

async function crearEnvio() {
  const r = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return r.datos;
}

const pagar = (id) => pagarPorTransferencia(esc, id);

// Todas las páginas: con muchos envíos disponibles, uno recién pagado puede no estar en la primera.
const disponibles = (sesion) => todosDisponibles(sesion);

test('CP-110 · Un envío SIN pagar no aparece como disponible ni se puede tomar', async () => {
  envio = await crearEnvio();
  const d = await disponibles(esc.repartidor);
  assert.ok(!d.items.some((e) => e.id === envio.id));
  const t = await peticion('POST', `/api/envios/${envio.id}/tomar`, { sesion: esc.repartidor });
  assert.equal(t.status, 409);
  assert.match(t.datos.error, /pagado/);
});

test('CP-111 · Recién pagado, el envío le aparece a los repartidores como disponible (sin montos)', async () => {
  await pagar(envio.id);
  const d = await disponibles(esc.repartidor);
  const e = d.items.find((x) => x.id === envio.id);
  assert.ok(e, 'el envío pagado debe aparecer como disponible');
  assert.equal(e.tarifa_total, undefined, 'el repartidor no ve montos');
  assert.ok((await disponibles(esc.repartidorB)).items.some((x) => x.id === envio.id));
});

test('CP-112 · El repartidor lo toma: pasa a su ruta y el otro repartidor ya no puede tomarlo', async () => {
  const t = await peticion('POST', `/api/envios/${envio.id}/tomar`, { sesion: esc.repartidor });
  assert.equal(t.status, 200, JSON.stringify(t.datos));
  assert.equal(t.datos.estado, 'asignado');
  assert.equal(t.datos.repartidor_id, esc.repartidor.usuario.id);
  const otro = await peticion('POST', `/api/envios/${envio.id}/tomar`, { sesion: esc.repartidorB });
  assert.equal(otro.status, 409);
  const ruta = await peticion('GET', '/api/envios?estado=asignado,en_ruta,reagendado,fallido', { sesion: esc.repartidor });
  assert.ok(ruta.datos.items.some((x) => x.id === envio.id));
  assert.ok(!(await disponibles(esc.repartidorB)).items.some((x) => x.id === envio.id));
  const ret = await peticion('POST', `/api/envios/${envio.id}/estado`, { sesion: esc.repartidor, json: { estado: 'en_ruta' } });
  assert.equal(ret.status, 200);
});

test('CP-113 · Solo los repartidores toman envíos', async () => {
  const otro = await crearEnvio();
  await pagar(otro.id);
  assert.equal((await peticion('POST', `/api/envios/${otro.id}/tomar`, { sesion: esc.cliente })).status, 403);
  assert.equal((await peticion('GET', '/api/envios/disponibles', { sesion: esc.cliente })).status, 403);
});

test('CP-114 · Cada pago aprobado queda verificado y con bitácora; no se cobra dos veces', async () => {
  const pagos = (await peticion('GET', '/api/cobranza/pagos', { sesion: esc.admin })).datos;
  const p = pagos.find((x) => x.envio_id === envio.id && x.estado === 'aprobado');
  assert.ok(p, 'debe existir el pago aprobado');
  assert.ok(p.verificado_en);
  assert.equal(p.verificacion, 'manual', 'lo verificó administración al aprobar el comprobante');
  assert.equal(p.medio, 'transferencia');
  assert.ok(p.verificado_por_nombre);
  const ev = (await peticion('GET', `/api/cobranza/pagos/${p.id}/eventos`, { sesion: esc.admin })).datos;
  assert.deepEqual(ev.map((x) => x.tipo), ['inicio', 'verificacion']);
  const manual = await peticion('POST', `/api/envios/${envio.id}/pago-manual`, { sesion: esc.admin, json: { medio: 'transferencia' } });
  assert.equal(manual.status, 409);
});

test('CP-115 · El pago manual crea un pago verificado por administración', async () => {
  const e = await crearEnvio();
  const r = await peticion('POST', `/api/envios/${e.id}/pago-manual`, { sesion: esc.admin, json: { medio: 'transferencia', referencia: 'TRX-QA-1' } });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.estado_pago, 'pagado');
  const pagos = (await peticion('GET', '/api/cobranza/pagos', { sesion: esc.admin })).datos;
  const p = pagos.find((x) => x.envio_id === e.id);
  assert.equal(p.verificacion, 'manual');
  assert.equal(p.proveedor, 'manual');
  assert.equal(p.referencia, 'TRX-QA-1');
});

test('CP-116 · Resumen de cobranza y comparador de proveedores (solo administración)', async () => {
  const r = await peticion('GET', '/api/cobranza/resumen', { sesion: esc.admin });
  assert.equal(r.status, 200);
  for (const k of ['cobrado', 'por_cobrar', 'por_conciliar', 'por_proveedor']) assert.ok(k in r.datos, k);
  const est = await peticion('GET', '/api/cobranza/estimar?monto=3500&envios_mes=100', { sesion: esc.admin });
  assert.equal(est.status, 200);
  assert.ok(est.datos.proveedores.length >= 4);
  assert.equal(est.datos.envios_mes, 100);
  assert.equal((await peticion('GET', '/api/cobranza/resumen', { sesion: esc.cliente })).status, 403);
  assert.equal((await peticion('GET', '/api/cobranza/pagos', { sesion: esc.repartidor })).status, 403);
});
