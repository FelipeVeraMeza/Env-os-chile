// Sistema de seguridad: detección de ataques, registro de extracción de datos, cabeceras y sesiones falsificadas.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { API, datosEnvio, envioEnRuta, escenario, formulario, jpegPrueba, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const eventos = async (filtro) => (await peticion('GET', `/api/seguridad/eventos?${new URLSearchParams({ limite: 200, ...filtro })}`, { sesion: esc.admin })).datos;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('CP-100 · Solo administración ve el panel de seguridad; el intento queda registrado', async () => {
  for (const s of [esc.cliente, esc.repartidor]) {
    for (const ruta of ['/api/seguridad/resumen', '/api/seguridad/eventos', '/api/seguridad/extraccion', '/api/seguridad/alertas']) {
      assert.equal((await peticion('GET', ruta, { sesion: s })).status, 403, ruta);
    }
  }
  const ev = await eventos({ tipo: 'acceso_denegado', usuario_id: esc.cliente.usuario.id });
  assert.ok(ev.length >= 1, 'el intento sin permiso queda en la bitácora');
});

test('CP-101 · Sesiones falsificadas ("alg: none" o firmada con otra clave) se rechazan y se registran', async () => {
  const sinFirma = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 1, rol: 'admin', v: 0 })}.`;
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 1, rol: 'admin', v: 0, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const otraClave = `${cuerpo}.${crypto.createHmac('sha256', 'clave-del-atacante').update(cuerpo).digest('base64url')}`;
  for (const token of [sinFirma, otraClave]) {
    assert.equal((await peticion('GET', '/api/usuarios', { sesion: { headers: { Authorization: `Bearer ${token}` } } })).status, 401);
  }
  const ev = await eventos({ tipo: 'token_invalido' });
  assert.ok(ev.length >= 2);
});

test('CP-102 · Intentar abrir envíos ajenos se registra y 5 intentos generan una alerta crítica', async () => {
  const ajeno = await peticion('POST', '/api/envios', { sesion: esc.clienteB, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  for (let i = 0; i < 5; i++) assert.equal((await peticion('GET', `/api/envios/${ajeno.datos.id}`, { sesion: esc.cliente })).status, 404);
  const ev = await eventos({ tipo: 'sondeo_ajeno', usuario_id: esc.cliente.usuario.id });
  assert.ok(ev.length >= 5);
  assert.equal(ev[0].detalle.existe, true);
  const alertas = (await peticion('GET', '/api/seguridad/alertas', { sesion: esc.admin })).datos;
  assert.ok(alertas.some((a) => a.regla === 'enumeracion' && a.usuario_id === esc.cliente.usuario.id && a.nivel === 'critica'));
});

test('CP-103 · La exportación queda registrada con la cantidad de registros y sin inyección de fórmulas', async () => {
  await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, { destinatario: { nombre: '=HYPERLINK("http://malo.cl","clic")', telefono: '+56 9 8765 4321' } }), confirmar: true } });
  const r = await peticion('GET', '/api/envios/exportar.csv', { sesion: esc.cliente });
  assert.equal(r.status, 200);
  assert.match(r.datos, /"'=HYPERLINK/, 'la fórmula queda como texto');
  assert.doesNotMatch(r.datos, /;"=HYPERLINK/);
  const ev = await eventos({ tipo: 'exportacion', usuario_id: esc.cliente.usuario.id });
  assert.ok(ev[0].registros >= 1);
  const ext = (await peticion('GET', '/api/seguridad/extraccion', { sesion: esc.admin })).datos;
  assert.ok(ext.usuarios.some((u) => u.usuario_id === esc.cliente.usuario.id && u.registros_exportados >= 1));
});

test('CP-104 · Cada descarga de foto queda atribuida al usuario; el archivo se entrega aislado', async () => {
  const e = await envioEnRuta(esc);
  const f = await peticion('POST', `/api/envios/${e.id}/entregar`, {
    sesion: esc.repartidor, form: formulario({ lat: -33.43, lon: -70.61 }, { foto: [jpegPrueba(), 'entrega.jpg'] }) });
  assert.equal(f.status, 200);
  const d = await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.cliente });
  const foto = d.datos.adjuntos.find((a) => a.tipo === 'foto_entrega');
  assert.match(foto.url, new RegExp(`[?&]u=${esc.cliente.usuario.id}&`));
  const r = await fetch(`${API}${foto.url}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const ev = await eventos({ tipo: 'descarga_archivo', usuario_id: esc.cliente.usuario.id });
  assert.ok(ev.some((x) => x.detalle.adjunto === foto.id));
  // Cambiar el usuario del enlace para atribuir la descarga a otro invalida la firma.
  const suplantado = foto.url.replace(/u=\d+/, `u=${esc.admin.usuario?.id || 1}`);
  assert.equal((await fetch(`${API}${suplantado}`)).status, 403);
});

test('CP-105 · Cabeceras de seguridad en la aplicación', async () => {
  const r = await fetch(`${API}/`);
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('strict-transport-security'));
  assert.match(r.headers.get('permissions-policy') || '', /microphone=\(\)/);
  assert.equal(r.headers.get('x-powered-by'), null, 'no revela la tecnología del servidor');
});

test('CP-106 · Contraseñas débiles se rechazan', async () => {
  for (const password of ['12345678', 'abcdefgh', 'password1', 'Demo.2026']) {
    const r = await peticion('POST', '/api/usuarios', { sesion: esc.admin, json: { nombre: 'QA Débil', correo: `qa-debil-${Date.now()}-${password.length}@qa.test`, rol: 'cliente', password } });
    assert.equal(r.status, 422, password);
    assert.ok(r.datos.detalles.password, password);
  }
});

test('CP-107 · Revisar alertas exige una nota; la emergencia exige escribir CERRAR', async () => {
  const [a] = (await peticion('GET', '/api/seguridad/alertas', { sesion: esc.admin })).datos;
  if (a) assert.equal((await peticion('POST', `/api/seguridad/alertas/${a.id}/revisar`, { sesion: esc.admin, json: {} })).status, 422);
  assert.equal((await peticion('POST', '/api/seguridad/cerrar-todas-las-sesiones', { sesion: esc.admin, json: { confirmar: 'si' } })).status, 422);
});

test('CP-108 · Cerrar las sesiones de un usuario invalida la sesión que tenía abierta (solo con inicio de sesión)', async () => {
  const modo = (await (await fetch(`${API}/api/health`)).json()).auth_mode;
  if (modo !== 'jwt') return;
  assert.equal((await peticion('GET', '/api/auth/yo', { sesion: esc.repartidorB })).status, 200);
  assert.equal((await peticion('POST', `/api/usuarios/${esc.repartidorB.usuario.id}/cerrar-sesiones`, { sesion: esc.admin })).status, 200);
  assert.equal((await peticion('GET', '/api/auth/yo', { sesion: esc.repartidorB })).status, 401);
});
