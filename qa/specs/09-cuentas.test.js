// Cuentas reales: cada persona entra con su correo y contraseña (RF-01, RF-02, RF-03, RF-05, RF-56).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { envioEnRuta, escenario, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
async function usuarioConClave(rol, clave = 'Clave.Inicial.2026') {
  const correo = `qa-cuenta-${rol}-${Math.random().toString(36).slice(2, 7)}-${sufijo}@qa.test`;
  const r = await peticion('POST', '/api/usuarios', { sesion: esc.admin, json: { nombre: `QA Cuenta ${rol}`, correo, rol, password: clave } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return { ...r.datos, clave };
}
const login = (correo, password) => peticion('POST', '/api/auth/login', { json: { correo, password } });
const conToken = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

test('CP-85 · Inicio de sesión con correo y contraseña; sesión de 30 días (RF-01, RF-03)', async () => {
  const u = await usuarioConClave('cliente');
  const malo = await login(u.correo, 'otra-clave-123');
  assert.equal(malo.status, 401);
  const ok = await login(u.correo.toUpperCase(), u.clave);
  assert.equal(ok.status, 200);
  const payload = JSON.parse(Buffer.from(ok.datos.token.split('.')[1], 'base64url'));
  assert.ok(payload.exp - payload.iat >= 30 * 24 * 3600 - 5, 'la sesión dura 30 días');
  const yo = await peticion('GET', '/api/auth/yo', { sesion: conToken(ok.datos.token) });
  assert.equal(yo.datos.id, u.id);
  assert.equal((await peticion('GET', '/api/envios', { sesion: conToken(ok.datos.token) })).status, 200);
});

test('CP-86 · Cambiar la contraseña cierra las otras sesiones (RF-02)', async () => {
  const u = await usuarioConClave('repartidor');
  const viejo = (await login(u.correo, u.clave)).datos.token;
  await new Promise((r) => setTimeout(r, 1100)); // "iat" tiene resolución de 1 s
  const mala = await peticion('POST', '/api/auth/cambiar-password', { sesion: conToken(viejo), json: { actual: 'no-es', nueva: 'Nueva.Clave.2026' } });
  assert.equal(mala.status, 422);
  const corta = await peticion('POST', '/api/auth/cambiar-password', { sesion: conToken(viejo), json: { actual: u.clave, nueva: 'corta' } });
  assert.equal(corta.status, 422);
  const r = await peticion('POST', '/api/auth/cambiar-password', { sesion: conToken(viejo), json: { actual: u.clave, nueva: 'Nueva.Clave.2026' } });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 1100));
  assert.equal((await peticion('GET', '/api/auth/yo', { sesion: conToken(viejo) })).status, 401, 'la sesión anterior queda cerrada');
  assert.equal((await peticion('GET', '/api/auth/yo', { sesion: conToken(r.datos.token) })).status, 200, 'la sesión actual sigue abierta');
  assert.equal((await login(u.correo, u.clave)).status, 401);
  assert.equal((await login(u.correo, 'Nueva.Clave.2026')).status, 200);
});

test('CP-87 · Recuperación: enlace de un solo uso generado por administración (RF-02)', async () => {
  const u = await usuarioConClave('cliente');
  const generico = await peticion('POST', '/api/auth/recuperar', { json: { correo: 'no-existe@qa.test' } });
  assert.equal(generico.status, 200, 'no revela si el correo existe');
  assert.equal((await peticion('POST', `/api/usuarios/${u.id}/restablecer`, { sesion: esc.cliente })).status, 403);
  const g = await peticion('POST', `/api/usuarios/${u.id}/restablecer`, { sesion: esc.admin });
  assert.equal(g.status, 200);
  const token = g.datos.enlace.split('#/restablecer/')[1];
  assert.ok(token);
  assert.equal((await peticion('GET', '/api/auth/yo', { sesion: conToken(token) })).status, 401, 'el enlace no sirve como sesión');
  assert.equal((await peticion('POST', '/api/auth/restablecer', { json: { token, password: 'Recuperada.2026' } })).status, 200);
  assert.equal((await peticion('POST', '/api/auth/restablecer', { json: { token, password: 'Otra.Vez.2026' } })).status, 400, 'un solo uso');
  assert.equal((await login(u.correo, 'Recuperada.2026')).status, 200);
  assert.equal((await peticion('POST', '/api/auth/restablecer', { json: { token: 'basura', password: 'Recuperada.2026' } })).status, 400);
});

test('CP-88 · Registro de clientes: cerrado por defecto y habilitable por administración (RF-56)', async () => {
  const antes = (await peticion('GET', '/api/config/publica')).datos.operacion.registro_clientes;
  const datos = { nombre: 'Tienda QA', correo: `qa-registro-${sufijo}@qa.test`, telefono: '+56 9 7777 1234', password: 'Registro.2026' };
  try {
    await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { registro_clientes: false } });
    assert.equal((await peticion('POST', '/api/auth/registro', { json: datos })).status, 403);
    await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { registro_clientes: true } });
    const sinFono = await peticion('POST', '/api/auth/registro', { json: { ...datos, telefono: '' } });
    assert.equal(sinFono.status, 422);
    const r = await peticion('POST', '/api/auth/registro', { json: { ...datos, rol: 'admin' } });
    assert.equal(r.status, 201, JSON.stringify(r.datos));
    assert.equal(r.datos.usuario.rol, 'cliente', 'nadie puede registrarse como administrador');
    assert.equal((await peticion('GET', '/api/envios', { sesion: conToken(r.datos.token) })).status, 200);
    assert.equal((await peticion('POST', '/api/auth/registro', { json: datos })).status, 409, 'correo duplicado');
  } finally {
    await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { registro_clientes: antes } });
  }
});

test('CP-89 · Un repartidor con envíos en curso no se puede desactivar (RF-05)', async () => {
  await envioEnRuta(esc);
  const r = await peticion('PATCH', `/api/usuarios/${esc.repartidor.usuario.id}`, { sesion: esc.admin, json: { activo: false } });
  assert.equal(r.status, 409);
  assert.ok(r.datos.detalles.envios_pendientes >= 1);
});
