// Pedido 13-10: soporte como conversación. Caso con número y enlace privado, mensajes de ida y vuelta con archivos,
// notas internas, aviso de respuesta nueva para el cliente, motivos y respuestas rápidas.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { escenario, formulario, jpegPrueba, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

test('CP-300 · Sin cuenta: el caso tiene número y enlace privado; con el enlace se ve la respuesta y se contesta', async () => {
  const r = await peticion('POST', '/api/soporte', { json: { nombre: 'Visita QA', contacto: 'visita@qa.test', motivo: 'reclamo', mensaje: 'Mi paquete llegó abierto' } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.match(r.datos.folio_caso, /^SOP-\d{4}-\d{6}$/);
  assert.equal(r.datos.motivo, 'reclamo');
  assert.ok(r.datos.token && r.datos.enlace.includes(r.datos.token));
  const token = r.datos.token;

  assert.equal((await peticion('GET', '/api/soporte/caso/no-existe-este-token-1234')).status, 404);
  const visto = await peticion('GET', `/api/soporte/caso/${token}`);
  assert.equal(visto.status, 200);
  assert.equal(visto.datos.caso.folio_caso, r.datos.folio_caso);
  assert.equal(visto.datos.mensajes.length, 1);
  assert.ok(!('token' in visto.datos.caso) && !('contacto' in visto.datos.caso), 'el enlace no expone datos de más');

  // Administración responde y deja una nota interna: el visitante ve la respuesta, no la nota.
  assert.equal((await peticion('POST', `/api/soporte/${r.datos.id}/mensajes`, { sesion: esc.admin, json: { texto: 'Revisar con el repartidor', interno: true } })).status, 201);
  const resp = await peticion('POST', `/api/soporte/${r.datos.id}/mensajes`, { sesion: esc.admin, json: { texto: 'Lo sentimos, lo revisamos hoy.' } });
  assert.equal(resp.status, 201, JSON.stringify(resp.datos));
  const conRespuesta = (await peticion('GET', `/api/soporte/caso/${token}`)).datos;
  assert.equal(conRespuesta.caso.estado, 'respondido');
  assert.deepEqual(conRespuesta.mensajes.map((m) => m.autor), ['cliente', 'admin']);
  assert.ok(conRespuesta.mensajes.every((m) => !m.interno));

  // El visitante contesta con una foto: el caso vuelve a "por responder".
  const contesta = await peticion('POST', `/api/soporte/caso/${token}/mensajes`, { form: formulario({ texto: 'Adjunto la foto' }, { archivo: [jpegPrueba(), 'paquete.jpg'] }) });
  assert.equal(contesta.status, 201, JSON.stringify(contesta.datos));
  assert.equal(contesta.datos.tiene_adjunto, true);
  const admin = (await peticion('GET', `/api/soporte/${r.datos.id}`, { sesion: esc.admin })).datos;
  assert.equal(admin.caso.estado, 'nuevo');
  assert.equal(admin.mensajes.length, 4, 'administración ve también la nota interna');
  const foto = await peticion('GET', `/api/soporte/caso/${token}/adjuntos/${contesta.datos.id}`, { crudo: true });
  assert.equal(foto.status, 200);
  assert.equal(foto.headers.get('content-type'), 'image/jpeg');
  assert.match(foto.headers.get('content-security-policy') || '', /sandbox/);
});

test('CP-301 · Cliente: conversación de ida y vuelta, aviso de respuesta nueva y casos ajenos ocultos', async () => {
  const r = await peticion('POST', '/api/soporte', { sesion: esc.cliente, json: { motivo: 'pago', mensaje: 'Subí el comprobante ayer' } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  const id = r.datos.id;
  assert.equal((await peticion('GET', '/api/soporte/sin-leer', { sesion: esc.cliente })).datos.sin_leer, 0);

  await peticion('POST', `/api/soporte/${id}/mensajes`, { sesion: esc.admin, json: { texto: 'Ya lo aprobamos.' } });
  await peticion('POST', `/api/soporte/${id}/mensajes`, { sesion: esc.admin, json: { texto: 'Algo más: el retiro es mañana.' } });
  assert.ok((await peticion('GET', '/api/soporte/sin-leer', { sesion: esc.cliente })).datos.sin_leer >= 1, 'el cliente ve que tiene respuesta');
  const lista = (await peticion('GET', '/api/soporte', { sesion: esc.cliente })).datos;
  assert.equal(lista.find((c) => c.id === id).no_leido_cliente, true);

  const conv = (await peticion('GET', `/api/soporte/${id}`, { sesion: esc.cliente })).datos;
  assert.deepEqual(conv.mensajes.map((m) => m.texto), ['Subí el comprobante ayer', 'Ya lo aprobamos.', 'Algo más: el retiro es mañana.'], 'la segunda respuesta no borra la primera');
  assert.ok(!('token' in conv.caso));
  assert.equal((await peticion('GET', `/api/soporte/${id}`, { sesion: esc.cliente })).datos.caso.no_leido_cliente, false, 'al abrirlo queda leído');

  const contesta = await peticion('POST', `/api/soporte/${id}/mensajes`, { sesion: esc.cliente, json: { texto: '¡Gracias!' } });
  assert.equal(contesta.status, 201);
  assert.equal((await peticion('GET', `/api/soporte/${id}`, { sesion: esc.admin })).datos.caso.estado, 'nuevo');
  // Un cliente no marca notas internas ni ve casos de otros.
  const intento = await peticion('POST', `/api/soporte/${id}/mensajes`, { sesion: esc.cliente, json: { texto: 'secreto', interno: true } });
  assert.equal(intento.datos.interno, false);
  assert.equal((await peticion('GET', `/api/soporte/${id}`, { sesion: esc.clienteB })).status, 404);
  assert.equal((await peticion('POST', `/api/soporte/${id}/mensajes`, { sesion: esc.clienteB, json: { texto: 'hola' } })).status, 404);
  assert.equal((await peticion('POST', `/api/soporte/${id}/mensajes`, { sesion: esc.cliente, json: { texto: '' } })).status, 422);
});

test('CP-302 · Filtro por motivo, cerrar y reabrir al escribir, y archivos no permitidos', async () => {
  const r = await peticion('POST', '/api/soporte', { sesion: esc.clienteB, json: { motivo: 'cuenta', mensaje: 'No puedo cambiar mi correo' } });
  const porMotivo = (await peticion('GET', '/api/soporte?motivo=cuenta', { sesion: esc.admin })).datos;
  assert.ok(porMotivo.some((c) => c.id === r.datos.id) && porMotivo.every((c) => c.motivo === 'cuenta'));
  assert.equal((await peticion('GET', '/api/soporte?motivo=xx', { sesion: esc.admin })).status, 400);

  assert.equal((await peticion('PATCH', `/api/soporte/${r.datos.id}`, { sesion: esc.admin, json: { estado: 'cerrado' } })).datos.estado, 'cerrado');
  await peticion('POST', `/api/soporte/${r.datos.id}/mensajes`, { sesion: esc.clienteB, json: { texto: 'Sigue sin funcionar' } });
  assert.equal((await peticion('GET', `/api/soporte/${r.datos.id}`, { sesion: esc.admin })).datos.caso.estado, 'nuevo', 'si el cliente escribe, se abre de nuevo');

  const txt = await peticion('POST', `/api/soporte/${r.datos.id}/mensajes`, { sesion: esc.clienteB, form: formulario({ texto: 'x' }, { archivo: [new Blob(['hola'], { type: 'text/plain' }), 'nota.txt'] }) });
  assert.equal(txt.status, 422);
});

test('CP-303 · Respuestas rápidas: solo administración las crea, ve y borra', async () => {
  assert.equal((await peticion('GET', '/api/soporte/plantillas', { sesion: esc.cliente })).status, 403);
  assert.equal((await peticion('POST', '/api/soporte/plantillas', { sesion: esc.admin, json: { titulo: '', texto: '' } })).status, 422);
  const p = await peticion('POST', '/api/soporte/plantillas', { sesion: esc.admin, json: { titulo: 'QA saludo', texto: 'Hola, te ayudamos.' } });
  assert.equal(p.status, 201);
  assert.ok((await peticion('GET', '/api/soporte/plantillas', { sesion: esc.admin })).datos.some((x) => x.id === p.datos.id));
  assert.equal((await peticion('DELETE', `/api/soporte/plantillas/${p.datos.id}`, { sesion: esc.admin })).status, 200);
  assert.equal((await peticion('DELETE', `/api/soporte/plantillas/${p.datos.id}`, { sesion: esc.admin })).status, 404);
});
