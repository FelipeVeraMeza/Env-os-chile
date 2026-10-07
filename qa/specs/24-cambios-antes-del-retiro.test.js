// Pedidos del cliente del 07-10: cambiar la dirección de destino antes del retiro (aunque ya esté pagado),
// reagendar el retiro cuando el repartidor ya tomó el servicio, y anulados fuera de la vista del cliente.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { comunaEnCobertura, datosEnvio, envioEnRuta, escenario, pagarPorTransferencia, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const crear = async (extra = {}) => {
  const r = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, extra), confirmar: true } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return r.datos;
};
const asignado = async () => {
  const e = await crear();
  await pagarPorTransferencia(esc, e.id);
  const a = await peticion('POST', `/api/envios/${e.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidor.usuario.id } });
  assert.equal(a.status, 200, JSON.stringify(a.datos));
  return a.datos;
};
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const dia = (n) => { const d = new Date(`${hoyChile()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nuevaDireccion = (extra = {}) => ({ direccion: { calle: 'Nueva Calle QA', numero: '777', depto: '', referencia: 'Portón verde', comuna_id: esc.comuna.id, ...extra } });

test('CP-240 · Pagado y con repartidor: el cliente cambia el destino; el monto no cambia y queda en el historial', async () => {
  const e = await asignado();
  const r = await peticion('POST', `/api/envios/${e.id}/cambiar-destino`, { sesion: esc.cliente, json: nuevaDireccion() });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.calle, 'Nueva Calle QA');
  assert.equal(r.datos.estado, 'asignado', 'sigue con su repartidor');
  assert.equal(r.datos.estado_pago, 'pagado');
  assert.equal(r.datos.tarifa_total, e.tarifa_total);
  const h = (await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.cliente })).datos.historial.at(-1);
  assert.equal(h.estado_anterior, h.estado_nuevo);
  assert.match(h.motivo, /^Destino cambiado: .*Nueva Calle QA 777/);
  const rep = await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.repartidor });
  assert.equal(rep.datos.calle, 'Nueva Calle QA', 'el repartidor ve la dirección nueva');
  const pub = await peticion('GET', `/api/seguimiento/${e.folio}`);
  if (pub.status === 200) assert.ok(pub.datos.historial.every((x, i, l) => i === 0 || x.estado !== l[i - 1].estado), 'el seguimiento público no repite estados');
});

test('CP-241 · Se puede elegir otra dirección guardada del mismo destinatario, pero no la actual ni una ajena', async () => {
  const e = await crear();
  const libreta = await peticion('GET', '/api/destinatarios', { sesion: esc.cliente });
  const dest = libreta.datos.find((d) => d.id === e.destinatario_id);
  const misma = await peticion('POST', `/api/envios/${e.id}/cambiar-destino`, { sesion: esc.cliente, json: { direccion_id: e.direccion_id } });
  assert.equal(misma.status, 422);
  const nueva = await peticion('POST', `/api/envios/${e.id}/cambiar-destino`, { sesion: esc.cliente, json: nuevaDireccion({ calle: 'Guardada QA' }) });
  assert.equal(nueva.status, 200, JSON.stringify(nueva.datos));
  const volver = await peticion('POST', `/api/envios/${e.id}/cambiar-destino`, { sesion: esc.cliente, json: { direccion_id: e.direccion_id } });
  assert.equal(volver.status, 200, 'vuelve a la dirección guardada anterior');
  assert.equal(volver.datos.calle, dest.direcciones.find((d) => d.id === e.direccion_id).calle);
  const otro = await peticion('POST', '/api/envios', { sesion: esc.clienteB, json: { ...datosEnvio(esc.comuna.id, { destinatario: { nombre: 'Otro QA', telefono: '+56 9 1111 2222' } }), confirmar: true } });
  const ajena = await peticion('POST', `/api/envios/${e.id}/cambiar-destino`, { sesion: esc.cliente, json: { direccion_id: otro.datos.direccion_id } });
  assert.equal(ajena.status, 422);
});

test('CP-242 · No se cambia el destino después del retiro, con comprobante en revisión ni de un envío ajeno; el repartidor no puede', async () => {
  const enRuta = await envioEnRuta(esc);
  assert.equal((await peticion('POST', `/api/envios/${enRuta.id}/cambiar-destino`, { sesion: esc.cliente, json: nuevaDireccion() })).status, 409);
  const e = await crear();
  assert.equal((await peticion('POST', `/api/envios/${e.id}/cambiar-destino`, { sesion: esc.clienteB, json: nuevaDireccion() })).status, 404);
  assert.equal((await peticion('POST', `/api/envios/${e.id}/cambiar-destino`, { sesion: esc.repartidor, json: nuevaDireccion() })).status, 403);
  const malo = await peticion('POST', `/api/envios/${e.id}/cambiar-destino`, { sesion: esc.cliente, json: nuevaDireccion({ calle: '' }) });
  assert.equal(malo.status, 422);
  assert.ok(malo.datos.detalles['direccion.calle']);
});

test('CP-243 · Por pagar, otra comuna con otra tarifa actualiza el monto; pagado, si cuesta más se rechaza (admin sí puede)', async (t) => {
  // Cambia por un momento la tarifa de una comuna: solo en el ambiente local.
  if ((process.env.QA_OBJETIVO || 'local') !== 'local') return t.skip('cambia tarifas: solo en local');
  const otra = await comunaEnCobertura('Las Condes');
  if (otra.id === esc.comuna.id) return t.skip('no hay otra comuna en cobertura');
  const antes = otra.tarifa_base ?? null;
  assert.equal((await peticion('PATCH', `/api/comunas/${otra.id}`, { sesion: esc.admin, json: { tarifa_base: 4800 } })).status, 200);
  try {
    const pend = await crear();
    const r = await peticion('POST', `/api/envios/${pend.id}/cambiar-destino`, { sesion: esc.cliente, json: nuevaDireccion({ comuna_id: otra.id }) });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.tarifa_total, 4800 + pend.tarifa_total - pend.tarifa_base);
    assert.equal(r.datos.cambio_monto, true);
    const pag = await asignado();
    const caro = await peticion('POST', `/api/envios/${pag.id}/cambiar-destino`, { sesion: esc.cliente, json: nuevaDireccion({ comuna_id: otra.id }) });
    assert.equal(caro.status, 409);
    assert.match(caro.datos.error, /cuesta/);
    const admin = await peticion('POST', `/api/envios/${pag.id}/cambiar-destino`, { sesion: esc.admin, json: nuevaDireccion({ comuna_id: otra.id }) });
    assert.equal(admin.status, 200, JSON.stringify(admin.datos));
    assert.equal(admin.datos.tarifa_total, pag.tarifa_total, 'pagado: el monto no cambia');
  } finally {
    await peticion('PATCH', `/api/comunas/${otra.id}`, { sesion: esc.admin, json: { tarifa_base: antes } });
  }
});

test('CP-244 · Con el repartidor asignado, el cliente reagenda el retiro; el repartidor lo sigue teniendo y ve la fecha', async () => {
  const e = await asignado();
  const r = await peticion('POST', `/api/envios/${e.id}/reagendar-retiro`, { sesion: esc.cliente, json: { fecha: dia(2) } });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.retiro_fecha, dia(2));
  assert.equal(r.datos.estado, 'asignado');
  assert.match((await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.cliente })).datos.historial.at(-1).motivo, /^Retiro reagendado para el /);
  const rep = await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.repartidor });
  assert.equal(rep.datos.retiro_fecha, dia(2));
  assert.equal(rep.datos.repartidor_id, esc.repartidor.usuario.id);
  const ruta = await peticion('GET', '/api/envios?orden=ruta&limite=100', { sesion: esc.repartidor });
  assert.ok(ruta.datos.items.some((x) => x.id === e.id && x.retiro_fecha === dia(2)), 'sigue en la ruta del repartidor con la fecha');
});

test('CP-245 · Reagendar: desde mañana hasta 14 días, no después del retiro, no ajeno, y máximo 3 veces para el cliente', async () => {
  const e = await asignado();
  const pedir = (fecha, sesion = esc.cliente, id = e.id) => peticion('POST', `/api/envios/${id}/reagendar-retiro`, { sesion, json: { fecha } });
  assert.equal((await pedir(dia(0))).status, 422, 'hoy no');
  assert.equal((await pedir(dia(15))).status, 422, 'más de 14 días no');
  assert.equal((await pedir('no-es-fecha')).status, 422);
  assert.equal((await pedir(dia(1), esc.clienteB)).status, 404);
  assert.equal((await pedir(dia(1), esc.repartidor)).status, 403);
  for (const n of [1, 2, 3]) assert.equal((await pedir(dia(n))).status, 200);
  assert.equal((await pedir(dia(4))).status, 409, 'el cuarto lo hace administración');
  assert.equal((await pedir(dia(4), esc.admin)).status, 200);
  const enRuta = await envioEnRuta(esc);
  assert.equal((await pedir(dia(1), esc.cliente, enRuta.id)).status, 409);
});

test('CP-246 · El cliente elimina un envío anulado de su lista; administración lo sigue viendo', async () => {
  const e = await crear();
  assert.equal((await peticion('POST', `/api/envios/${e.id}/ocultar`, { sesion: esc.cliente })).status, 409, 'solo anulados');
  assert.equal((await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.cliente, json: { estado: 'anulado', motivo: 'QA' } })).status, 200);
  const enLista = async (sesion) => (await peticion('GET', '/api/envios?limite=100&estado=anulado', { sesion })).datos.items.some((x) => x.id === e.id);
  assert.ok(await enLista(esc.cliente), 'recién anulado, el cliente lo ve');
  assert.equal((await peticion('POST', `/api/envios/${e.id}/ocultar`, { sesion: esc.clienteB })).status, 404);
  assert.equal((await peticion('POST', `/api/envios/${e.id}/ocultar`, { sesion: esc.cliente })).status, 200);
  assert.equal(await enLista(esc.cliente), false, 'ya no aparece en su lista');
  assert.ok(await enLista(esc.admin), 'administración lo sigue viendo');
});

test('CP-247 · Al ordenar la ruta, los retiros reagendados para otro día quedan al final', async () => {
  const hoyMismo = await asignado();
  const otroDia = await asignado();
  const otro = await asignado();
  assert.equal((await peticion('POST', `/api/envios/${otroDia.id}/reagendar-retiro`, { sesion: esc.cliente, json: { fecha: dia(13) } })).status, 200);
  const r = await peticion('POST', '/api/envios/ruta/optimizar', { sesion: esc.repartidor, json: { lat: -33.43, lon: -70.61 } });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.ids.at(-1), otroDia.id, 'el reagendado va al final');
  assert.ok(r.datos.ids.includes(hoyMismo.id) && r.datos.ids.includes(otro.id));
  const ruta = await peticion('GET', '/api/envios?estado=asignado,en_ruta,reagendado,fallido&limite=100&orden=ruta', { sesion: esc.repartidor });
  assert.equal(ruta.datos.items.at(-1).id, otroDia.id, 'la lista del repartidor respeta ese orden');
});
