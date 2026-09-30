import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const cotizar = (extra) => peticion('POST', '/api/envios/cotizar', { sesion: esc.cliente, json: datosEnvio(esc.comuna.id, extra) });

test('CP-10 · Envío a domicilio dentro de Santiago: $3.500', async () => {
  const r = await cotizar({});
  assert.equal(r.status, 200);
  assert.deepEqual(r.datos.errores, {});
  assert.equal(r.datos.tarifa_total, 3500);
});

test('CP-11 · Envío especial por horario: +$1.000 (total $4.500)', async () => {
  const r = await cotizar({ horario_especial: true, franja_horaria: '19:00 - 21:00' });
  assert.equal(r.datos.recargo_horario, 1000);
  assert.equal(r.datos.tarifa_total, 4500);
});

test('CP-12 · Horario especial exige indicar la franja', async () => {
  const r = await cotizar({ horario_especial: true });
  assert.ok(r.datos.errores.franja_horaria);
});

test('CP-13 · Punto Blue Express / Starken: sin límite de paquetes por $3.500', async () => {
  const r = await cotizar({ tipo_destino: 'punto_courier', courier_empresa: 'Starken', courier_punto: 'Sucursal Providencia', bultos: 12 });
  assert.deepEqual(r.datos.errores, {});
  assert.equal(r.datos.tarifa_total, 3500);
});

test('CP-14 · Punto courier exige empresa y sucursal', async () => {
  const r = await cotizar({ tipo_destino: 'punto_courier' });
  assert.ok(r.datos.errores.courier_empresa);
  assert.ok(r.datos.errores.courier_punto);
});

test('CP-15 · Más de 20 kg por bulto queda fuera de la tarifa estándar', async () => {
  const r = await cotizar({ peso_kg: 20.5 });
  assert.match(r.datos.errores.peso_kg, /20 kg/);
});

test('CP-16 · Más de 60 cm por lado queda fuera de la tarifa estándar', async () => {
  const r = await cotizar({ alto_cm: 61 });
  assert.match(r.datos.errores.alto_cm, /60 cm/);
});

test('CP-17 · 20 kg y 60×60×60 exactos sí entran en la tarifa', async () => {
  const r = await cotizar({ peso_kg: 20, largo_cm: 60, ancho_cm: 60, alto_cm: 60 });
  assert.deepEqual(r.datos.errores, {});
  assert.equal(r.datos.tarifa_total, 3500);
});

test('CP-18 · Comuna fuera de cobertura no permite crear el envío (RF-18)', async () => {
  const c = await peticion('GET', '/api/comunas?q=Valpara');
  const valpo = c.datos.find((x) => x.nombre === 'Valparaíso');
  const r = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: datosEnvio(valpo.id) });
  assert.equal(r.status, 422);
  assert.match(JSON.stringify(r.datos.detalles), /fuera de la zona de cobertura/);
});

test('CP-19 · Solo administración puede cotizar con tarifa manual un paquete sobredimensionado', async () => {
  const cli = await peticion('POST', '/api/envios/cotizar', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, { peso_kg: 35 }), tarifa_manual: 9000 } });
  assert.ok(cli.datos.errores.peso_kg);
  const adm = await peticion('POST', '/api/envios/cotizar', { sesion: esc.admin, json: { ...datosEnvio(esc.comuna.id, { peso_kg: 35 }), tarifa_manual: 9000 } });
  assert.deepEqual(adm.datos.errores, {});
  assert.equal(adm.datos.tarifa_total, 9000);
});

test('CP-67 · Couriers y franjas se editan desde Ajustes y se aplican al cotizar', async () => {
  const antes = (await peticion('GET', '/api/config/publica')).datos;
  const cli = await peticion('PUT', '/api/config/listas', { sesion: esc.cliente, json: { couriers: 'X' } });
  assert.equal(cli.status, 403);
  const vacia = await peticion('PUT', '/api/config/listas', { sesion: esc.admin, json: { couriers: '\n' } });
  assert.equal(vacia.status, 422);
  try {
    const r = await peticion('PUT', '/api/config/listas', { sesion: esc.admin, json: { couriers: `${antes.couriers.join('\n')}\nCourier QA`, franjas: `${antes.franjas.join('\n')}\n06:00 – 07:00` } });
    assert.equal(r.status, 200);
    const pub = (await peticion('GET', '/api/config/publica')).datos;
    assert.ok(pub.couriers.includes('Courier QA') && pub.franjas.includes('06:00 – 07:00'));
    const ok = await cotizar({ tipo_destino: 'punto_courier', courier_empresa: 'Courier QA', courier_punto: 'Sucursal QA', horario_especial: true, franja_horaria: '06:00 - 07:00' });
    assert.deepEqual(ok.datos.errores, {});
    const fuera = await cotizar({ horario_especial: true, franja_horaria: '03:00 – 04:00' });
    assert.ok(fuera.datos.errores.franja_horaria);
  } finally {
    await peticion('PUT', '/api/config/listas', { sesion: esc.admin, json: { couriers: antes.couriers, franjas: antes.franjas } });
  }
});
