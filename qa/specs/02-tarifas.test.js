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

test('CP-13 · Envío a puntos de otras compañías (Blue Express, Starken…) en pausa: no se puede crear', async () => {
  assert.equal((await peticion('GET', '/api/config/publica')).datos.operacion.punto_courier, false);
  const r = await cotizar({ tipo_destino: 'punto_courier', courier_empresa: 'Starken', courier_punto: 'Sucursal Providencia' });
  assert.match(r.datos.errores.tipo_destino, /pausa/);
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: datosEnvio(esc.comuna.id, { tipo_destino: 'punto_courier', courier_empresa: 'Starken', courier_punto: 'Sucursal Providencia' }) });
  assert.equal(c.status, 422);
});

test('CP-14 · Si administración reactiva los puntos courier: exige empresa y sucursal, y cobra lo mismo', async () => {
  try {
    assert.equal((await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { punto_courier: true } })).status, 200);
    const falta = await cotizar({ tipo_destino: 'punto_courier' });
    assert.ok(falta.datos.errores.courier_empresa);
    assert.ok(falta.datos.errores.courier_punto);
    const ok = await cotizar({ tipo_destino: 'punto_courier', courier_empresa: 'Starken', courier_punto: 'Sucursal Providencia', bultos: 12 });
    assert.deepEqual(ok.datos.errores, {});
    assert.equal(ok.datos.tarifa_total, 3500);
  } finally {
    await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { punto_courier: false } });
  }
});

test('CP-15 · Más de 20 kg por bulto no se recibe', async () => {
  const r = await cotizar({ peso_kg: 20.5 });
  assert.match(r.datos.errores.peso_kg, /20 kg/);
});

test('CP-16 · Más de 60 cm por lado no se recibe', async () => {
  const r = await cotizar({ alto_cm: 61 });
  assert.match(r.datos.errores.alto_cm, /60 cm/);
});

test('CP-17 · Sobredimensionado (hasta 20 kg y 60×60×60 exactos): $3.500 + $2.000 = $5.500', async () => {
  const r = await cotizar({ peso_kg: 20, largo_cm: 60, ancho_cm: 60, alto_cm: 60 });
  assert.deepEqual(r.datos.errores, {});
  assert.equal(r.datos.recargo_sobredimension, 2000);
  assert.equal(r.datos.tarifa_total, 5500);
});

test('CP-171 · Estándar hasta 10 kg y 40×40×40 cm: $3.500 sin importar la cantidad de bultos', async () => {
  const r = await cotizar({ peso_kg: 10, largo_cm: 40, ancho_cm: 40, alto_cm: 40, bultos: 6 });
  assert.deepEqual(r.datos.errores, {});
  assert.equal(r.datos.recargo_sobredimension, 0);
  assert.equal(r.datos.tarifa_total, 3500);
  const creado = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, { bultos: 6 }), confirmar: true } });
  assert.equal(creado.status, 201);
  assert.equal(creado.datos.tarifa_total, 3500);
});

test('CP-172 · Pasar 10 kg o 40 cm en un lado cobra sobredimensionado ($5.500) y queda guardado en el envío', async () => {
  assert.equal((await cotizar({ peso_kg: 10.5 })).datos.tarifa_total, 5500);
  assert.equal((await cotizar({ largo_cm: 41 })).datos.tarifa_total, 5500);
  assert.equal((await cotizar({ peso_kg: 12, horario_especial: true, franja_horaria: '19:00 - 21:00' })).datos.tarifa_total, 6500);
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, { peso_kg: 15, bultos: 3 }), confirmar: true } });
  assert.equal(c.status, 201);
  assert.equal(c.datos.recargo_sobredimension, 2000);
  assert.equal(c.datos.tarifa_total, 5500);
});

test('CP-18 · Comuna fuera de cobertura no permite crear el envío (RF-18)', async () => {
  const c = await peticion('GET', '/api/comunas?q=Valpara');
  const valpo = c.datos.find((x) => x.nombre === 'Valparaíso');
  const r = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: datosEnvio(valpo.id) });
  assert.equal(r.status, 422);
  assert.match(JSON.stringify(r.datos.detalles), /fuera de la zona de cobertura/);
});

test('CP-19 · Sobre el máximo no se recibe ni con tarifa manual; la tarifa manual es solo de administración', async () => {
  const adm = await peticion('POST', '/api/envios/cotizar', { sesion: esc.admin, json: { ...datosEnvio(esc.comuna.id, { peso_kg: 35 }), tarifa_manual: 9000 } });
  assert.ok(adm.datos.errores.peso_kg, 'ni administración recibe más de 20 kg');
  const ok = await peticion('POST', '/api/envios/cotizar', { sesion: esc.admin, json: { ...datosEnvio(esc.comuna.id), tarifa_manual: 9000 } });
  assert.deepEqual(ok.datos.errores, {});
  assert.equal(ok.datos.tarifa_total, 9000);
  const cli = await peticion('POST', '/api/envios/cotizar', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), tarifa_manual: 1 } });
  assert.equal(cli.datos.tarifa_total, 3500, 'el cliente no puede fijar su tarifa');
});

test('CP-67 · Couriers y franjas se editan desde Ajustes y se aplican al cotizar', async () => {
  const antes = (await peticion('GET', '/api/config/publica')).datos;
  const cli = await peticion('PUT', '/api/config/listas', { sesion: esc.cliente, json: { couriers: 'X' } });
  assert.equal(cli.status, 403);
  const vacia = await peticion('PUT', '/api/config/listas', { sesion: esc.admin, json: { couriers: '\n' } });
  assert.equal(vacia.status, 422);
  try {
    await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { punto_courier: true } });
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
    await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { punto_courier: false } });
  }
});
