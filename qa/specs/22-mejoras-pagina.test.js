// Mejoras de la página (01-10-2026): libreta sin repetidos e historial con los pasos del pago.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, pagarPorTransferencia, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const crear = (extra = {}) => peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true, ...extra } });

test('CP-230 · Enviar dos veces a la misma persona y dirección no la repite en la libreta', async () => {
  const destinatario = { nombre: 'QA Repetida', telefono: '+56 9 7777 1212' };
  const a = await crear({ destinatario });
  const b = await crear({ destinatario: { nombre: '  qa repetida ', telefono: '977771212' } });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.datos.destinatario_id, a.datos.destinatario_id, 'mismo nombre y teléfono → mismo destinatario');
  assert.equal(b.datos.direccion_id, a.datos.direccion_id, 'misma dirección → no se duplica');
  const otraDir = await crear({ destinatario, direccion: { ...datosEnvio(esc.comuna.id).direccion, numero: '999' } });
  assert.equal(otraDir.datos.destinatario_id, a.datos.destinatario_id);
  assert.notEqual(otraDir.datos.direccion_id, a.datos.direccion_id, 'otra dirección → se agrega a la misma persona');
  const libreta = await peticion('GET', '/api/destinatarios', { sesion: esc.cliente });
  const iguales = libreta.datos.filter((d) => d.nombre.toLowerCase().trim() === 'qa repetida');
  assert.equal(iguales.length, 1);
  assert.equal(iguales[0].direcciones.length, 2);
  const otraPersona = await crear({ destinatario: { nombre: 'QA Repetida', telefono: '+56 9 7777 3434' } });
  assert.notEqual(otraPersona.datos.destinatario_id, a.datos.destinatario_id, 'mismo nombre con otro teléfono es otra persona');
});

test('CP-231 · El detalle entrega la fecha en que se verificó el pago (historial con los pasos del pago)', async () => {
  const c = await crear();
  await pagarPorTransferencia(esc, c.datos.id);
  const d = await peticion('GET', `/api/envios/${c.datos.id}`, { sesion: esc.cliente });
  const aprobado = d.datos.pagos.find((p) => p.estado === 'aprobado');
  assert.ok(aprobado.verificado_en, 'fecha de verificación del pago');
  assert.ok(aprobado.comprobante_adjunto_id);
});

test('CP-232 · Disponibles informa el total real y se recorre por páginas (antes: solo los 100 más antiguos)', async () => {
  const c = await crear();
  await pagarPorTransferencia(esc, c.datos.id);
  const r = await peticion('GET', '/api/envios/disponibles?limite=2', { sesion: esc.repartidor });
  assert.equal(r.status, 200);
  assert.ok(r.datos.items.length <= 2);
  assert.ok(r.datos.total >= r.datos.items.length);
  const vistos = new Set();
  for (let pagina = 1; pagina <= Math.ceil(r.datos.total / 500); pagina++) {
    const p = await peticion('GET', `/api/envios/disponibles?limite=500&pagina=${pagina}`, { sesion: esc.repartidor });
    for (const e of p.datos.items) vistos.add(e.id);
  }
  assert.equal(vistos.size, r.datos.total, 'las páginas cubren todos los disponibles');
  assert.ok(vistos.has(c.datos.id), 'el envío recién pagado se puede ver');
});
