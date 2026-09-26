import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { API, datosEnvio, escenario, formulario, jpegPrueba, peticion } from '../cliente.js';

let esc;
let envio;
before(async () => { esc = await escenario(); });

test('CP-20 · Validación: faltan datos obligatorios → se marcan y no avanza (RF-11)', async () => {
  const r = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { destinatario: { nombre: '', telefono: '123' }, direccion: {} } });
  assert.equal(r.status, 422);
  for (const campo of ['destinatario.nombre', 'destinatario.telefono', 'direccion.calle', 'direccion.numero', 'descripcion_producto', 'peso_kg']) {
    assert.ok(r.datos.detalles[campo], `debería marcar ${campo}`);
  }
});

test('CP-21 · El cliente crea y confirma un envío: folio único ENV-AAAA-NNNNNN (RF-19)', async () => {
  const r = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  envio = r.datos;
  assert.match(envio.folio, /^ENV-\d{4}-\d{6}$/);
  assert.equal(envio.estado, 'creado');
  assert.equal(envio.estado_pago, 'pendiente');
  assert.equal(envio.tarifa_total, 3500);
  assert.equal(envio.destinatario_telefono, '+56 9 8765 4321');
});

test('CP-22 · Ticket PDF térmico 80 mm y A4 (RF-20, RF-21)', async () => {
  for (const formato of ['80mm', 'a4']) {
    const r = await peticion('GET', `/api/envios/${envio.id}/ticket.pdf?formato=${formato}`, { sesion: esc.cliente, crudo: true });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /pdf/);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  }
});

test('CP-23 · QR PNG y página del QR con botones Google Maps y Waze (RF-23, RF-24)', async () => {
  const png = await peticion('GET', `/api/envios/${envio.id}/qr.png`, { sesion: esc.cliente, crudo: true });
  assert.equal(png.status, 200);
  assert.match(png.headers.get('content-type'), /png/);
  const pagina = await fetch(`${API}/q/${envio.token_qr}`);
  const html = await pagina.text();
  assert.match(html, /google\.com\/maps\/dir/);
  assert.match(html, /waze\.com\/ul/);
  assert.match(html, /PROVIDENCIA/);
  assert.doesNotMatch(html, /8765 4321/, 'la página del QR no debe exponer el teléfono');
});

test('CP-24 · Seguimiento público por folio sin datos personales', async () => {
  const r = await peticion('GET', `/api/seguimiento/${envio.folio}`);
  assert.equal(r.status, 200);
  assert.equal(r.datos.estado, 'creado');
  const texto = JSON.stringify(r.datos);
  assert.doesNotMatch(texto, /Destinatario QA|8765|Providencia 1234/);
});

test('CP-25 · El repartidor no ve envíos que no tiene asignados', async () => {
  const r = await peticion('GET', `/api/envios/${envio.id}`, { sesion: esc.repartidor });
  assert.equal(r.status, 404);
});

test('CP-26 · Sin pago no se puede retirar: "servicio pagado para poder retirar"', async () => {
  const a = await peticion('POST', `/api/envios/${envio.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidor.usuario.id } });
  assert.equal(a.status, 200);
  const r = await peticion('POST', `/api/envios/${envio.id}/estado`, { sesion: esc.repartidor, json: { estado: 'en_ruta' } });
  assert.equal(r.status, 409);
  assert.match(r.datos.error, /pagado/);
});

test('CP-27 · Pago en línea (proveedor simulado) marca el envío como pagado', async () => {
  const p = await peticion('POST', `/api/envios/${envio.id}/pago`, { sesion: esc.cliente });
  assert.equal(p.status, 201);
  assert.equal(p.datos.monto, 3500);
  const c = await peticion('POST', `/api/pagos/${p.datos.token}/confirmar`, { sesion: esc.cliente, json: { resultado: 'aprobado' } });
  assert.equal(c.status, 200);
  const d = await peticion('GET', `/api/envios/${envio.id}`, { sesion: esc.cliente });
  assert.equal(d.datos.estado_pago, 'pagado');
  const dos = await peticion('POST', `/api/pagos/${p.datos.token}/confirmar`, { sesion: esc.cliente, json: { resultado: 'aprobado' } });
  assert.equal(dos.status, 409, 'un pago no se procesa dos veces');
});

test('CP-28 · Con pago, el repartidor retira y el envío queda en ruta; no ve montos', async () => {
  const r = await peticion('POST', `/api/envios/${envio.id}/estado`, { sesion: esc.repartidor, json: { estado: 'en_ruta' } });
  assert.equal(r.status, 200);
  assert.equal(r.datos.estado, 'en_ruta');
  assert.equal(r.datos.tarifa_total, undefined);
  assert.equal(r.datos.valor_declarado, undefined);
});

test('CP-29 · Cerrar la entrega SIN foto es rechazado', async () => {
  const r = await peticion('POST', `/api/envios/${envio.id}/entregar`, { sesion: esc.repartidor, form: formulario({ lat: -33.4263, lon: -70.6170 }) });
  assert.equal(r.status, 422);
  assert.match(r.datos.error, /foto/i);
});

test('CP-30 · Cerrar la entrega SIN ubicación GPS es rechazado', async () => {
  const r = await peticion('POST', `/api/envios/${envio.id}/entregar`, { sesion: esc.repartidor, form: formulario({}, { foto: [jpegPrueba(), 'entrega.jpg'] }) });
  assert.equal(r.status, 422);
  assert.match(r.datos.error, /GPS/);
});

test('CP-31 · Entrega con foto + GPS: queda entregado con coordenadas', async () => {
  const r = await peticion('POST', `/api/envios/${envio.id}/entregar`, {
    sesion: esc.repartidor,
    form: formulario({ lat: -33.4263, lon: -70.6170, precision: 12, receptor: 'Conserje' }, { foto: [jpegPrueba(), 'entrega.jpg'] }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.estado, 'entregado');
  assert.equal(r.datos.entrega_lat, -33.4263);
  assert.equal(r.datos.entrega_lon, -70.617);
});

test('CP-32 · Historial con cada estado, quién y cuándo; foto recuperable sin EXIF (RF-15, RF-30)', async () => {
  const r = await peticion('GET', `/api/envios/${envio.id}`, { sesion: esc.cliente });
  const estados = r.datos.historial.map((h) => h.estado_nuevo);
  assert.deepEqual(estados, ['borrador', 'creado', 'asignado', 'en_ruta', 'entregado']);
  assert.ok(r.datos.historial.every((h) => h.fecha && h.usuario_id));
  const foto = r.datos.adjuntos.find((a) => a.tipo === 'foto_entrega');
  assert.ok(foto, 'debe existir la foto de entrega');
  const img = await fetch(`${API}${foto.url}`);
  assert.equal(img.status, 200);
  const buf = Buffer.from(await img.arrayBuffer());
  assert.equal(buf.indexOf(Buffer.from('Exif')), -1, 'la foto no debe conservar EXIF');
});

test('CP-33 · Un enlace de archivo alterado o sin firma es rechazado (RNF-06)', async () => {
  const r = await peticion('GET', `/api/envios/${envio.id}`, { sesion: esc.cliente });
  const foto = r.datos.adjuntos[0];
  const alterado = foto.url.replace(/sig=[^&]+/, 'sig=falsa');
  assert.equal((await fetch(`${API}${alterado}`)).status, 403);
  assert.equal((await fetch(`${API}/api/adjuntos/${foto.id}/archivo`)).status, 403);
});
