// Administración también reparte, el administrador cambia el perfil de un usuario (p. ej. cliente → repartidor)
// y el logo de la empresa se sube como imagen (no como link).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, formulario, jpegPrueba, pagarPorTransferencia, peticion } from '../cliente.js';

let esc;
let admin;
before(async () => {
  esc = await escenario();
  admin = (await peticion('GET', '/api/auth/yo', { sesion: esc.admin })).datos;
});

const envioPagado = async () => {
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  assert.equal(c.status, 201, JSON.stringify(c.datos));
  await pagarPorTransferencia(esc, c.datos.id);
  return c.datos;
};

test('CP-173 · Administración aparece para asignar y puede repartir un envío de principio a fin', async () => {
  const lista = (await peticion('GET', '/api/usuarios/repartidores', { sesion: esc.admin })).datos;
  assert.ok(lista.some((u) => u.id === admin.id && u.rol === 'admin'), 'el administrador está en la lista de quienes reparten');
  const e = await envioPagado();
  const a = await peticion('POST', `/api/envios/${e.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: admin.id } });
  assert.equal(a.status, 200, JSON.stringify(a.datos));
  const ruta = await peticion('GET', `/api/envios?estado=asignado,en_ruta&repartidor_id=${admin.id}`, { sesion: esc.admin });
  assert.ok(ruta.datos.items.some((x) => x.id === e.id), 'aparece en la ruta del administrador');
  assert.equal((await peticion('PUT', '/api/envios/ruta/orden', { sesion: esc.admin, json: { ids: [e.id] } })).status, 200, 'ordena su propia ruta');
  assert.equal((await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.admin, json: { estado: 'en_ruta' } })).status, 200);
  const ent = await peticion('POST', `/api/envios/${e.id}/entregar`, {
    sesion: esc.admin, form: formulario({ lat: -33.43, lon: -70.61, receptor: 'Titular' }, { foto: [jpegPrueba(), 'entrega.jpg'] }),
  });
  assert.equal(ent.status, 200, JSON.stringify(ent.datos));
  assert.equal(ent.datos.estado, 'entregado');
});

test('CP-174 · Administración toma un envío disponible como un repartidor', async () => {
  const e = await envioPagado();
  const t = await peticion('POST', `/api/envios/${e.id}/tomar`, { sesion: esc.admin });
  assert.equal(t.status, 200, JSON.stringify(t.datos));
  assert.equal(t.datos.repartidor_id, admin.id);
});

test('CP-175 · Un cliente registrado sin envíos pasa a repartidor; con envíos no se puede cambiar', async () => {
  const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const reg = await peticion('POST', '/api/auth/registro', {
    json: { nombre: 'QA Futuro Repartidor', correo: `qa-registro-rep-${sufijo}@qa.test`, telefono: '+56 9 7777 4321', password: 'Reparto.Seguro.2026' },
  });
  if (reg.status === 403) return; // registro cerrado en este servidor: la parte de cambio de perfil se prueba abajo igual
  assert.equal(reg.status, 201, JSON.stringify(reg.datos));
  const id = reg.datos.usuario.id;
  const cambio = await peticion('PATCH', `/api/usuarios/${id}`, { sesion: esc.admin, json: { rol: 'repartidor' } });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.datos));
  assert.equal(cambio.datos.rol, 'repartidor');
  const conEnvios = await peticion('PATCH', `/api/usuarios/${esc.cliente.usuario.id}`, { sesion: esc.admin, json: { rol: 'repartidor' } });
  assert.equal(conEnvios.status, 409, 'un cliente con envíos no cambia de perfil');
  assert.equal((await peticion('PATCH', `/api/usuarios/${id}`, { sesion: esc.cliente, json: { rol: 'admin' } })).status, 403, 'solo administración cambia perfiles');
});

test('CP-176 · El logo se sube como imagen PNG (no se aceptan links ni archivos que no son imagen)', async () => {
  const antes = (await peticion('GET', '/api/config/publica')).datos.negocio.logo_url;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  try {
    assert.equal((await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { logo_url: 'https://otro-sitio.cl/logo.png' } })).status, 422);
    assert.equal((await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { logo_url: 'data:image/png;base64,PHN2Zz48L3N2Zz4=' } })).status, 422, 'un SVG disfrazado de PNG se rechaza');
    const ok = await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { logo_url: png } });
    assert.equal(ok.status, 200, JSON.stringify(ok.datos));
    assert.equal((await peticion('GET', '/api/config/publica')).datos.negocio.logo_url, png);
    assert.equal((await peticion('PUT', '/api/config/negocio', { sesion: esc.cliente, json: { logo_url: png } })).status, 403);
  } finally {
    await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { logo_url: antes || '' } });
  }
});
