// Pedidos del cliente del 19 y 22-10-2026: foto y espera del intento fallido en el seguimiento, el siguiente intento sale
// a entregar sin marcar "retirado" otra vez, formas de ordenar la ruta, anulados fuera de la lista y horario de atención.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, envioEnRuta, escenario, formulario, jpegPrueba, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.datos)); return r.datos; };
const fallidoConFoto = (id, sesion, campos = { motivo: 'nadie_en_domicilio' }) =>
  peticion('POST', `/api/envios/${id}/fallido`, { sesion, form: formulario(campos, { foto: [jpegPrueba(), 'intento.jpg'] }) });

test('CP-320 · Intento fallido con foto obligatoria: el seguimiento muestra la foto (con los 4 dígitos) y la espera', async () => {
  const e = await envioEnRuta(esc);
  ok(await peticion('POST', `/api/envios/${e.id}/llegada`, { sesion: esc.repartidor }));
  const sinFoto = await peticion('POST', `/api/envios/${e.id}/fallido`, { sesion: esc.repartidor, form: formulario({ motivo: 'nadie_en_domicilio' }) });
  assert.equal(sinFoto.status, 422);
  assert.equal(sinFoto.datos.detalles?.foto, 'Obligatoria');
  assert.equal((await fallidoConFoto(e.id, esc.cliente)).status, 403, 'el cliente no registra intentos');
  assert.equal((await fallidoConFoto(e.id, esc.repartidorB)).status, 404, 'otro repartidor no ve el envío');

  const d = ok(await fallidoConFoto(e.id, esc.repartidor, { motivo: 'nadie_en_domicilio', detalle: 'Dato privado', lat: -33.43, lon: -70.61 }));
  assert.equal(d.estado, 'fallido');
  assert.equal(d.intentos, 1);

  const s = ok(await peticion('GET', `/api/seguimiento/${e.folio}`));
  const paso = s.historial.find((h) => h.estado === 'fallido');
  assert.equal(paso.foto, true);
  assert.equal(paso.intento, 1);
  assert.match(paso.espera, /^El repartidor esperó (menos de 1 minuto|\d+ min) en el destino$/);
  assert.ok(!JSON.stringify(s).includes('Dato privado'));

  assert.equal((await peticion('POST', `/api/seguimiento/${e.folio}/foto`, { json: { clave: '0000', intento: 1 } })).status, 403);
  const foto = await peticion('POST', `/api/seguimiento/${e.folio}/foto`, { json: { clave: '4321', intento: 1 }, crudo: true });
  assert.equal(foto.status, 200);
  assert.equal(foto.headers.get('content-type'), 'image/jpeg');
  assert.equal((await peticion('POST', `/api/seguimiento/${e.folio}/foto`, { json: { clave: '4321', intento: 2 } })).status, 404);
  assert.equal((await peticion('POST', `/api/seguimiento/${e.folio}/foto`, { json: { clave: '4321', intento: 'x' } })).status, 422);

  // Administración y el cliente ven la foto ligada a ese paso del historial.
  const det = ok(await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.cliente }));
  const h = det.historial.find((x) => x.estado_nuevo === 'fallido');
  assert.ok(h.llegada_en, 'la hora de llegada queda en el paso del intento');
  const adj = det.adjuntos.find((a) => a.tipo === 'foto_fallido');
  assert.equal(adj?.envio_estado_id, h.id);
});

test('CP-321 · Siguiente intento: sale a entregar sin "Paquete retirado" (llegada, entrega o nuevo fallido)', async () => {
  const e = await envioEnRuta(esc);
  ok(await fallidoConFoto(e.id, esc.repartidor));
  ok(await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.repartidor, json: { estado: 'reagendado', motivo: 'Intento 2 programado por el repartidor' } }));

  // Llegué al destino directo desde "Reagendado": queda En ruta (intento 2) con la espera corriendo.
  const lleg = ok(await peticion('POST', `/api/envios/${e.id}/llegada`, { sesion: esc.repartidor }));
  assert.ok(lleg.llegada_en);
  let d = ok(await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.repartidor }));
  assert.equal(d.estado, 'en_ruta');
  assert.equal(d.historial.at(-1).motivo, 'Salió al intento 2');

  // Nuevo fallido y otra vez reagendado: el fallido sale directo desde "Reagendado".
  ok(await fallidoConFoto(e.id, esc.repartidor));
  ok(await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.repartidor, json: { estado: 'reagendado' } }));
  d = ok(await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.repartidor }));
  assert.equal(d.estado, 'reagendado');

  // Entrega directa desde "Reagendado" (intento 3).
  const ent = ok(await peticion('POST', `/api/envios/${e.id}/entregar`, { sesion: esc.repartidor, form: formulario({}, { foto: [jpegPrueba(), 'entrega.jpg'] }) }));
  assert.equal(ent.estado, 'entregado');
  const s = ok(await peticion('GET', `/api/seguimiento/${e.folio}`));
  assert.equal(s.historial.at(-1).label, 'Entregado en el intento 3');
  assert.equal(s.historial.filter((h) => h.estado === 'fallido' && h.foto).length, 2);

  // Un reagendado ajeno o sin el repartidor correcto no sale a ruta.
  const otro = await envioEnRuta(esc);
  ok(await fallidoConFoto(otro.id, esc.repartidor));
  ok(await peticion('POST', `/api/envios/${otro.id}/estado`, { sesion: esc.repartidor, json: { estado: 'reagendado' } }));
  assert.equal((await peticion('POST', `/api/envios/${otro.id}/llegada`, { sesion: esc.repartidorB })).status, 404);
  assert.equal((await peticion('POST', `/api/envios/${otro.id}/llegada`, { sesion: esc.cliente })).status, 403);
});

test('CP-322 · Ordenar la ruta: más corta, circular, de la más cercana a la más lejana y al revés', async () => {
  await envioEnRuta(esc);
  await envioEnRuta(esc, { direccion: { calle: 'Pajaritos', numero: '100', comuna_id: esc.comuna.id } });
  for (const modo of ['corta', 'circular', 'cerca_lejos', 'lejos_cerca']) {
    const r = ok(await peticion('POST', '/api/envios/ruta/optimizar', { sesion: esc.repartidor, json: { modo, lat: -33.45, lon: -70.66 } }));
    assert.equal(r.modo, modo);
    assert.ok(r.ids.length >= 2);
  }
  assert.equal(ok(await peticion('POST', '/api/envios/ruta/optimizar', { sesion: esc.repartidor, json: {} })).modo, 'corta');
  assert.equal((await peticion('POST', '/api/envios/ruta/optimizar', { sesion: esc.repartidor, json: { modo: 'zigzag' } })).status, 422);
});

test('CP-323 · Anulados: administración los quita de su lista; siguen con el filtro "Anulado", por folio y para el cliente', async () => {
  const c = ok(await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } }), 201);
  ok(await peticion('POST', `/api/envios/${c.id}/estado`, { sesion: esc.cliente, json: { estado: 'anulado', motivo: 'QA: ya no lo envío' } }));
  const lista = async (q = '') => ok(await peticion('GET', `/api/envios?limite=100&cliente_id=${esc.cliente.usuario.id}${q}`, { sesion: esc.admin })).items.map((e) => e.id);

  assert.ok((await lista()).includes(c.id), 'recién anulado se sigue viendo (24 h)');
  assert.equal((await peticion('POST', `/api/envios/${c.id}/ocultar`, { sesion: esc.repartidor })).status, 403);
  ok(await peticion('POST', `/api/envios/${c.id}/ocultar`, { sesion: esc.admin }));
  assert.ok(!(await lista()).includes(c.id), 'eliminado de la lista de administración');
  assert.ok((await lista('&estado=anulado')).includes(c.id), 'sigue con el filtro Anulado');
  assert.ok((await lista(`&q=${c.folio}`)).includes(c.id), 'sigue buscando su folio');
  const delCliente = ok(await peticion('GET', '/api/envios?limite=100', { sesion: esc.cliente })).items.map((e) => e.id);
  assert.ok(delCliente.includes(c.id), 'quitarlo en administración no lo quita al cliente');
  assert.equal((await peticion('POST', `/api/envios/${(await envioEnRuta(esc)).id}/ocultar`, { sesion: esc.admin })).status, 409, 'solo anulados');
});

test('CP-324 · Horario de atención visible en la configuración pública y editable por administración', async () => {
  const antes = ok(await peticion('GET', '/api/config/publica')).operacion.horario_atencion;
  assert.ok(antes, 'hay un horario de atención');
  try {
    assert.equal((await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { horario_atencion: 'x'.repeat(201) } })).status, 422);
    const r = ok(await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { horario_atencion: '  Lunes a viernes de 9:00 a 20:30 hrs. ' } }));
    assert.equal(r.horario_atencion, 'Lunes a viernes de 9:00 a 20:30 hrs.');
    assert.equal((await peticion('PUT', '/api/config/operacion', { sesion: esc.cliente, json: { horario_atencion: 'x' } })).status, 403);
  } finally {
    await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { horario_atencion: antes } });
  }
});
