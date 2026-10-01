// Verificación por la INTERFAZ de las correcciones de pantalla del plan QA (docs/18): cada caso reproduce en un
// navegador real el error que existía y comprueba que ya no ocurre. Deja el resultado de cada caso en
// qa/reportes/interfaz.json (lo usa npm run verificar:casos).
//   npm run interfaz [-- URL]     (por defecto http://localhost:3000, demo abierta)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const URL_APP = (process.argv[2] || process.env.QA_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const dir = path.dirname(fileURLToPath(import.meta.url));
const reportes = path.join(dir, '..', 'reportes');
fs.mkdirSync(reportes, { recursive: true });

const candidatos = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean).filter((p) => fs.existsSync(p));
const navegador = await chromium.launch(candidatos.length ? { executablePath: candidatos[0] } : { channel: 'chrome' });
const TELEFONO = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-CL', timezoneId: 'America/Santiago' };

// ---------- Datos de prueba por la API (perfiles de la demo) ----------
const perfiles = await (await fetch(`${URL_APP}/api/demo/usuarios`)).json();
if (!Array.isArray(perfiles)) throw new Error('La demo no está abierta: esta verificación necesita AUTH_MODE=demo sin DEMO_CLAVE');
const idDe = (rol) => perfiles.find((p) => p.rol === rol).id;
const ADMIN = idDe('admin');
const CLIENTE = idDe('cliente');
const REPARTIDOR = idDe('repartidor');
async function api(usuario, metodo, ruta, { json, form } = {}) {
  const headers = { 'X-Demo-Usuario': String(usuario), ...(json ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(`${URL_APP}${ruta}`, { method: metodo, headers, body: json ? JSON.stringify(json) : form });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${JSON.stringify(datos)}`);
  return datos;
}
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const comuna = (await (await fetch(`${URL_APP}/api/comunas?cobertura=1&q=Providencia`)).json())[0].id;
const sufijo = Date.now().toString(36);
const crearEnvio = (extra = {}) => api(CLIENTE, 'POST', '/api/envios', { json: {
  destinatario: { nombre: `UI Verificación ${sufijo}`, telefono: '+56 9 6000 1111' }, direccion: { calle: 'Av. Providencia', numero: '100', comuna_id: comuna },
  descripcion_producto: 'Verificación de interfaz', bultos: 1, peso_kg: 1, largo_cm: 10, ancho_cm: 10, alto_cm: 10, valor_declarado: 20000, confirmar: true, ...extra,
} });
async function subirComprobante(id) {
  const fd = new FormData();
  fd.append('archivo', new Blob([JPEG], { type: 'image/jpeg' }), 'c.jpg');
  return api(CLIENTE, 'POST', `/api/envios/${id}/comprobante`, { form: fd });
}
async function pagado() {
  const e = await crearEnvio();
  const p = await subirComprobante(e.id);
  await api(ADMIN, 'POST', `/api/cobranza/comprobantes/${p.id}/aprobar`, { json: {} });
  return e;
}
async function enRuta() {
  const e = await pagado();
  await api(ADMIN, 'POST', `/api/envios/${e.id}/asignar`, { json: { repartidor_id: REPARTIDOR } });
  await api(REPARTIDOR, 'POST', `/api/envios/${e.id}/estado`, { json: { estado: 'en_ruta' } });
  return e;
}

// ---------- Pantallas ----------
const errores = [];
let ultima = null;
async function pantalla(usuario, hash, extra = {}) {
  const ctx = await navegador.newContext({ ...TELEFONO, ...extra });
  const p = await ctx.newPage();
  ultima = p;
  p.on('pageerror', (e) => errores.push(`error JS en ${hash}: ${e.message}`));
  // El perfil se guarda ANTES de que cargue la app y se abre la pantalla una sola vez. (Abrir la app, guardar el perfil y
  // cambiar de pantalla mientras la app aún arrancaba hacía que a veces terminara en la pantalla de inicio del perfil.)
  if (usuario) await ctx.addInitScript((id) => { try { localStorage.setItem('envios.perfil', String(id)); } catch { /* sin almacenamiento */ } }, usuario);
  if (extra.antes) await extra.antes(p);
  await p.goto(`${URL_APP}/${hash}`, { waitUntil: 'networkidle' });
  return p;
}
const textoToasts = (p) => p.$$eval('#toasts .toast', (ts) => ts.map((t) => t.textContent).join(' | '));

const resultados = {};
async function caso(ids, nombre, fn) {
  try {
    await fn();
    for (const id of ids) resultados[id] = { ok: true, nombre };
    console.log(`✔ ${ids.join('/')} · ${nombre}`);
  } catch (err) {
    // Evidencia del fallo: captura y texto de la pantalla en ese momento.
    let pantallaTexto = '';
    if (ultima && !ultima.isClosed()) {
      await ultima.screenshot({ path: path.join(reportes, `interfaz-falla-${ids[0]}.png`) }).catch(() => {});
      pantallaTexto = await ultima.evaluate(() => `${location.hash} · ${document.querySelector('#vista')?.textContent.replace(/\s+/g, ' ').slice(0, 200)}`).catch(() => '');
    }
    for (const id of ids) resultados[id] = { ok: false, nombre, error: err.message, pantalla: pantallaTexto };
    console.log(`✖ ${ids.join('/')} · ${nombre}\n    ${err.message.split('\n')[0]}`);
  }
}
const exigir = (cond, mensaje) => { if (!cond) throw new Error(mensaje); };

try {
  await caso(['QA-53'], 'Enter en el motivo del rechazo NO aprueba el pago', async () => {
    const e = await crearEnvio();
    await subirComprobante(e.id);
    const p = await pantalla(ADMIN, `#/envio/${e.id}`);
    await p.click('#revisar-comprobante');
    await p.fill('#f-revision [name=motivo]', 'monto no coincide');
    await p.press('#f-revision [name=motivo]', 'Enter');
    await p.waitForTimeout(700);
    const estado = (await api(ADMIN, 'GET', `/api/envios/${e.id}`)).estado_pago;
    exigir(estado === 'en_revision', `el pago quedó "${estado}"`);
    await p.context().close();
  });

  await caso(['QA-54'], 'Enter en el monto del reclamo NO lo aprueba', async () => {
    const e = await enRuta();
    const fd = new FormData();
    for (const [k, v] of Object.entries({ motivo: 'dano', monto_reclamado: 5000, boleta_numero: '1', boleta_fecha: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }), boleta_monto: 10000 })) fd.append(k, String(v));
    fd.append('boleta', new Blob([PDF], { type: 'application/pdf' }), 'b.pdf');
    const r = await api(CLIENTE, 'POST', `/api/reclamos/envio/${e.id}`, { form: fd });
    const p = await pantalla(ADMIN, '#/reclamos');
    await p.click(`[data-resolver="${r.id}"]`);
    await p.press('#f-res [name=monto_aprobado]', 'Enter');
    await p.waitForTimeout(700);
    const estado = (await api(ADMIN, 'GET', `/api/reclamos/${r.id}`)).estado;
    exigir(estado === 'solicitado', `el reclamo quedó "${estado}"`);
    await p.context().close();
  });

  let reembolsado;
  await caso(['QA-55', 'QA-46'], 'Reembolso con el monto vacío devuelve el total y se muestra como "Reembolsado"', async () => {
    const e = await pagado();
    await api(ADMIN, 'POST', `/api/envios/${e.id}/estado`, { json: { estado: 'anulado', motivo: 'Verificación' } });
    const p = await pantalla(ADMIN, `#/envio/${e.id}`);
    await p.click('#reembolsar');
    await p.fill('#f-re [name=monto]', '');
    await p.click('#f-re button.btn');
    await p.waitForTimeout(800);
    reembolsado = await api(ADMIN, 'GET', `/api/envios/${e.id}`);
    exigir(reembolsado.reembolso_monto === e.tarifa_total, `reembolsó ${reembolsado.reembolso_monto} de ${e.tarifa_total}`);
    await p.waitForSelector('.badge.e-reembolsado', { timeout: 5000 });
    await p.context().close();
  });

  await caso(['QA-56'], '"Reclamar seguro" solo aparece cuando el envío ya fue retirado', async () => {
    const sinRetirar = await pagado();
    const p = await pantalla(CLIENTE, `#/envio/${sinRetirar.id}`);
    await p.waitForSelector('h1.mono');
    exigir(!(await p.$('#reclamar')), 'el botón aparece antes del retiro');
    const retirado = await enRuta();
    await p.goto(`${URL_APP}/#/envio/${retirado.id}`);
    await p.waitForSelector('#reclamar', { timeout: 5000 });
    await p.context().close();
  });

  await caso(['QA-57'], 'Doble clic en "Pagar" envía una sola confirmación', async () => {
    const antes = (await api(ADMIN, 'GET', '/api/config/publica')).pagos.en_linea;
    if (!antes) await api(ADMIN, 'PUT', '/api/config/pagos', { json: { en_linea: true } });
    try {
      const e = await crearEnvio();
      const p = await pantalla(CLIENTE, `#/envio/${e.id}`);
      await p.click('#pagar');
      await p.waitForSelector('#aprobar');
      await p.dblclick('#aprobar');
      await p.waitForTimeout(1200);
      const t = await textoToasts(p);
      exigir(!/ya fue procesado|ya estaba pagado/i.test(t), `aviso de error: ${t}`);
      exigir((await api(ADMIN, 'GET', `/api/envios/${e.id}`)).estado_pago === 'pagado', 'no quedó pagado');
      await p.context().close();
    } finally {
      if (!antes) await api(ADMIN, 'PUT', '/api/config/pagos', { json: { en_linea: false } });
    }
  });

  for (const [id, hash, form] of [['QA-59', '#/panel', '#rango'], ['QA-60', '#/cobranza', '#rango-c']]) {
    await caso([id], `${hash}: un rango con "desde" posterior a "hasta" muestra un mensaje (no queda cargando)`, async () => {
      const p = await pantalla(ADMIN, hash);
      await p.waitForSelector(form);
      await p.evaluate((sel) => {
        const f = document.querySelector(sel);
        f.desde.value = '2026-09-20'; f.hasta.value = '2026-09-01';
        f.hasta.dispatchEvent(new Event('change', { bubbles: true }));
      }, form);
      await p.waitForSelector('#volver-rango', { timeout: 5000 });
      await p.click('#volver-rango');
      await p.waitForSelector('.kpi', { timeout: 5000 });
      await p.context().close();
    });
  }

  await caso(['QA-61'], 'Seguridad: si los datos no cargan, se explica (no queda cargando)', async () => {
    const p = await pantalla(ADMIN, '#/seguridad', { antes: (pg) => pg.route('**/api/seguridad/resumen*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Falla simulada"}' })) });
    await p.waitForSelector('#volver-rango', { timeout: 5000 });
    await p.context().close();
  });

  await caso(['QA-63'], 'Libreta: si quitar una dirección falla, no dice "Dirección quitada"', async () => {
    const p = await pantalla(CLIENTE, '#/libreta', { antes: (pg) => pg.route('**/api/destinatarios/*/direcciones/*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Falla simulada"}' })) });
    await p.click('[data-quitar]');
    await p.waitForTimeout(600);
    const t = await textoToasts(p);
    exigir(!t.includes('Dirección quitada'), `mostró: ${t}`);
    exigir(t.includes('Falla simulada'), 'no mostró el error');
    await p.context().close();
  });

  await caso(['QA-67'], 'Ajustes → opciones del envío: un error marca el campo', async () => {
    const p = await pantalla(ADMIN, '#/ajustes');
    await p.waitForSelector('#f-listas [name=couriers]', { timeout: 15000 });
    await p.$eval('#f-listas [name=couriers]', (t) => { t.value = ''; });
    await p.click('#f-listas button.btn');
    await p.waitForSelector('#f-listas .campo.invalido', { timeout: 5000 });
    await p.context().close();
  });

  await caso(['QA-71'], 'Al cerrar un modal, el foco vuelve al botón que lo abrió', async () => {
    const p = await pantalla(ADMIN, '#/ajustes');
    await p.click('#nuevo-costo');
    await p.waitForSelector('#f-c');
    await p.keyboard.press('Escape');
    exigir(await p.evaluate(() => document.activeElement?.id === 'nuevo-costo'), 'el foco no volvió al botón');
    await p.context().close();
  });

  await caso(['QA-68'], 'Cuenta regresiva con la hora del teléfono atrasada: no pasa de la espera máxima', async () => {
    const e = await enRuta();
    await api(REPARTIDOR, 'POST', `/api/envios/${e.id}/llegada`);
    const p = await pantalla(REPARTIDOR, `#/envio/${e.id}`, { antes: (pg) => pg.clock.install({ time: new Date(Date.now() - 3 * 60_000) }) });
    await p.waitForSelector('#reloj');
    await p.waitForFunction(() => document.querySelector('#reloj').textContent !== '--:--');
    const reloj = await p.textContent('#reloj');
    const espera = (await api(ADMIN, 'GET', '/api/config/publica')).operacion.espera_max_min;
    exigir(reloj === `${String(espera).padStart(2, '0')}:00`, `el reloj muestra ${reloj}`);
    await p.context().close();
  });

  await caso(['QA-69'], '"No se pudo entregar": el botón se bloquea y avisa mientras busca la ubicación', async () => {
    const e = await enRuta();
    const p = await pantalla(REPARTIDOR, `#/envio/${e.id}`, { antes: (pg) => pg.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok({ coords: { latitude: -33.4, longitude: -70.6, accuracy: 20 } }), 2500);
    }) });
    await p.click('#fallido');
    await p.check('input[name=motivo][value=nadie_en_domicilio]');
    await p.click('#f-fal button.peligro');
    await p.click('[data-si]');
    await p.waitForFunction(() => /Obteniendo ubicación/.test(document.querySelector('#f-fal button.peligro')?.textContent || ''), null, { timeout: 2000 });
    exigir(await p.evaluate(() => document.querySelector('#f-fal button.peligro').disabled), 'el botón no quedó bloqueado');
    await p.waitForFunction(() => !document.querySelector('#f-fal'), null, { timeout: 8000 });
    const h = (await api(ADMIN, 'GET', `/api/envios/${e.id}`)).historial.filter((x) => x.estado_nuevo === 'fallido');
    exigir(h.length === 1, `se registraron ${h.length} intentos`);
    await p.context().close();
  });

  await caso(['QA-101'], 'Si el GPS de alta precisión no responde, se usa la ubicación aproximada', async () => {
    const p = await pantalla(REPARTIDOR, '#/ruta', { antes: (pg) => pg.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (ok, falla, op) => (op?.enableHighAccuracy
        ? setTimeout(() => falla({ code: 3, message: 'timeout' }), 50)
        : setTimeout(() => ok({ coords: { latitude: -33.45, longitude: -70.66, accuracy: 900 } }), 50));
    }) });
    const u = await p.evaluate(async () => (await import('./js/ui.js')).obtenerGps());
    exigir(u.lat === -33.45 && u.precision === 900, `ubicación: ${JSON.stringify(u)}`);
    await p.context().close();
  });

  await caso(['QA-44'], 'Si el teléfono no logra comprimir la foto, se sube la original (nunca un archivo vacío)', async () => {
    const p = await pantalla(CLIENTE, '#/inicio');
    const r = await p.evaluate(async (b64) => {
      HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const original = new File([bytes], 'foto.jpg', { type: 'image/jpeg' });
      const salida = await (await import('./js/ui.js')).comprimirFoto(original);
      return { igual: salida === original, tamano: salida.size };
    }, JPEG.toString('base64'));
    exigir(r.igual && r.tamano > 0, `resultado: ${JSON.stringify(r)}`);
    await p.context().close();
  });

  await caso(['QA-45'], 'Una respuesta cortada del servidor da un mensaje claro', async () => {
    const p = await pantalla(CLIENTE, '#/inicio', { antes: (pg) => pg.route('**/api/seguimiento/*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"folio": "ENV-' })) });
    const msg = await p.evaluate(async () => { try { await (await import('./js/api.js')).get('/api/seguimiento/ENV-2026-000001'); return 'sin error'; } catch (e) { return e.message; } });
    exigir(/Respuesta incompleta/.test(msg), `mensaje: ${msg}`);
    await p.context().close();
  });

  await caso(['QA-58'], 'Al refrescar el QR se libera la imagen anterior', async () => {
    const p = await pantalla(CLIENTE, '#/inicio');
    const liberada = await p.evaluate(async () => {
      const { mostrarBlob } = await import('./js/ui.js');
      const img = document.createElement('img');
      mostrarBlob(img, new Blob(['a'], { type: 'text/plain' }));
      const primera = img.src;
      mostrarBlob(img, new Blob(['b'], { type: 'text/plain' }));
      try { await fetch(primera); return false; } catch { return true; }
    });
    exigir(liberada, 'la imagen anterior sigue en memoria');
    await p.context().close();
  });

  await caso(['QA-103'], 'Cobranza en el celular: un comprobante repetido en muchos envíos no ensancha la pantalla', async () => {
    // Los comprobantes de esta verificación usan la misma imagen: Cobranza los marca como "ya usado en" varios folios.
    for (let i = 0; i < 6; i++) await subirComprobante((await crearEnvio()).id);
    const p = await pantalla(ADMIN, '#/cobranza');
    await p.waitForSelector('[data-revisar-comprobante]', { state: 'attached', timeout: 15000 });
    const desborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    exigir(desborde <= 1, `la pantalla se desborda ${desborde}px`);
    exigir(await p.$eval('body', (b) => /y \d+ más/.test(b.textContent)), 'no se resume la lista de folios');
    await p.context().close();
  });

  await caso(['QA-104'], 'Mi ruta: "Ver los N restantes" muestra todos los disponibles (no solo los 100 más antiguos)', async () => {
    const total = (await api(REPARTIDOR, 'GET', '/api/envios/disponibles?limite=1')).total;
    const p = await pantalla(REPARTIDOR, '#/ruta');
    if (total <= 10) { await p.context().close(); return; }
    await p.click('#ver-disponibles');
    await p.waitForFunction((n) => document.querySelectorAll('#lista-disponibles [data-tomar]').length === n, Math.min(total, 500), { timeout: 10000 });
    await p.context().close();
  });

  await caso(['QA-65', 'QA-66'], 'La app abre sin conexión (service worker con todos los módulos y sin guardar errores)', async () => {
    const sw = await (await fetch(`${URL_APP}/sw.js`)).text();
    const modulos = ['js/app.js', 'js/api.js', 'js/ui.js', ...fs.readdirSync(path.join(dir, '..', '..', 'web', 'js', 'vistas')).map((f) => `js/vistas/${f}`)];
    const faltan = modulos.filter((m) => !sw.includes(`'${m}'`));
    exigir(!faltan.length, `el service worker no guarda: ${faltan.join(', ')}`);
    exigir(/if \(r\.ok\)/.test(sw), 'el service worker guarda respuestas de error');
    const p = await pantalla(CLIENTE, '#/inicio');
    await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => p.reload({ waitUntil: 'networkidle' }));
    await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
    await p.context().setOffline(true);
    await p.reload();
    await p.waitForSelector('#vista', { timeout: 10000 });
    const cargo = await p.evaluate(() => Boolean(document.querySelector('#menu a, .hero, .card')));
    exigir(cargo, 'sin conexión la app no se dibujó');
    await p.context().close();
  });
} finally {
  await navegador.close();
}

for (const e of errores) console.log(`  ⚠ ${e}`);
fs.writeFileSync(path.join(reportes, 'interfaz.json'), JSON.stringify({ fecha: new Date().toISOString(), url: URL_APP, resultados, errores_js: errores }, null, 2));
const fallas = Object.values(resultados).filter((r) => !r.ok).length;
console.log(`\n${fallas ? `✖ ${fallas} verificación(es) fallaron` : '✔ Todas las correcciones de interfaz verificadas en el navegador'} · qa/reportes/interfaz.json\n`);
process.exit(fallas || errores.length ? 1 : 0);
