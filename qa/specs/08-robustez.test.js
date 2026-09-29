// Errores encontrados en la revisión del 29/09/2026: cada caso fijaba un 500 o un dato inconsistente.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, envioEnRuta, escenario, formulario, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const crear = async (extra = {}) => {
  const r = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return r.datos;
};

test('CP-80 · Medidas con decimales, bultos o valor declarado fuera de rango → 422 (no error interno)', async () => {
  for (const [campo, valor] of [['largo_cm', 30.5], ['bultos', 1000], ['valor_declarado', 99_999_999_999], ['peso_kg', 5000]]) {
    const r = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), [campo]: valor } });
    assert.equal(r.status, 422, `${campo}=${valor}: ${JSON.stringify(r.datos)}`);
    assert.ok(r.datos.detalles[campo], campo);
  }
});

test('CP-81 · Filtros con valores inválidos responden 400 o se ajustan (no error interno)', async () => {
  assert.equal((await peticion('GET', '/api/envios?limite=-5', { sesion: esc.cliente })).status, 200);
  assert.equal((await peticion('GET', '/api/envios?desde=hola', { sesion: esc.cliente })).status, 400);
  assert.equal((await peticion('GET', '/api/envios?comuna_id=abc', { sesion: esc.admin })).status, 400);
  assert.equal((await peticion('GET', '/api/envios?desde=2026-02-31', { sesion: esc.cliente })).status, 400);
});

test('CP-82 · Costo con envío inexistente o fecha inválida → 422', async () => {
  assert.equal((await peticion('POST', '/api/costos', { sesion: esc.admin, json: { tipo: 'otro', monto: 100, envio_id: 99999999 } })).status, 422);
  assert.equal((await peticion('POST', '/api/costos', { sesion: esc.admin, json: { tipo: 'otro', monto: 100, fecha: 'ayer' } })).status, 422);
});

test('CP-83 · Ajustes que romperían la operación se rechazan', async () => {
  assert.equal((await peticion('PUT', '/api/config/pagos', { sesion: esc.admin, json: { proveedor: 'webpay' } })).status, 422, 'pasarela no integrada');
  assert.equal((await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { intentos_max: 0 } })).status, 422);
  assert.equal((await peticion('PUT', '/api/config/tarifas', { sesion: esc.admin, json: { base: 3500.5 } })).status, 422);
  const conf = (await peticion('GET', '/api/config/publica')).datos;
  assert.equal(conf.pagos.proveedor, 'simulado');
  assert.ok(conf.operacion.intentos_max >= 1);
});

test('CP-84 · Un pago abierto antes de anular el envío ya no lo marca como pagado', async () => {
  const e = await crear();
  const p = await peticion('POST', `/api/envios/${e.id}/pago`, { sesion: esc.cliente });
  assert.equal(p.status, 201);
  const an = await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.cliente, json: { estado: 'anulado', motivo: 'Prueba' } });
  assert.equal(an.status, 200, JSON.stringify(an.datos));
  const c = await peticion('POST', `/api/pagos/${p.datos.token}/confirmar`, { sesion: esc.cliente, json: { resultado: 'aprobado' } });
  assert.equal(c.status, 409);
  const d = await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.cliente });
  assert.equal(d.datos.estado_pago, 'pendiente');
  assert.equal(d.datos.estado, 'anulado');
});

test('CP-85 · Pulsar "Pagar" dos veces reutiliza el mismo pago abierto', async () => {
  const e = await crear();
  const a = await peticion('POST', `/api/envios/${e.id}/pago`, { sesion: esc.cliente });
  const b = await peticion('POST', `/api/envios/${e.id}/pago`, { sesion: esc.cliente });
  assert.equal(a.datos.token, b.datos.token);
});

test('CP-86 · Un envío reagendado se puede pasar a otro repartidor y conserva sus intentos', async () => {
  const e = await envioEnRuta(esc);
  const f = await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.repartidor, json: { estado: 'fallido', motivo: 'nadie_en_domicilio' } });
  assert.equal(f.status, 200);
  assert.equal((await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.admin, json: { estado: 'reagendado' } })).status, 200);
  const r = await peticion('POST', `/api/envios/${e.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidorB.usuario.id } });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.estado, 'reagendado');
  assert.equal(r.datos.intentos, 1);
  assert.equal(r.datos.repartidor_id, esc.repartidorB.usuario.id);
  assert.equal((await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.repartidorB, json: { estado: 'en_ruta' } })).status, 200);
});

test('CP-87 · Un archivo que no es imagen aunque diga "image/jpeg" se rechaza', async () => {
  const e = await crear();
  const falso = new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/jpeg' });
  const r = await peticion('POST', `/api/envios/${e.id}/adjuntos`, { sesion: esc.cliente, form: formulario({ tipo: 'foto_paquete' }, { archivo: [falso, 'foto.jpg'] }) });
  assert.equal(r.status, 422);
});

test('CP-88 · No se desactiva un repartidor con envíos en curso', async () => {
  const e = await envioEnRuta(esc);
  const r = await peticion('PATCH', `/api/usuarios/${esc.repartidor.usuario.id}`, { sesion: esc.admin, json: { activo: false } });
  assert.equal(r.status, 409);
  assert.match(r.datos.error, /en curso/);
  assert.ok(e.id);
});

test('CP-89 · Una dirección guardada define a su destinatario (no se mezcla con otro)', async () => {
  const e = await crear();
  const r = await peticion('POST', '/api/envios', {
    sesion: esc.cliente,
    json: { ...datosEnvio(esc.comuna.id), direccion: undefined, direccion_id: e.direccion_id, destinatario: { nombre: 'Otra persona', telefono: '+56 9 1111 2222' } },
  });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.destinatario_id, e.destinatario_id);
});

test('CP-90 · "Cerrados hoy" del repartidor cuenta por fecha de cierre', async () => {
  const r = await peticion('GET', '/api/envios?estado=entregado,devuelto&cerrados=hoy', { sesion: esc.repartidor });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.datos.items));
});
