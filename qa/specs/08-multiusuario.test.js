// Muchas personas operando al mismo tiempo: nadie pisa el cambio de otro (RNF-22).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { conPagoEnLinea, crearUsuarioQa, datosEnvio, envioEnRuta, escenario, formulario, jpegPrueba, pagarPorTransferencia, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const estados = (respuestas) => respuestas.map((r) => r.status).sort();

test('CP-80 · Mismo envío, 5 "intento fallido" simultáneos: se registra uno solo', async () => {
  const envio = await envioEnRuta(esc);
  const rs = await Promise.all(Array.from({ length: 5 }, () => peticion('POST', `/api/envios/${envio.id}/estado`,
    { sesion: esc.repartidor, json: { estado: 'fallido', motivo: 'nadie_en_domicilio', lat: -33.45, lon: -70.66 } })));
  assert.deepEqual(estados(rs), [200, 409, 409, 409, 409]);
  const d = await peticion('GET', `/api/envios/${envio.id}`, { sesion: esc.admin });
  assert.equal(d.datos.intentos, 1, 'no debe contar intentos de más');
  assert.equal(d.datos.historial.filter((h) => h.estado_nuevo === 'fallido').length, 1);
});

test('CP-81 · Dos administradores asignan el mismo envío a repartidores distintos: gana uno', async () => {
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  await pagarPorTransferencia(esc, c.datos.id);
  const [a, b] = await Promise.all([esc.repartidor, esc.repartidorB].map((r) => peticion('POST', `/api/envios/${c.datos.id}/asignar`,
    { sesion: esc.admin, json: { repartidor_id: r.usuario.id } })));
  assert.deepEqual(estados([a, b]), [200, 409]);
  const ganador = a.status === 200 ? a : b;
  const d = await peticion('GET', `/api/envios/${c.datos.id}`, { sesion: esc.admin });
  assert.equal(d.datos.repartidor_id, ganador.datos.repartidor_id);
});

test('CP-82 · Confirmaciones y pagos simultáneos: un folio y un solo pago', async (t) => {
  const b = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: datosEnvio(esc.comuna.id) });
  assert.equal(b.status, 201);
  const conf = await Promise.all([1, 2, 3].map(() => peticion('POST', `/api/envios/${b.datos.id}/confirmar`, { sesion: esc.cliente })));
  assert.deepEqual(estados(conf), [200, 409, 409]);
  // Dos comprobantes subidos a la vez: solo uno queda en revisión.
  const subidas = await Promise.all([1, 2].map(() => peticion('POST', `/api/envios/${b.datos.id}/comprobante`, { sesion: esc.cliente, form: formulario({}, { archivo: [jpegPrueba(), 'c.jpg'] }) })));
  assert.deepEqual(estados(subidas), [201, 409], 'un solo comprobante en revisión');
  // Pasarela en línea (apagada en la operación): si se puede encender, dos pagos simultáneos cobran uno solo.
  const otro = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  await conPagoEnLinea(t, esc, async () => {
    const pagos = await Promise.all([1, 2].map(() => peticion('POST', `/api/envios/${otro.datos.id}/pago`, { sesion: esc.cliente })));
    const tokens = pagos.filter((p) => p.status === 201).map((p) => p.datos.token);
    assert.equal(tokens.length, 2, 'se pueden iniciar dos pagos (dos pestañas)');
    const confirmados = await Promise.all(tokens.map((tk) => peticion('POST', `/api/pagos/${tk}/confirmar`, { sesion: esc.cliente, json: { resultado: 'aprobado' } })));
    assert.deepEqual(estados(confirmados), [200, 409], 'solo uno de los dos pagos se cobra');
  });
});

test('CP-83 · Muchos clientes creando envíos al mismo tiempo: folios únicos y sin errores', async () => {
  const clientes = await Promise.all(Array.from({ length: 8 }, (_, i) => crearUsuarioQa(esc.admin, 'cliente', `Simultaneo${i}`)));
  const rs = await Promise.all(clientes.flatMap((cli) => Array.from({ length: 5 }, () =>
    peticion('POST', '/api/envios', { sesion: cli, json: { ...datosEnvio(esc.comuna.id), confirmar: true } }))));
  assert.ok(rs.every((r) => r.status === 201), JSON.stringify(rs.find((r) => r.status !== 201)?.datos));
  const folios = rs.map((r) => r.datos.folio);
  assert.equal(new Set(folios).size, folios.length, 'folios repetidos');
  // Cada cliente ve solo sus 5 envíos.
  const propios = await peticion('GET', '/api/envios?limite=100', { sesion: clientes[0] });
  assert.equal(propios.datos.total, 5);
});
