// Requerimientos que no tenían prueba automatizada y los nuevos (RF-52 a RF-54, RNF-16, RNF-17).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { API, WEB, comunaEnCobertura, crearUsuarioQa, datosEnvio, envioEnRuta, escenario, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

test('CP-68 · La tarifa propia de una comuna se aplica al cotizar (RF-17)', async () => {
  const comuna = await comunaEnCobertura('Ñuñoa');
  const original = comuna.tarifa_base;
  try {
    const p = await peticion('PATCH', `/api/comunas/${comuna.id}`, { sesion: esc.admin, json: { tarifa_base: 4200 } });
    assert.equal(p.status, 200);
    const r = await peticion('POST', '/api/envios/cotizar', { sesion: esc.cliente, json: datosEnvio(comuna.id) });
    assert.deepEqual(r.datos.errores, {});
    assert.equal(r.datos.tarifa_total, 4200);
    const cli = await peticion('PATCH', `/api/comunas/${comuna.id}`, { sesion: esc.cliente, json: { tarifa_base: 1 } });
    assert.equal(cli.status, 403, 'el cliente no puede cambiar tarifas');
  } finally {
    await peticion('PATCH', `/api/comunas/${comuna.id}`, { sesion: esc.admin, json: { tarifa_base: original ?? null } });
  }
});

test('CP-69 · Filtros del registro por estado, comuna, repartidor y fecha (RF-29)', async () => {
  const enRuta = await envioEnRuta(esc);
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const base = `/api/envios?limite=100&desde=${hoy}&hasta=${hoy}`;
  const porEstado = await peticion('GET', `${base}&estado=en_ruta&repartidor_id=${esc.repartidor.usuario.id}&comuna_id=${esc.comuna.id}`, { sesion: esc.admin });
  assert.equal(porEstado.status, 200);
  assert.ok(porEstado.datos.items.some((e) => e.id === enRuta.id));
  assert.ok(porEstado.datos.items.every((e) => e.estado === 'en_ruta'));
  const otroEstado = await peticion('GET', `${base}&estado=entregado&repartidor_id=${esc.repartidor.usuario.id}`, { sesion: esc.admin });
  assert.ok(!otroEstado.datos.items.some((e) => e.id === enRuta.id));
  const ayer = await peticion('GET', '/api/envios?desde=2000-01-01&hasta=2000-01-02', { sesion: esc.admin });
  assert.equal(ayer.datos.total, 0);
});

test('CP-70 · Reporte de ganancias con desglose por día, comuna y repartidor (RF-34, RF-35)', async () => {
  const r = await peticion('GET', '/api/reportes/ganancias', { sesion: esc.admin });
  assert.equal(r.status, 200);
  for (const k of ['ingreso', 'costos', 'neto', 'por_dia', 'por_comuna', 'por_repartidor', 'por_estado']) assert.ok(k in r.datos, `falta ${k}`);
  assert.equal(r.datos.neto, r.datos.ingreso - r.datos.costos);
});

test('CP-71 · El administrador elige si el QR abre la página, Google Maps o Waze (RF-25, RF-26)', async () => {
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  assert.equal(c.status, 201);
  assert.match(c.datos.mapas.google, /google\.com\/maps/, 'el detalle trae el botón de Google Maps');
  assert.match(c.datos.mapas.waze, /waze\.com/, 'el detalle trae el botón de Waze');
  const antes = (await peticion('GET', '/api/config/publica')).datos.operacion.qr_destino;
  try {
    for (const [destino, patron] of [['google', /google\.com\/maps/], ['waze', /waze\.com/]]) {
      assert.equal((await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { qr_destino: destino } })).status, 200);
      const r = await fetch(`${API}/q/${c.datos.token_qr}`, { redirect: 'manual' });
      assert.equal(r.status, 302);
      assert.match(r.headers.get('location'), patron);
    }
  } finally {
    await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { qr_destino: antes } });
  }
});

test('CP-72 · Nombre y datos de la empresa se editan en Ajustes y se publican (RF-39, RF-51)', async () => {
  const antes = (await peticion('GET', '/api/config/publica')).datos.negocio;
  try {
    const r = await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { nombre: 'Envíos QA Ltda.' } });
    assert.equal(r.status, 200);
    assert.equal((await peticion('GET', '/api/config/publica')).datos.negocio.nombre, 'Envíos QA Ltda.');
    const cli = await peticion('PUT', '/api/config/negocio', { sesion: esc.cliente, json: { nombre: 'X' } });
    assert.equal(cli.status, 403);
  } finally {
    await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: antes });
  }
});

test('CP-73 · Auditoría: las acciones sensibles quedan registradas y solo administración las consulta (RF-40, RF-54)', async () => {
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  const r = await peticion('GET', `/api/auditoria?entidad=envio&entidad_id=${c.datos.id}`, { sesion: esc.admin });
  assert.equal(r.status, 200);
  const crear = r.datos.find((a) => a.accion === 'crear');
  assert.ok(crear, 'debe registrar la creación del envío');
  assert.equal(crear.usuario, esc.cliente.usuario.nombre);
  for (const s of [esc.cliente, esc.repartidor]) assert.equal((await peticion('GET', '/api/auditoria', { sesion: s })).status, 403);
});

test('CP-74 · Un usuario desactivado no puede operar (RF-05)', async () => {
  const u = await crearUsuarioQa(esc.admin, 'cliente', 'Desactivado');
  assert.equal((await peticion('GET', '/api/envios', { sesion: u })).status, 200);
  assert.equal((await peticion('PATCH', `/api/usuarios/${u.usuario.id}`, { sesion: esc.admin, json: { activo: false } })).status, 200);
  assert.equal((await peticion('GET', '/api/envios', { sesion: u })).status, 403);
});

test('CP-75 · Instalable como app: manifiesto y service worker (RF-38)', async () => {
  const m = await fetch(`${WEB}/manifest.webmanifest`);
  assert.equal(m.status, 200);
  const manifiesto = JSON.parse(await m.text());
  assert.ok(manifiesto.name && manifiesto.start_url && manifiesto.icons?.length);
  assert.equal(manifiesto.display, 'standalone');
  const sw = await fetch(`${WEB}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /addEventListener\('fetch'/);
});

test('CP-76 · Ticket con QR en menos de 3 s y QR generado en el servidor (RNF-04, RNF-11)', async () => {
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  const t0 = performance.now();
  const r = await peticion('GET', `/api/envios/${c.datos.id}/ticket.pdf?formato=80mm`, { sesion: esc.cliente, crudo: true });
  await r.arrayBuffer();
  const ms = performance.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(ms < 3000, `el ticket tardó ${Math.round(ms)} ms`);
  const qr = await peticion('GET', `/api/envios/${c.datos.id}/qr.png`, { sesion: esc.cliente, crudo: true });
  assert.equal(Buffer.from(await qr.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
});

test('CP-77 · La web usa la API de la misma app, sin servidores externos (RNF-17)', async () => {
  const cfg = await (await fetch(`${WEB}/config.js`)).text();
  const url = cfg.match(/"API_URL":\s*"([^"]*)"/)?.[1];
  assert.ok(url === '' || new URL(url).origin === new URL(WEB).origin, `API_URL debe ser el mismo origen (es "${url}")`);
  const csp = (await fetch(`${WEB}/`)).headers.get('content-security-policy') || '';
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /googleapis|gstatic/, 'sin fuentes externas');
  const index = await (await fetch(`${WEB}/`)).text();
  assert.doesNotMatch(index, /<(script|link)[^>]+(src|href)="https?:\/\//, 'la interfaz no carga scripts ni estilos de otros dominios');
  assert.equal((await fetch(`${WEB}/fonts/plus-jakarta-sans.woff2`)).status, 200);
  const salud = await fetch(`${WEB}/api/health`);
  assert.equal(salud.status, 200, 'la API responde en el mismo dominio que la web');
});

test('CP-78 · Límite de solicitudes por IP en la API y en el seguimiento público (RNF-16)', async () => {
  const api = await peticion('GET', '/api/config/publica');
  assert.ok(Number(api.headers.get('ratelimit-limit')) > 0);
  const pub = await peticion('GET', '/api/seguimiento/ENV-2000-000001');
  assert.equal(pub.status, 404);
  const limite = Number(pub.headers.get('ratelimit-limit'));
  assert.ok(limite > 0 && limite <= 120, `seguimiento con límite estricto (es ${limite})`);
});

test('CP-79 · Demo abierta: se elige perfil sin clave (RF-53)', async (t) => {
  const conf = (await peticion('GET', '/api/config/publica')).datos;
  if (conf.auth_mode !== 'demo') return t.skip('el servidor usa inicio de sesión real (AUTH_MODE=jwt)');
  if (conf.demo_protegida) return t.skip('este servidor tiene DEMO_CLAVE: la demo está protegida');
  const r = await fetch(`${API}/api/demo/usuarios`);
  assert.equal(r.status, 200);
  const perfiles = await r.json();
  for (const rol of ['admin', 'cliente', 'repartidor']) assert.ok(perfiles.some((p) => p.rol === rol), `falta un perfil ${rol}`);
});
