// Pago por transferencia con comprobante: el cliente sube la imagen, el pago queda en revisión y
// administración lo aprueba o lo rechaza. El pago manda: sin pago aprobado no hay ticket, asignación ni retiro.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { API, datosEnvio, escenario, formulario, jpegPrueba, pdfPrueba, peticion, todosDisponibles } from '../cliente.js';

let esc;
let envio;
let primero;
const subir = (sesion, id, campos = {}, archivo = [jpegPrueba(), 'transferencia.jpg']) =>
  peticion('POST', `/api/envios/${id}/comprobante`, { sesion, form: formulario(campos, archivo ? { archivo } : {}) });
const detalle = (id, sesion = esc.cliente) => peticion('GET', `/api/envios/${id}`, { sesion });
const enRevision = async (id) => (await peticion('GET', '/api/cobranza/comprobantes', { sesion: esc.admin })).datos.find((c) => c.envio_id === id);

before(async () => {
  esc = await escenario();
  envio = (await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } })).datos;
});

test('CP-160 · Sin pago aprobado: el cliente ya ve su etiqueta, pero administración no puede asignar repartidor', async () => {
  const t = await peticion('GET', `/api/envios/${envio.id}/ticket.pdf?formato=80mm`, { sesion: esc.cliente, crudo: true });
  assert.equal(t.status, 200, 'la etiqueta se imprime antes de pagar (pedido 03-10)');
  const a = await peticion('POST', `/api/envios/${envio.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidor.usuario.id } });
  assert.equal(a.status, 409);
  assert.match(a.datos.error, /pagado/);
  assert.equal((await peticion('GET', `/api/envios/${envio.id}/ticket.pdf?formato=80mm`, { sesion: esc.admin, crudo: true })).status, 200, 'administración ve el ticket siempre');
});

test('CP-161 · El comprobante es obligatorio y debe ser imagen o PDF real', async () => {
  const sin = await subir(esc.cliente, envio.id, {}, null);
  assert.equal(sin.status, 422);
  assert.ok(sin.datos.detalles.archivo);
  const falso = await subir(esc.cliente, envio.id, {}, [new Blob(['no soy una imagen'], { type: 'image/png' }), 'x.png']);
  assert.equal(falso.status, 422);
  const texto = await subir(esc.cliente, envio.id, {}, [new Blob(['hola'], { type: 'text/plain' }), 'x.txt']);
  assert.equal(texto.status, 422);
  assert.equal((await detalle(envio.id)).datos.estado_pago, 'pendiente');
});

test('CP-162 · Solo el dueño o administración suben comprobantes (repartidor 403, otro cliente 404)', async () => {
  assert.equal((await subir(esc.repartidor, envio.id)).status, 403);
  assert.equal((await subir(esc.clienteB, envio.id)).status, 404);
});

test('CP-163 · El cliente sube el comprobante: el pago queda en revisión y no se puede tomar ni retirar', async () => {
  const r = await subir(esc.cliente, envio.id, { referencia: 'OP-123456' });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.estado, 'en_revision');
  assert.equal(r.datos.monto, 3500);
  primero = r.datos;
  const d = await detalle(envio.id);
  assert.equal(d.datos.estado_pago, 'en_revision');
  assert.equal(d.datos.pagos[0].estado, 'en_revision');
  assert.ok(d.datos.pagos[0].comprobante.url, 'el cliente ve su comprobante');
  const disp = await todosDisponibles(esc.repartidor);
  assert.ok(!disp.items.some((e) => e.id === envio.id), 'no aparece en disponibles');
  assert.equal((await peticion('POST', `/api/envios/${envio.id}/tomar`, { sesion: esc.repartidor })).status, 409);
  assert.equal((await peticion('POST', `/api/envios/${envio.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidor.usuario.id } })).status, 409);
  assert.equal((await peticion('GET', `/api/envios/${envio.id}/ticket.pdf`, { sesion: esc.cliente, crudo: true })).status, 200, 'la etiqueta no depende del pago');
});

test('CP-164 · Con un comprobante en revisión no se sube otro, ni se paga en línea, ni se registra pago manual', async () => {
  assert.equal((await subir(esc.cliente, envio.id)).status, 409);
  assert.equal((await peticion('POST', `/api/envios/${envio.id}/pago`, { sesion: esc.cliente })).status, 409);
  assert.equal((await peticion('POST', `/api/envios/${envio.id}/link-pago`, { sesion: esc.cliente })).status, 409);
  assert.equal((await peticion('POST', `/api/envios/${envio.id}/pago-manual`, { sesion: esc.admin, json: { medio: 'transferencia' } })).status, 409);
});

test('CP-165 · Administración ve el comprobante por revisar; el cliente y el repartidor no acceden a la revisión', async () => {
  const c = await enRevision(envio.id);
  assert.ok(c, 'aparece en la lista de comprobantes por revisar');
  assert.equal(c.folio, envio.folio);
  assert.equal(c.referencia, 'OP-123456');
  const img = await fetch(`${API}${c.comprobante_url}`);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/jpeg/);
  for (const s of [esc.cliente, esc.repartidor]) {
    assert.equal((await peticion('GET', '/api/cobranza/comprobantes', { sesion: s })).status, 403);
    assert.equal((await peticion('POST', `/api/cobranza/comprobantes/${primero.id}/aprobar`, { sesion: s })).status, 403);
  }
});

test('CP-166 · Rechazar exige motivo; al rechazar el envío vuelve a pendiente y el cliente ve el motivo', async () => {
  const sinMotivo = await peticion('POST', `/api/cobranza/comprobantes/${primero.id}/rechazar`, { sesion: esc.admin, json: { motivo: '  ' } });
  assert.equal(sinMotivo.status, 422);
  const r = await peticion('POST', `/api/cobranza/comprobantes/${primero.id}/rechazar`, { sesion: esc.admin, json: { motivo: 'El monto transferido no coincide' } });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  const d = await detalle(envio.id);
  assert.equal(d.datos.estado_pago, 'pendiente');
  assert.equal(d.datos.pagos[0].estado, 'rechazado');
  assert.equal(d.datos.pagos[0].motivo_rechazo, 'El monto transferido no coincide');
  assert.equal((await peticion('POST', `/api/cobranza/comprobantes/${primero.id}/aprobar`, { sesion: esc.admin })).status, 409, 'un comprobante rechazado no se aprueba después');
  assert.equal((await peticion('GET', `/api/envios/${envio.id}/ticket.pdf`, { sesion: esc.cliente, crudo: true })).status, 200, 'la etiqueta no depende del pago');
});

test('CP-167 · El cliente sube un comprobante nuevo (PDF) y administración lo aprueba: queda pagado y con ticket', async () => {
  const r = await subir(esc.cliente, envio.id, {}, [pdfPrueba(), 'comprobante.pdf']);
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  const a = await peticion('POST', `/api/cobranza/comprobantes/${r.datos.id}/aprobar`, { sesion: esc.admin, json: { referencia: 'OP-999' } });
  assert.equal(a.status, 200, JSON.stringify(a.datos));
  const d = await detalle(envio.id);
  assert.equal(d.datos.estado_pago, 'pagado');
  assert.equal(d.datos.pago_medio, 'transferencia');
  assert.equal(d.datos.pago_referencia, 'OP-999');
  assert.deepEqual(d.datos.pagos.map((p) => p.estado), ['aprobado', 'rechazado']);
  const t = await peticion('GET', `/api/envios/${envio.id}/ticket.pdf?formato=80mm`, { sesion: esc.cliente, crudo: true });
  assert.equal(t.status, 200);
  assert.equal((await peticion('POST', `/api/cobranza/comprobantes/${r.datos.id}/aprobar`, { sesion: esc.admin })).status, 409, 'no se aprueba dos veces');
  assert.equal((await subir(esc.cliente, envio.id)).status, 409, 'un envío pagado no recibe más comprobantes');
});

test('CP-168 · Pagado por transferencia: el repartidor lo toma y lo retira, sin ver el comprobante', async () => {
  const t = await peticion('POST', `/api/envios/${envio.id}/tomar`, { sesion: esc.repartidor });
  assert.equal(t.status, 200, JSON.stringify(t.datos));
  const d = await detalle(envio.id, esc.repartidor);
  assert.ok(!d.datos.adjuntos.some((a) => a.tipo === 'comprobante_pago'), 'el repartidor no ve el comprobante');
  assert.deepEqual(d.datos.pagos, []);
  assert.equal((await peticion('POST', `/api/envios/${envio.id}/estado`, { sesion: esc.repartidor, json: { estado: 'en_ruta' } })).status, 200);
});

test('CP-169 · Se avisa cuando el mismo comprobante se usa para pagar otro envío', async () => {
  const otro = (await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } })).datos;
  const r = await subir(esc.cliente, otro.id, { referencia: 'OP-999' });
  assert.equal(r.status, 201);
  const c = await enRevision(otro.id);
  assert.ok(c.usado_en.includes(envio.folio), 'marca el envío donde ya se usó');
  const a = await peticion('POST', `/api/cobranza/comprobantes/${r.datos.id}/rechazar`, { sesion: esc.admin, json: { motivo: 'Comprobante ya usado en otro envío' } });
  assert.equal(a.status, 200);
});

test('CP-170 · Dos revisiones simultáneas del mismo comprobante: solo una se aplica', async () => {
  const e = (await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } })).datos;
  const r = await subir(esc.cliente, e.id);
  const [a, b] = await Promise.all([
    peticion('POST', `/api/cobranza/comprobantes/${r.datos.id}/aprobar`, { sesion: esc.admin }),
    peticion('POST', `/api/cobranza/comprobantes/${r.datos.id}/rechazar`, { sesion: esc.admin, json: { motivo: 'Ilegible' } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const d = await detalle(e.id);
  assert.equal(d.datos.estado_pago, a.status === 200 ? 'pagado' : 'pendiente');
});
