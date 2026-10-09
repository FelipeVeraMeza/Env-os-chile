// Pedidos 09-10: mensajes a soporte que llegan a administración, y la foto del paquete en el seguimiento.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, formulario, jpegPrueba, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

test('CP-280 · Sin sesión se escribe a soporte dejando cómo responder; el mensaje llega a administración', async () => {
  const sinContacto = await peticion('POST', '/api/soporte', { json: { nombre: 'Visita QA', mensaje: 'No encuentro mi envío' } });
  assert.equal(sinContacto.status, 422);
  assert.ok(sinContacto.datos.detalles.contacto);
  const folioMalo = await peticion('POST', '/api/soporte', { json: { nombre: 'Visita QA', contacto: 'visita@qa.test', folio: 'ABC', mensaje: 'Hola soporte' } });
  assert.equal(folioMalo.status, 422);
  assert.ok(folioMalo.datos.detalles.folio);

  const r = await peticion('POST', '/api/soporte', { json: { nombre: 'Visita QA', contacto: '+56 9 1111 2222', folio: 'env-2026-000001', mensaje: 'Mi paquete no llega' } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.estado, 'nuevo');
  assert.equal(r.datos.folio, 'ENV-2026-000001');

  const bandeja = await peticion('GET', '/api/soporte?estado=nuevo', { sesion: esc.admin });
  assert.equal(bandeja.status, 200);
  assert.ok(bandeja.datos.some((m) => m.id === r.datos.id && m.usuario_id === null));
  assert.ok((await peticion('GET', '/api/soporte/nuevos', { sesion: esc.admin })).datos.nuevos >= 1);
  // Sin sesión no se lee la bandeja, y un cliente no ve mensajes de otros.
  assert.equal((await peticion('GET', '/api/soporte')).status, 401);
  assert.ok(!(await peticion('GET', '/api/soporte', { sesion: esc.cliente })).datos.some((m) => m.id === r.datos.id));
});

test('CP-281 · El cliente escribe desde su cuenta, administración responde y el cliente ve la respuesta', async () => {
  const r = await peticion('POST', '/api/soporte', { sesion: esc.clienteB, json: { mensaje: 'Necesito cambiar la hora de retiro' } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.nombre, esc.clienteB.usuario.nombre, 'con sesión se usa el nombre de la cuenta');

  assert.equal((await peticion('POST', `/api/soporte/${r.datos.id}/responder`, { sesion: esc.clienteB, json: { respuesta: 'yo mismo' } })).status, 403);
  assert.equal((await peticion('POST', `/api/soporte/${r.datos.id}/responder`, { sesion: esc.admin, json: { respuesta: '  ' } })).status, 422);
  const resp = await peticion('POST', `/api/soporte/${r.datos.id}/responder`, { sesion: esc.admin, json: { respuesta: 'Listo, lo cambiamos para mañana.' } });
  assert.equal(resp.status, 200, JSON.stringify(resp.datos));
  assert.equal(resp.datos.estado, 'respondido');

  const mios = (await peticion('GET', '/api/soporte', { sesion: esc.clienteB })).datos;
  const m = mios.find((x) => x.id === r.datos.id);
  assert.equal(m.respuesta, 'Listo, lo cambiamos para mañana.');
  assert.ok(mios.every((x) => x.usuario_id === esc.clienteB.usuario.id), 'el cliente solo ve sus mensajes');

  assert.equal((await peticion('PATCH', `/api/soporte/${r.datos.id}`, { sesion: esc.clienteB, json: { estado: 'cerrado' } })).status, 403);
  assert.equal((await peticion('PATCH', `/api/soporte/${r.datos.id}`, { sesion: esc.admin, json: { estado: 'cerrado' } })).datos.estado, 'cerrado');
  // Al abrirlo de nuevo vuelve a "respondido" (ya tiene respuesta), no a "nuevo".
  assert.equal((await peticion('PATCH', `/api/soporte/${r.datos.id}`, { sesion: esc.admin, json: { estado: 'nuevo' } })).datos.estado, 'respondido');
});

test('CP-282 · La foto del paquete se ve en el seguimiento con los 4 últimos dígitos del teléfono de quien recibe', async () => {
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  assert.equal(c.status, 201, JSON.stringify(c.datos));
  const folio = c.datos.folio;
  assert.equal((await peticion('GET', `/api/seguimiento/${folio}`)).datos.foto_paquete, false);
  assert.equal((await peticion('POST', `/api/seguimiento/${folio}/foto`, { json: { clave: '4321' } })).status, 404, 'sin foto');

  const sub = await peticion('POST', `/api/envios/${c.datos.id}/adjuntos`, { sesion: esc.cliente, form: formulario({ tipo: 'foto_paquete' }, { archivo: [jpegPrueba(), 'paquete.jpg'] }) });
  assert.equal(sub.status, 201, JSON.stringify(sub.datos));
  const s = (await peticion('GET', `/api/seguimiento/${folio}`)).datos;
  assert.equal(s.foto_paquete, true);
  assert.ok(!JSON.stringify(s).includes('8765'), 'el seguimiento no muestra el teléfono');

  const mal = await peticion('POST', `/api/seguimiento/${folio}/foto`, { json: { clave: '0000' } });
  assert.equal(mal.status, 403);
  assert.equal((await peticion('POST', `/api/seguimiento/${folio}/foto`, { json: { clave: '12' } })).status, 422);
  const ok = await peticion('POST', `/api/seguimiento/${folio}/foto`, { json: { clave: '4321' }, crudo: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.match(ok.headers.get('content-security-policy') || '', /sandbox/);
  assert.ok((await ok.arrayBuffer()).byteLength > 100);
});

test('CP-283 · El WhatsApp de soporte se guarda normalizado y se rechaza uno inválido', async () => {
  const antes = (await peticion('GET', '/api/config/publica')).datos.negocio.whatsapp || '';
  try {
    assert.equal((await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { whatsapp: '12345' } })).status, 422);
    const r = await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { whatsapp: '987654321' } });
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    assert.equal(r.datos.whatsapp, '+56 9 8765 4321');
    assert.equal((await peticion('GET', '/api/config/publica')).datos.negocio.whatsapp, '+56 9 8765 4321');
  } finally {
    await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { whatsapp: antes } });
  }
});

test('CP-284 · Ganancias en Excel (solo administración) y registro filtrado por comuna', async () => {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const csv = await peticion('GET', `/api/reportes/ganancias.csv?desde=${hoy}&hasta=${hoy}`, { sesion: esc.admin, crudo: true });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const texto = await csv.text();
  for (const s of ['Reporte de ganancias', 'Ganancia neta', 'Por día', 'Por comuna', 'Por repartidor', 'Costos por tipo']) assert.ok(texto.includes(s), s);
  assert.equal((await peticion('GET', `/api/reportes/ganancias.csv?desde=${hoy}&hasta=${hoy}`, { sesion: esc.cliente })).status, 403);

  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  assert.equal(c.status, 201, JSON.stringify(c.datos));
  const lista = (await peticion('GET', `/api/envios?comuna_id=${esc.comuna.id}&limite=100`, { sesion: esc.cliente })).datos;
  assert.ok(lista.items.some((e) => e.id === c.datos.id));
  assert.ok(lista.items.every((e) => e.comuna_id === esc.comuna.id || e.comuna_nombre === esc.comuna.nombre));
});
