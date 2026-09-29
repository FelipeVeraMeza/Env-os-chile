// Inicio de sesión (AUTH_MODE=jwt). Los casos marcados "solo jwt" se omiten en el modo demostración.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { API, crearUsuarioQa, peticion, sesionAdmin } from '../cliente.js';

// El modo se lee antes de declarar los casos (decide cuáles se omiten).
const modo = (await (await fetch(`${API}/api/health`)).json()).auth_mode;
const soloJwt = () => modo !== 'jwt';
let admin;
before(async () => { admin = await sesionAdmin(); });

// Usuario propio de cada caso, con contraseña conocida.
async function usuario(rol = 'cliente') {
  const u = await crearUsuarioQa(admin, rol, `Sesion${Math.random().toString(36).slice(2, 7)}`);
  return u;
}
const login = (correo, password) => peticion('POST', '/api/auth/login', { json: { correo, password } });
const clave = (u) => u.password;

test('CP-91 · Login correcto entrega sesión; correo en mayúsculas también sirve', async () => {
  const u = await usuario();
  const r = await login(u.usuario.correo.toUpperCase(), clave(u));
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.ok(r.datos.token);
  assert.equal(r.datos.usuario.rol, 'cliente');
  const yo = await peticion('GET', '/api/auth/yo', { sesion: { headers: { Authorization: `Bearer ${r.datos.token}` } } });
  assert.equal(yo.datos.id, u.usuario.id);
});

test('CP-92 · Contraseña incorrecta o correo inexistente dan el mismo mensaje; faltan datos → 422', async () => {
  const u = await usuario();
  const mal = await login(u.usuario.correo, 'incorrecta');
  const noExiste = await login('nadie-qa@qa.test', 'incorrecta');
  assert.equal(mal.status, 401);
  assert.equal(noExiste.status, 401);
  assert.equal(mal.datos.error, noExiste.datos.error, 'no debe revelar si el correo existe');
  assert.equal((await login('', '')).status, 422);
});

test('CP-93 · 5 intentos fallidos bloquean esa cuenta 15 minutos (incluso con la clave correcta)', async () => {
  const u = await usuario();
  for (let i = 0; i < 5; i++) assert.equal((await login(u.usuario.correo, `mala-${i}`)).status, 401);
  assert.equal((await login(u.usuario.correo, clave(u))).status, 429);
});

test('CP-94 · Sin sesión la API responde 401 y las cabeceras de demo no sirven (solo jwt)', { skip: soloJwt() && 'modo demo' }, async () => {
  assert.equal((await peticion('GET', '/api/envios')).status, 401);
  assert.equal((await peticion('GET', '/api/envios', { sesion: { headers: { 'X-Demo-Rol': 'admin' } } })).status, 401);
  assert.equal((await peticion('GET', '/api/demo/usuarios')).status, 404);
  assert.equal((await peticion('GET', '/api/envios', { sesion: { headers: { Authorization: 'Bearer token-falso' } } })).status, 401);
});

test('CP-95 · Cambiar la contraseña exige la actual y cierra las sesiones anteriores', async () => {
  const u = await usuario();
  const s = (await login(u.usuario.correo, clave(u))).datos.token;
  const cab = (t) => ({ headers: { Authorization: `Bearer ${t}` } });
  assert.equal((await peticion('POST', '/api/auth/cambiar-clave', { sesion: cab(s), json: { actual: 'otra', nueva: 'Nueva.Clave.QA1' } })).status, 422);
  assert.equal((await peticion('POST', '/api/auth/cambiar-clave', { sesion: cab(s), json: { actual: clave(u), nueva: 'corta' } })).status, 422);
  const r = await peticion('POST', '/api/auth/cambiar-clave', { sesion: cab(s), json: { actual: clave(u), nueva: 'Nueva.Clave.QA1' } });
  assert.equal(r.status, 200);
  assert.equal((await peticion('GET', '/api/auth/yo', { sesion: cab(s) })).status, 401, 'la sesión anterior expira');
  assert.equal((await peticion('GET', '/api/auth/yo', { sesion: cab(r.datos.token) })).status, 200, 'la nueva sesión sirve');
  assert.equal((await login(u.usuario.correo, clave(u))).status, 401, 'la clave anterior ya no sirve');
  assert.equal((await login(u.usuario.correo, 'Nueva.Clave.QA1')).status, 200);
});

test('CP-96 · Clave asignada por administración: cierra sesiones y pide cambiarla al entrar', async () => {
  const u = await usuario('repartidor');
  const s = (await login(u.usuario.correo, clave(u))).datos.token;
  const r = await peticion('PATCH', `/api/usuarios/${u.usuario.id}`, { sesion: admin, json: { password: 'Temporal.QA.2026' } });
  assert.equal(r.status, 200);
  assert.equal((await peticion('GET', '/api/auth/yo', { sesion: { headers: { Authorization: `Bearer ${s}` } } })).status, 401);
  const nuevo = await login(u.usuario.correo, 'Temporal.QA.2026');
  assert.equal(nuevo.status, 200);
  assert.equal(nuevo.datos.usuario.debe_cambiar_clave, true);
});

test('CP-97 · Usuario desactivado no entra y su sesión abierta deja de servir', async () => {
  const u = await usuario();
  const s = (await login(u.usuario.correo, clave(u))).datos.token;
  assert.equal((await peticion('PATCH', `/api/usuarios/${u.usuario.id}`, { sesion: admin, json: { activo: false } })).status, 200);
  assert.equal((await login(u.usuario.correo, clave(u))).status, 403);
  assert.equal((await peticion('GET', '/api/auth/yo', { sesion: { headers: { Authorization: `Bearer ${s}` } } })).status, 401);
});

test('CP-98 · Crear usuario sin contraseña se rechaza cuando hay inicio de sesión (solo jwt)', { skip: soloJwt() && 'modo demo' }, async () => {
  const r = await peticion('POST', '/api/usuarios', { sesion: admin, json: { nombre: 'QA sin clave', correo: `qa-sinclave-${Date.now()}@qa.test`, rol: 'cliente' } });
  assert.equal(r.status, 422);
  assert.ok(r.datos.detalles.password);
});
